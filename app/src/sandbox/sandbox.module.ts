import { Module } from '@nestjs/common';
import { SandboxExecutionService } from './sandbox-execution.service.js';

@Module({
  providers: [SandboxExecutionService],
  exports: [SandboxExecutionService],
})
export class SandboxModule {}
