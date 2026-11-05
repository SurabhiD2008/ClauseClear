// The part of multer 2.5.0 this server uses, typed from its own JSDoc
// (node_modules/multer/index.js). A local declaration instead of @types/multer,
// which would be an unapproved dev dependency (ASSUMPTIONS A87).
declare module "multer" {
  import type { RequestHandler } from "express";

  namespace multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size?: number;
      /** Set by memory storage. */
      buffer?: Buffer;
    }
    interface Limits {
      fieldNameSize?: number;
      fieldSize?: number;
      fields?: number;
      fileSize?: number;
      files?: number;
      parts?: number;
      headerPairs?: number;
    }
    interface StorageEngine {
      _handleFile: unknown;
      _removeFile: unknown;
    }
    interface Options {
      storage?: StorageEngine;
      limits?: Limits;
    }
    interface Multer {
      single(name: string): RequestHandler;
      none(): RequestHandler;
    }
    class MulterError extends Error {
      readonly code: string;
      readonly field?: string;
    }
    function memoryStorage(): StorageEngine;
  }

  function multer(options?: multer.Options): multer.Multer;
  export = multer;
}
