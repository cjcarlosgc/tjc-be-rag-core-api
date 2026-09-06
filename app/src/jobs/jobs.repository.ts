import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Job, Prisma } from '../generated/prisma/client.js';
import { JobStatus } from '../generated/prisma/enums.js';

@Injectable()
export class JobsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(type: string, payload: Prisma.InputJsonValue, maxAttempts: number): Promise<Job> {
    return this.prisma.job.create({
      data: { type, payload, maxAttempts },
    });
  }

  async claimNext(workerId: string): Promise<Job | null> {
    const rows = await this.prisma.$queryRaw<Job[]>`
      UPDATE "jobs"
      SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId}, "updatedAt" = now()
      WHERE "id" = (
        SELECT "id" FROM "jobs"
        WHERE "status" = 'PENDING' AND "availableAt" <= now()
        ORDER BY "availableAt"
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *;
    `;

    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.COMPLETED, lockedAt: null, lockedBy: null },
    });
  }

  async fail(job: Job, errorMessage: string, forceTerminal = false): Promise<void> {
    const attempts = job.attempts + 1;
    const isTerminal = forceTerminal || attempts >= job.maxAttempts;
    const backoffMs = Math.min(2 ** attempts * 1000, 60_000);

    await this.prisma.job.update({
      where: { id: job.id },
      data: {
        attempts,
        status: isTerminal ? JobStatus.FAILED : JobStatus.PENDING,
        lastError: errorMessage.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        availableAt: isTerminal ? job.availableAt : new Date(Date.now() + backoffMs),
      },
    });
  }
}
