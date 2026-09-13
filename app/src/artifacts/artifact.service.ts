import { HttpStatus, Injectable } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { ObjectStorageService } from '../object-storage/object-storage.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Artifact } from '../generated/prisma/client.js';
import { ArtifactsRepository, type ArtifactToPersist } from './artifacts.repository.js';
import { computeLineDiff, type DiffLine } from './diff.util.js';

export interface FinalArtifactInput {
  relativePath: string;
  content: string;
  isNewFile: boolean;
  originalContent: string | null;
  valid: boolean;
}

function assertSafeRelativePath(relativePath: string): void {
  if (
    relativePath.startsWith('/') ||
    relativePath.includes('..') ||
    relativePath.includes('\\')
  ) {
    throw new AppException(
      ErrorCode.INVALID_ZIP,
      `Ruta de artefacto insegura: ${relativePath}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

@Injectable()
export class ArtifactService {
  constructor(
    private readonly objectStorageService: ObjectStorageService,
    private readonly artifactsRepository: ArtifactsRepository,
  ) {}

  async persistFinalArtifacts(testRunId: string, files: FinalArtifactInput[]): Promise<void> {
    const toPersist: ArtifactToPersist[] = [];

    for (const file of files) {
      toPersist.push(await this.writeArtifactContent(testRunId, file));
    }

    await this.artifactsRepository.insertMany(testRunId, toPersist);
  }

  /**
   * HU24 (reintento manual): un solo archivo, re-escrito tras un retry de
   * target. Si ya existía un `Artifact` para ese `relativePath` en este run
   * (siempre existe, salvo un caso borde de fallo previo a persistir), lo
   * actualiza en su lugar en vez de duplicarlo.
   */
  async persistRetriedArtifact(testRunId: string, file: FinalArtifactInput): Promise<void> {
    const toPersist = await this.writeArtifactContent(testRunId, file);
    const existing = await this.artifactsRepository.findByTestRunAndPath(testRunId, file.relativePath);

    if (existing) {
      await this.artifactsRepository.update(existing.id, toPersist);
      return;
    }

    await this.artifactsRepository.insertMany(testRunId, [toPersist]);
  }

  private async writeArtifactContent(
    testRunId: string,
    file: FinalArtifactInput,
  ): Promise<ArtifactToPersist> {
    assertSafeRelativePath(file.relativePath);

    const storageKey = `test-runs/${testRunId}/artifacts/${file.relativePath}`;
    await this.objectStorageService.put(storageKey, Buffer.from(file.content, 'utf8'), 'text/plain');

    if (!file.isNewFile && file.originalContent !== null) {
      const originalKey = `test-runs/${testRunId}/originals/${file.relativePath}`;
      await this.objectStorageService.put(
        originalKey,
        Buffer.from(file.originalContent, 'utf8'),
        'text/plain',
      );
    }

    return {
      relativePath: file.relativePath,
      artifactType: file.isNewFile ? 'CREATED' : 'MODIFIED',
      storageKey,
      valid: file.valid,
    };
  }

  async listByTestRun(testRunId: string, ownerUserId: string): Promise<Artifact[]> {
    await this.requireTestRunOwnership(testRunId, ownerUserId);
    return this.artifactsRepository.findByTestRun(testRunId);
  }

  async diff(
    artifactId: string,
    ownerUserId: string,
  ): Promise<{ artifactId: string; relativePath: string; lines: DiffLine[] }> {
    const artifact = await this.requireArtifact(artifactId, ownerUserId);

    if (artifact.artifactType === 'CREATED') {
      throw new AppException(
        ErrorCode.DIFF_NOT_AVAILABLE,
        'Un artefacto CREATED no tiene diff disponible: no existía versión original.',
        HttpStatus.CONFLICT,
      );
    }

    const originalKey = `test-runs/${artifact.testRunId}/originals/${artifact.relativePath}`;
    const [originalBuffer, finalBuffer] = await Promise.all([
      this.objectStorageService.get(originalKey),
      this.objectStorageService.get(artifact.storageKey),
    ]);

    return {
      artifactId: artifact.id,
      relativePath: artifact.relativePath,
      lines: computeLineDiff(originalBuffer.toString('utf8'), finalBuffer.toString('utf8')),
    };
  }

  async downloadOne(
    artifactId: string,
    ownerUserId: string,
  ): Promise<{ relativePath: string; content: Buffer }> {
    const artifact = await this.requireArtifact(artifactId, ownerUserId);
    const content = await this.objectStorageService.get(artifact.storageKey);
    return { relativePath: artifact.relativePath, content };
  }

  async downloadAllAsZip(testRunId: string, ownerUserId: string): Promise<Buffer> {
    await this.requireTestRunOwnership(testRunId, ownerUserId);
    const artifacts = await this.artifactsRepository.findByTestRun(testRunId);
    const zip = new AdmZip();

    for (const artifact of artifacts) {
      const content = await this.objectStorageService.get(artifact.storageKey);
      zip.addFile(artifact.relativePath, content);
    }

    return zip.toBuffer();
  }

  private async requireArtifact(artifactId: string, ownerUserId: string): Promise<Artifact> {
    const artifact = await this.artifactsRepository.findByIdForOwner(artifactId, ownerUserId);

    if (!artifact) {
      throw new AppException(
        ErrorCode.ARTIFACT_NOT_FOUND,
        `No existe el artifact ${artifactId}.`,
        HttpStatus.NOT_FOUND,
      );
    }

    return artifact;
  }

  private async requireTestRunOwnership(testRunId: string, ownerUserId: string): Promise<void> {
    const owned = await this.artifactsRepository.testRunExistsForOwner(testRunId, ownerUserId);

    if (!owned) {
      throw new AppException(
        ErrorCode.TEST_RUN_NOT_FOUND,
        `No existe el test run ${testRunId}.`,
        HttpStatus.NOT_FOUND,
      );
    }
  }
}
