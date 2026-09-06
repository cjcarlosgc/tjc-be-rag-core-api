export abstract class ObjectStorageService {
  abstract put(key: string, body: Buffer, contentType?: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
  abstract presignGet(key: string, expiresInSeconds: number): Promise<string>;
}
