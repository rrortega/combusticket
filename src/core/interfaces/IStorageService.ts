export interface StorageUploadOptions {
  contentType?: string;
  isPublic?: boolean;
}

export interface StorageUploadResult {
  key: string;
  url: string;
}

export interface IStorageService {
  readonly driverName: string;

  /**
   * Initialize storage backend (e.g. verify connection, auto-create buckets/directories).
   */
  init?(): Promise<void>;

  /**
   * Explicitly ensure target bucket or storage namespace exists.
   */
  ensureBucket?(): Promise<void>;

  /**
   * Upload an in-memory buffer or byte array to storage.
   */
  upload(
    key: string,
    data: Buffer | Uint8Array,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult>;

  /**
   * Upload a file located on the local disk to storage.
   */
  uploadFromPath(
    key: string,
    localPath: string,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult>;

  /**
   * Resolve the public or direct URL for an existing storage key.
   */
  getUrl(key: string): string;

  /**
   * Retrieve file contents as a Buffer.
   */
  download(key: string): Promise<Buffer>;

  /**
   * Remove a file from storage.
   */
  delete(key: string): Promise<void>;

  /**
   * Check if a file exists in storage.
   */
  exists(key: string): Promise<boolean>;
}
