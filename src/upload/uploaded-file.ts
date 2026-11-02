import { copyFile, link, rm } from 'node:fs/promises';
import { constants } from 'node:fs';

export interface UploadedFile {
  readonly field: string;
  readonly originalName: string;
  readonly size: number;
  readonly path: string;
  readonly type: string | undefined;
  readonly extension: string | undefined;
  moveTo(destination: string): Promise<void>;
}

function hasCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export class StoredFile implements UploadedFile {
  type: string | undefined;
  extension: string | undefined;
  path: string;

  constructor(
    readonly field: string,
    readonly originalName: string,
    readonly size: number,
    path: string
  ) {
    this.path = path;
  }

  async moveTo(destination: string) {
    try {
      await link(this.path, destination);
    } catch (error) {
      if (!hasCode(error, 'EXDEV') && !hasCode(error, 'EPERM')) throw error;
      await copyFile(this.path, destination, constants.COPYFILE_EXCL);
    }
    await rm(this.path, { force: true });
    this.path = destination;
  }
}
