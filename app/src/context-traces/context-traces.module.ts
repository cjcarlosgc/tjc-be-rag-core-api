import { Module } from '@nestjs/common';
import { ContextTracesRepository } from './context-traces.repository.js';

@Module({
  providers: [ContextTracesRepository],
  exports: [ContextTracesRepository],
})
export class ContextTracesModule {}
