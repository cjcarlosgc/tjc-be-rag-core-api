import { Injectable } from '@nestjs/common';
import { ObjectStorageService } from '../../src/object-storage/object-storage.service.js';

@Injectable()
export class FakeObjectStorageService extends ObjectStorageService {
  private readonly store = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.store.set(key, body);
  }

  async get(key: string): Promise<Buffer> {
    const value = this.store.get(key);

    if (!value) {
      throw new Error(`Objeto no encontrado: "${key}".`);
    }

    return value;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async presignGet(key: string): Promise<string> {
    return `fake://${key}`;
  }
}
