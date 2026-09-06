import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ArtifactService } from './artifact.service.js';
import type {
  ArtifactDiffResponse,
  ArtifactListResponse,
  ArtifactType,
} from './dto/artifact.response.js';

function safeFileName(relativePath: string): string {
  return relativePath.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? 'artifact';
}

@Controller()
export class ArtifactsController {
  constructor(private readonly artifactService: ArtifactService) {}

  @Get('test-runs/:runId/artifacts')
  async listByRun(@Param('runId') runId: string): Promise<ArtifactListResponse> {
    const artifacts = await this.artifactService.listByTestRun(runId);

    return {
      runId,
      items: artifacts.map((artifact) => ({
        id: artifact.id,
        runId: artifact.testRunId,
        relativePath: artifact.relativePath,
        artifactType: artifact.artifactType as ArtifactType,
        valid: artifact.valid,
        createdAt: artifact.createdAt.toISOString(),
      })),
    };
  }

  @Get('artifacts/:artifactId/diff')
  diff(@Param('artifactId') artifactId: string): Promise<ArtifactDiffResponse> {
    return this.artifactService.diff(artifactId);
  }

  @Get('artifacts/:artifactId/download')
  async downloadOne(@Param('artifactId') artifactId: string, @Res() res: Response): Promise<void> {
    const { relativePath, content } = await this.artifactService.downloadOne(artifactId);

    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${safeFileName(relativePath)}"`,
    );
    res.send(content);
  }

  @Get('test-runs/:runId/artifacts/download')
  async downloadAll(@Param('runId') runId: string, @Res() res: Response): Promise<void> {
    const zipBuffer = await this.artifactService.downloadAllAsZip(runId);

    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="test-run-${safeFileName(runId)}.zip"`);
    res.send(zipBuffer);
  }
}
