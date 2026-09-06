import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { JobsRepository } from './jobs.repository.js';
import type { JobHandler } from './job-handler.interface.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;

  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly configService: ConfigService,
  ) {}

  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
  }

  async enqueue(type: string, payload: Prisma.InputJsonValue): Promise<string> {
    const maxAttempts = this.configService.get<number>('JOBS_MAX_ATTEMPTS', 3);
    const job = await this.jobsRepository.create(type, payload, maxAttempts);
    return job.id;
  }

  onModuleInit(): void {
    const intervalMs = this.configService.get<number>('JOBS_POLL_INTERVAL_MS', 1000);
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runOnce(): Promise<void> {
    if (this.polling) {
      return;
    }

    this.polling = true;

    try {
      const job = await this.jobsRepository.claimNext(this.workerId);

      if (!job) {
        return;
      }

      const handler = this.handlers.get(job.type);

      if (!handler) {
        this.logger.error(`Sin handler registrado para el tipo de job "${job.type}".`);
        await this.jobsRepository.fail(job, `Sin handler registrado para "${job.type}".`, true);
        return;
      }

      try {
        await handler.handle(job.payload, job.id);
        await this.jobsRepository.complete(job.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido en el job.';
        this.logger.error(`Job ${job.id} (${job.type}) falló: ${message}`);
        await this.jobsRepository.fail(job, message);
      }
    } finally {
      this.polling = false;
    }
  }
}
