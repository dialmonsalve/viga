import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response } from 'express';
import { fileTypeFromFile } from 'file-type';
import multer from 'multer';
import { addToPipeline, validatedParts } from '../decorators/pipeline.ts';
import { findInjectorOf } from '../di/injector.ts';
import { diagnostic } from '../diagnostics.ts';
import type { AcceptsContext, HttpContext, RequestSchemas } from '../http/context.ts';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '../http/exceptions.ts';
import { LOGGER } from '../logger.ts';
import { StoredFile, type UploadedFile } from './uploaded-file.ts';

export interface UploadOptions {
  field: string;
  types?: readonly string[];
  check?: (file: UploadedFile) => boolean | Promise<boolean>;
  maxFileSize?: number;
  maxFiles?: number;
  maxFields?: number;
  maxFieldSize?: number;
  optional?: boolean;
}

export type UploadContext<S extends RequestSchemas = RequestSchemas> = HttpContext<S> & {
  file: UploadedFile;
  files: UploadedFile[];
};

export type OptionalUploadContext<S extends RequestSchemas = RequestSchemas> = HttpContext<S> & {
  file: UploadedFile | undefined;
  files: UploadedFile[];
};

type AcceptsUpload<M, O> = O extends { optional: true }
  ? AcceptsContext<M, OptionalUploadContext> &
      (M extends (ctx: infer Ctx, ...args: any[]) => unknown ? (Ctx extends { file: UploadedFile } ? never : unknown) : unknown)
  : AcceptsContext<M, UploadContext>;

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_FIELDS = 20;
const DEFAULT_MAX_FIELD_SIZE = 64 * 1024;
const MAX_NAME_LENGTH = 255;
const UNDETECTABLE_TYPE = /^text\/|^application\/json$|^image\/svg\+xml$/;

function validateOptions(options: UploadOptions) {
  const { field, types, check, maxFileSize = 1, maxFiles = 1, maxFields = 1, maxFieldSize = 1 } = options;

  if (!types?.length && !check) throw new Error(diagnostic('upload.noCheck'));
  if (!field || ![maxFileSize, maxFiles, maxFields, maxFieldSize].every((n) => Number.isInteger(n) && n > 0)) {
    throw new Error(diagnostic('upload.invalidOptions'));
  }
  const undetectable = types?.find((type) => UNDETECTABLE_TYPE.test(type));
  if (undetectable) throw new Error(diagnostic('upload.undetectableType', { type: undetectable }));
}

function safeName(name: string) {
  const base = name.split(/[/\\]/).pop() ?? '';
  return base.replaceAll(/[\u0000-\u001f\u007f]/g, '').slice(0, MAX_NAME_LENGTH);
}

function toHttpError(error: unknown) {
  if (error instanceof multer.MulterError) {
    return error.code === 'LIMIT_FILE_SIZE'
      ? new PayloadTooLargeException('errors.fileTooLarge')
      : new BadRequestException('errors.invalidUpload');
  }
  const isSystemError = typeof error === 'object' && error !== null && 'code' in error;
  return isSystemError ? error : new BadRequestException('errors.invalidUpload');
}

function createParser(options: UploadOptions, directory: string, acceptsFields: boolean) {
  const storage = multer.diskStorage({
    destination: directory,
    filename: (_req, _file, done) => done(null, randomUUID()),
  });

  const parser = multer({
    storage,
    defParamCharset: 'utf8',
    limits: {
      fileSize: options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      files: options.maxFiles ?? 1,
      fields: acceptsFields ? (options.maxFields ?? DEFAULT_MAX_FIELDS) : 0,
      fieldSize: options.maxFieldSize ?? DEFAULT_MAX_FIELD_SIZE,
    },
  });
  return parser.array(options.field, options.maxFiles ?? 1);
}

function parse(req: Request, res: Response, handler: ReturnType<typeof createParser>) {
  return new Promise<void>((resolve, reject) => {
    void handler(req, res, (error: unknown) => (error ? reject(toHttpError(error)) : resolve()));
  });
}

async function verify(file: StoredFile, { types, check }: UploadOptions) {
  if (types?.length) {
    const detected = await fileTypeFromFile(file.path);
    if (!detected || !types.includes(detected.mime)) {
      throw new UnsupportedMediaTypeException('errors.unsupportedFileType');
    }
    file.type = detected.mime;
    file.extension = detected.ext;
  }
  if (check && !(await check(file))) {
    throw new UnsupportedMediaTypeException('errors.unsupportedFileType');
  }
}

export function Upload<const O extends UploadOptions>(options: O) {
  validateOptions(options);

  return function <This extends object, M extends (this: This, ...args: any[]) => unknown>(
    method: M,
    _context: ClassMethodDecoratorContext<This, M> & AcceptsUpload<M, O>
  ) {
    const decorated: M = addToPipeline(method, {
      validates: ['upload'],
      notes: {
        upload: {
          field: options.field,
          multiple: (options.maxFiles ?? 1) > 1,
          optional: options.optional === true,
        },
      },
      readers: [
        async (self, rawCtx) => {
          const ctx = rawCtx as UploadContext;
          if (!ctx.res) throw new Error(diagnostic('upload.httpOnly'));

          const directory = await mkdtemp(join(tmpdir(), 'viga-upload-'));
          ctx.res.once('close', () => {
            try {
              rmSync(directory, { recursive: true, force: true });
            } catch (error) {
              findInjectorOf(self)?.find(LOGGER)?.error(diagnostic('upload.cleanupFailed', { path: directory }), error);
            }
          });

          const acceptsFields = validatedParts(decorated).has('body');
          await parse(ctx.req, ctx.res, createParser(options, directory, acceptsFields));

          const received = Array.isArray(ctx.req.files) ? ctx.req.files : [];
          if (received.length === 0 && !options.optional) {
            throw new BadRequestException('errors.fileRequired');
          }
          if (!acceptsFields && ctx.req.body !== undefined && !ctx.req.is('multipart')) {
            throw new BadRequestException('errors.unexpectedBody');
          }

          const files = received.map(
            (file) => new StoredFile(file.fieldname, safeName(file.originalname), file.size, file.path)
          );
          for (const file of files) await verify(file, options);

          const context: { file: UploadedFile | undefined; files: UploadedFile[] } = ctx;
          context.file = files[0];
          context.files = files;
          ctx.body = acceptsFields ? { ...ctx.req.body } : undefined;
          ctx.req.body = ctx.body;
        },
      ],
    });
    return decorated;
  };
}
