import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service.js';
import { SupabaseObjectStorageAdapter } from './supabase-object-storage.adapter.js';

@Global()
@Module({
  providers: [{ provide: ObjectStorageService, useClass: SupabaseObjectStorageAdapter }],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
