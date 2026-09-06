import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ObjectStorageService } from './object-storage.service.js';

@Injectable()
export class SupabaseObjectStorageAdapter extends ObjectStorageService {
  private readonly logger = new Logger(SupabaseObjectStorageAdapter.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;
  private ensureBucketPromise: Promise<void> | undefined;

  constructor(configService: ConfigService) {
    super();
    this.bucket = configService.getOrThrow<string>('OBJECT_STORAGE_BUCKET');
    this.client = createClient(
      configService.getOrThrow<string>('SUPABASE_URL'),
      configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    await this.ensureBucket();

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: true });

    if (error) {
      throw new Error(`No se pudo subir el objeto "${key}": ${error.message}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureBucket();

    const { data, error } = await this.client.storage.from(this.bucket).download(key);

    if (error || !data) {
      throw new Error(`No se pudo descargar el objeto "${key}": ${error?.message ?? 'sin datos'}`);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucket();

    const { error } = await this.client.storage.from(this.bucket).remove([key]);

    if (error) {
      throw new Error(`No se pudo eliminar el objeto "${key}": ${error.message}`);
    }
  }

  async presignGet(key: string, expiresInSeconds: number): Promise<string> {
    await this.ensureBucket();

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds);

    if (error || !data) {
      throw new Error(
        `No se pudo generar la URL firmada para "${key}": ${error?.message ?? 'sin datos'}`,
      );
    }

    return data.signedUrl;
  }

  private ensureBucket(): Promise<void> {
    this.ensureBucketPromise ??= this.createBucketIfMissing();
    return this.ensureBucketPromise;
  }

  private async createBucketIfMissing(): Promise<void> {
    const { data } = await this.client.storage.getBucket(this.bucket);

    if (data) {
      return;
    }

    const { error } = await this.client.storage.createBucket(this.bucket, { public: false });

    if (error) {
      throw new Error(`No se pudo crear el bucket "${this.bucket}": ${error.message}`);
    }

    this.logger.log(`Bucket "${this.bucket}" creado.`);
  }
}
