import type { Request } from 'express';
import { addToPipeline } from '../decorators/pipeline.ts';
import { diagnostic } from '../diagnostics.ts';
import type { AcceptsContext, HttpContext, RequestSchemas } from '../http/context.ts';
import { BadRequestException } from '../http/exceptions.ts';
import { normalizePath } from '../http/router.ts';

export interface PaginateOptions {
  defaultLimit?: number;
  maxLimit?: number;
  maxPage?: number;
  maxOffset?: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  lastPage: number;
  next: string | null;
  prev: string | null;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface Page {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
  result<T>(items: readonly T[], total: number): PaginatedResult<T>;
}

export interface PageContext<S extends RequestSchemas = RequestSchemas> extends HttpContext<S> {
  page: Page;
}

const POSITIVE_INTEGER = /^[1-9]\d{0,8}$/;

function isPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function readPositiveInteger(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !POSITIVE_INTEGER.test(value)) return undefined;
  return Number(value);
}

function linkTo(req: Request, page: number, limit: number) {
  const url = new URL(req.originalUrl, 'http://localhost');
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  return `${normalizePath(url.pathname)}?${url.searchParams}`;
}

function createPage(req: Request, page: number, limit: number): Page {
  return {
    page,
    limit,
    offset: (page - 1) * limit,
    result(items, total) {
      const lastPage = Math.max(1, Math.ceil(total / limit));
      return {
        data: [...items],
        meta: {
          total,
          page,
          lastPage,
          next: page < lastPage ? linkTo(req, page + 1, limit) : null,
          prev: page > 1 ? linkTo(req, Math.min(page - 1, lastPage), limit) : null,
        },
      };
    },
  };
}

export function Paginate({
  defaultLimit = 20,
  maxLimit = 100,
  maxPage = 1000,
  maxOffset = 10_000,
}: PaginateOptions = {}) {
  if (
    ![defaultLimit, maxLimit, maxPage, maxOffset].every(isPositiveInteger) ||
    defaultLimit > maxLimit
  ) {
    throw new Error(
      diagnostic('pagination.invalidOptions', { defaultLimit, maxLimit, maxPage, maxOffset })
    );
  }

  return function <This extends object, M extends (this: This, ...args: any[]) => unknown>(
    method: M,
    _context: ClassMethodDecoratorContext<This, M> & AcceptsContext<M, PageContext>
  ) {
    return addToPipeline(method, {
      pipes: [
        async (_self, ctx) => {
          const { req } = ctx as HttpContext;
          const requested = readPositiveInteger(req.query.limit, defaultLimit);
          if (requested === undefined) throw new BadRequestException('errors.invalidLimit');
          const limit = Math.min(requested, maxLimit);

          const lastAllowed = Math.min(maxPage, Math.floor(maxOffset / limit) + 1);
          const page = readPositiveInteger(req.query.page, 1);
          if (page === undefined || page > lastAllowed) {
            throw new BadRequestException('errors.invalidPage', undefined, { max: lastAllowed });
          }

          return { ...ctx, page: createPage(req, page, limit) };
        },
      ],
    });
  };
}
