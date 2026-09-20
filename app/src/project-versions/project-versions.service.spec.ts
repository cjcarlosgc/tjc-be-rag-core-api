import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectVersionsService } from './project-versions.service.js';
import { ErrorCode } from '../common/errors/error-code.enum.js';
import type { Project, ProjectVersion } from '../generated/prisma/client.js';

const OWNER_USER_ID = 'user-1';

describe('ProjectVersionsService', () => {
  let service: ProjectVersionsService;
  let projectsRepository: { findById: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let projectVersionsRepository: {
    findByIdForOwner: ReturnType<typeof vi.fn>;
    findByProject: ReturnType<typeof vi.fn>;
  };
  let testTargetsRepository: { findByProjectVersion: ReturnType<typeof vi.fn> };

  const project: Project = {
    id: 'project-1',
    name: 'demo',
    ownerUserId: OWNER_USER_ID,
    currentVersionId: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const version: ProjectVersion = {
    id: 'version-1',
    projectId: 'project-1',
    status: 'PENDING',
    originalFileName: null,
    sizeBytes: null,
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

  beforeEach(() => {
    projectsRepository = { findById: vi.fn(), create: vi.fn() };
    projectVersionsRepository = {
      findByIdForOwner: vi.fn(),
      findByProject: vi.fn(),
    };
    testTargetsRepository = { findByProjectVersion: vi.fn().mockResolvedValue([]) };

    service = new ProjectVersionsService(
      projectsRepository as never,
      projectVersionsRepository as never,
      testTargetsRepository as never,
    );
  });

  describe('getStatus', () => {
    it('throws PROJECT_VERSION_NOT_FOUND when the version does not exist or belongs to another owner', async () => {
      projectVersionsRepository.findByIdForOwner.mockResolvedValue(null);

      await expect(service.getStatus('missing', OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.PROJECT_VERSION_NOT_FOUND,
      });
      expect(projectVersionsRepository.findByIdForOwner).toHaveBeenCalledWith('missing', OWNER_USER_ID);
    });

    it('returns the serialized version', async () => {
      projectVersionsRepository.findByIdForOwner.mockResolvedValue(version);

      const result = await service.getStatus(version.id, OWNER_USER_ID);

      expect(result.id).toBe(version.id);
      expect(result.status).toBe('PENDING');
    });
  });

  describe('getResults', () => {
    it('throws ANALYSIS_NOT_FINISHED when the version has not completed', async () => {
      projectVersionsRepository.findByIdForOwner.mockResolvedValue(version);

      await expect(service.getResults(version.id, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.ANALYSIS_NOT_FINISHED,
      });
    });

    it('returns the results summary once completed', async () => {
      projectVersionsRepository.findByIdForOwner.mockResolvedValue({
        ...version,
        status: 'COMPLETED',
        filesProcessed: 3,
        chunksCount: 7,
        detectedFramework: 'VITEST',
        targetsTotal: 5,
        targetsWithTest: 2,
        completedAt: new Date('2026-01-01T00:00:00.000Z'),
      } satisfies ProjectVersion);

      const result = await service.getResults(version.id, OWNER_USER_ID);

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
      projectVersionsRepository.findByIdForOwner.mockResolvedValue(version);

      await expect(service.getTestInventory(version.id, OWNER_USER_ID)).rejects.toMatchObject({
        code: ErrorCode.ANALYSIS_NOT_FINISHED,
      });
    });

    it('returns the target list and summary once completed', async () => {
      projectVersionsRepository.findByIdForOwner.mockResolvedValue({
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

      const result = await service.getTestInventory(version.id, OWNER_USER_ID);

      expect(result).toMatchObject({
        detectedFramework: 'JEST',
        targetsTotal: 2,
        targetsWithTest: 1,
        targetsMissingTest: 1,
      });
      expect(result.targets).toHaveLength(2);
    });
  });

  describe('listVersions (HU25)', () => {
    it('throws PROJECT_NOT_FOUND when the project does not exist or belongs to another owner', async () => {
      projectsRepository.findById.mockResolvedValue(null);

      await expect(
        service.listVersions('missing', undefined, undefined, OWNER_USER_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.PROJECT_NOT_FOUND,
      });
      expect(projectsRepository.findById).toHaveBeenCalledWith('missing', OWNER_USER_ID);
    });

    it('requests one extra row to detect a next page and strips it from the returned items', async () => {
      projectsRepository.findById.mockResolvedValue({ ...project, currentVersionId: 'version-3' });
      projectVersionsRepository.findByProject.mockResolvedValue([
        { ...version, id: 'version-3' },
        { ...version, id: 'version-2' },
        { ...version, id: 'version-1' },
      ]);

      const page = await service.listVersions(project.id, 2, undefined, OWNER_USER_ID);

      expect(projectVersionsRepository.findByProject).toHaveBeenCalledWith(project.id, 2, undefined);
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id)).toEqual(['version-3', 'version-2']);
      expect(page.nextCursor).toBe('version-2');
    });

    it('marks only the project.currentVersionId as current', async () => {
      projectsRepository.findById.mockResolvedValue({ ...project, currentVersionId: 'version-2' });
      projectVersionsRepository.findByProject.mockResolvedValue([
        { ...version, id: 'version-2' },
        { ...version, id: 'version-1' },
      ]);

      const page = await service.listVersions(project.id, 20, undefined, OWNER_USER_ID);

      expect(page.items.find((item) => item.id === 'version-2')?.current).toBe(true);
      expect(page.items.find((item) => item.id === 'version-1')?.current).toBe(false);
    });

    it('computes targetsMissingTest and returns null when totals are not yet known', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      projectVersionsRepository.findByProject.mockResolvedValue([
        { ...version, id: 'version-2', targetsTotal: 5, targetsWithTest: 2 },
        { ...version, id: 'version-1', targetsTotal: null, targetsWithTest: null },
      ]);

      const page = await service.listVersions(project.id, 20, undefined, OWNER_USER_ID);

      expect(page.items[0]).toMatchObject({ targetsTotal: 5, targetsWithTest: 2, targetsMissingTest: 3 });
      expect(page.items[1]).toMatchObject({ targetsTotal: null, targetsWithTest: null, targetsMissingTest: null });
    });

    it('returns nextCursor null when there is no further page', async () => {
      projectsRepository.findById.mockResolvedValue(project);
      projectVersionsRepository.findByProject.mockResolvedValue([version]);

      const page = await service.listVersions(project.id, 20, undefined, OWNER_USER_ID);

      expect(page.nextCursor).toBeNull();
    });
  });
});
