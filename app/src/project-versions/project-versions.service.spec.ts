import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { ProjectVersionsService } from './project-versions.service.js';
import { ZipValidationService } from './zip/zip-validation.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import { INDEXING_JOB_TYPE } from './indexing.constants.js';
import type { Project, ProjectVersion } from '../generated/prisma/client.js';

function buildZip(entries: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.from(content));
  }
  return zip.toBuffer();
}

function makeFile(buffer: Buffer): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'project.zip',
    encoding: '7bit',
    mimetype: 'application/zip',
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

describe('ProjectVersionsService', () => {
  let service: ProjectVersionsService;
  let projectsRepository: { findById: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let projectVersionsRepository: {
    hasActiveVersion: ReturnType<typeof vi.fn>;
    createPending: ReturnType<typeof vi.fn>;
    setSnapshot: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
  };
  let testTargetsRepository: { findByProjectVersion: ReturnType<typeof vi.fn> };
  let jobsService: { enqueue: ReturnType<typeof vi.fn> };
  let objectStorageProvider: { put: ReturnType<typeof vi.fn> };

  const project: Project = {
    id: 'project-1',
    name: 'demo',
    currentVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const version: ProjectVersion = {
    id: 'version-1',
    projectId: 'project-1',
    status: 'PENDING',
    originalFileName: 'project.zip',
    sizeBytes: 100,
    snapshotKey: null,
    filesProcessed: null,
    chunksCount: null,
    detectedFramework: null,
    targetsTotal: null,
    targetsWithTest: null,
    failureReason: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const validZip = () => buildZip({ 'package.json': '{}', 'src/index.ts': 'export {}' });

  beforeEach(() => {
    projectsRepository = { findById: vi.fn(), create: vi.fn() };
    projectVersionsRepository = {
      hasActiveVersion: vi.fn().mockResolvedValue(false),
      createPending: vi.fn().mockResolvedValue(version),
      setSnapshot: vi.fn(),
      findById: vi.fn(),
      markFailed: vi.fn(),
    };
    testTargetsRepository = { findByProjectVersion: vi.fn().mockResolvedValue([]) };
    jobsService = { enqueue: vi.fn().mockResolvedValue('job-1') };
    objectStorageProvider = { put: vi.fn() };

    service = new ProjectVersionsService(
      projectsRepository as never,
      projectVersionsRepository as never,
      testTargetsRepository as never,
      new ZipValidationService({ get: () => 52_428_800 } as never),
      jobsService as never,
      { get: () => 1500 } as never,
      objectStorageProvider as never,
    );
  });

  describe('startIndexing', () => {
    it('throws ZIP_REQUIRED when no file is provided', async () => {
      await expect(service.startIndexing(undefined, {})).rejects.toMatchObject({
        code: ErrorCode.ZIP_REQUIRED,
      });
    });

    it('throws UNSUPPORTED_PROJECT for an incompatible archive', async () => {
      const file = makeFile(buildZip({ 'README.md': 'hi' }));

      await expect(service.startIndexing(file, {})).rejects.toMatchObject({
        code: ErrorCode.UNSUPPORTED_PROJECT,
      });
    });

    it('throws PROJECT_NOT_FOUND when projectId does not exist', async () => {
      projectsRepository.findById.mockResolvedValue(null);
      const file = makeFile(validZip());

      await expect(service.startIndexing(file, { projectId: 'missing' })).rejects.toMatchObject({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
    });

    it('throws PROJECT_INDEXING_IN_PROGRESS when the project already has an active version', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      projectVersionsRepository.hasActiveVersion.mockResolvedValue(true);
      const file = makeFile(validZip());

      await expect(
        service.startIndexing(file, { projectId: project.id }),
      ).rejects.toMatchObject({ code: ErrorCode.PROJECT_INDEXING_IN_PROGRESS });
    });

    it('creates a project, stores the snapshot and enqueues the indexing job', async () => {
      projectsRepository.create.mockResolvedValue(project);
      const file = makeFile(validZip());

      const result = await service.startIndexing(file, { name: 'demo' });

      expect(projectsRepository.create).toHaveBeenCalledWith('demo');
      expect(objectStorageProvider.put).toHaveBeenCalledWith(
        expect.stringContaining(`projects/${project.id}/versions/${version.id}/source.zip`),
        file.buffer,
        'application/zip',
      );
      expect(jobsService.enqueue).toHaveBeenCalledWith(
        INDEXING_JOB_TYPE,
        expect.objectContaining({ projectVersionId: version.id, projectId: project.id }),
      );
      expect(result).toEqual({
        projectId: project.id,
        projectVersionId: version.id,
        status: 'PENDING',
        pollAfterMs: 1500,
      });
    });

    it('marks the version as FAILED and rethrows when the snapshot upload fails', async () => {
      projectsRepository.create.mockResolvedValue(project);
      objectStorageProvider.put.mockRejectedValue(new Error('storage unreachable'));
      const file = makeFile(validZip());

      await expect(service.startIndexing(file, { name: 'demo' })).rejects.toThrow(
        'storage unreachable',
      );

      expect(projectVersionsRepository.markFailed).toHaveBeenCalledWith(
        version.id,
        'storage unreachable',
      );
      expect(projectVersionsRepository.setSnapshot).not.toHaveBeenCalled();
      expect(jobsService.enqueue).not.toHaveBeenCalled();
    });

    it('marks the version as FAILED and rethrows when enqueueing the job fails, so the project is not left blocked', async () => {
      projectsRepository.create.mockResolvedValue(project);
      jobsService.enqueue.mockRejectedValue(new Error('jobs table unavailable'));
      const file = makeFile(validZip());

      await expect(service.startIndexing(file, { name: 'demo' })).rejects.toThrow(
        'jobs table unavailable',
      );

      expect(projectVersionsRepository.markFailed).toHaveBeenCalledWith(
        version.id,
        'jobs table unavailable',
      );
    });
  });

  describe('getStatus', () => {
    it('throws PROJECT_VERSION_NOT_FOUND when the version does not exist', async () => {
      projectVersionsRepository.findById.mockResolvedValue(null);

      await expect(service.getStatus('missing')).rejects.toMatchObject({
        code: ErrorCode.PROJECT_VERSION_NOT_FOUND,
      });
    });

    it('returns the serialized version', async () => {
      projectVersionsRepository.findById.mockResolvedValue(version);

      const result = await service.getStatus(version.id);

      expect(result.id).toBe(version.id);
      expect(result.status).toBe('PENDING');
    });
  });

  describe('getResults', () => {
    it('throws ANALYSIS_NOT_FINISHED when the version has not completed', async () => {
      projectVersionsRepository.findById.mockResolvedValue(version);

      await expect(service.getResults(version.id)).rejects.toMatchObject({
        code: ErrorCode.ANALYSIS_NOT_FINISHED,
      });
    });

    it('returns the results summary once completed', async () => {
      projectVersionsRepository.findById.mockResolvedValue({
        ...version,
        status: 'COMPLETED',
        filesProcessed: 3,
        chunksCount: 7,
        detectedFramework: 'VITEST',
        targetsTotal: 5,
        targetsWithTest: 2,
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      } satisfies ProjectVersion);

      const result = await service.getResults(version.id);

      expect(result).toMatchObject({
        status: 'COMPLETED',
        filesProcessed: 3,
        chunksCount: 7,
        detectedFramework: 'VITEST',
        targetsTotal: 5,
        targetsWithTest: 2,
        targetsMissingTest: 3,
      });
    });
  });

  describe('getTestInventory', () => {
    it('throws ANALYSIS_NOT_FINISHED when the version has not completed', async () => {
      projectVersionsRepository.findById.mockResolvedValue(version);

      await expect(service.getTestInventory(version.id)).rejects.toMatchObject({
        code: ErrorCode.ANALYSIS_NOT_FINISHED,
      });
    });

    it('returns the target list and summary once completed', async () => {
      projectVersionsRepository.findById.mockResolvedValue({
        ...version,
        status: 'COMPLETED',
        detectedFramework: 'JEST',
        targetsTotal: 2,
        targetsWithTest: 1,
      } satisfies ProjectVersion);
      testTargetsRepository.findByProjectVersion.mockResolvedValue([
        {
          id: 't1',
          filePath: 'src/a.ts',
          symbolName: 'A',
          methodName: null,
          targetType: 'CLASS',
          hasTest: true,
          testFilePaths: ['src/a.spec.ts'],
        },
        {
          id: 't2',
          filePath: 'src/b.ts',
          symbolName: 'b',
          methodName: null,
          targetType: 'FUNCTION',
          hasTest: false,
          testFilePaths: [],
        },
      ]);

      const result = await service.getTestInventory(version.id);

      expect(result).toMatchObject({
        detectedFramework: 'JEST',
        targetsTotal: 2,
        targetsWithTest: 1,
        targetsMissingTest: 1,
      });
      expect(result.targets).toHaveLength(2);
    });
  });
});
