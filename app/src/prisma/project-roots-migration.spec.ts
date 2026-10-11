import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');
const migration = readFileSync(
  join(prismaDir, 'migrations', '20261011100000_project_roots', 'migration.sql'),
  'utf8',
).replace(/--.*$/gm, '');
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const projectModel = /^model Project \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';

describe('migración de raíces de proyecto', () => {
  it('backfillea la raíz histórica para Projects que ya tienen versión vigente', () => {
    expect(migration).toMatch(
      /UPDATE "projects"\s+SET "projectRoot" = '\.'\s+WHERE "currentVersionId" IS NOT NULL;/,
    );
  });

  it('declara projectRoot nullable en Project, dejando null para Projects sin versión vigente', () => {
    expect(migration).toMatch(/ALTER TABLE "projects"\s+ADD COLUMN "projectRoot" TEXT;/);
    expect(projectModel).toMatch(/^\s*projectRoot\s+String\?/m);
  });

  it('conserva la raíz histórica de ProjectVersion para versiones preexistentes', () => {
    expect(migration).toMatch(
      /ALTER TABLE "project_versions"\s+ADD COLUMN "effectiveProjectRoot" TEXT NOT NULL DEFAULT '\.'/,
    );
  });
});
