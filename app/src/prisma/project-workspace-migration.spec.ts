import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 014 (HU63, corte 2): el workspace de un Project es o personal (ambas columnas
// nulas) o una organización (ambas presentes). Prisma no declara check
// constraints, así que la migración SQL es la única fuente: esta prueba fija su
// forma y la coherencia con `schema.prisma`. Además se validó contra un
// PostgreSQL local descartable (ver evidencia del work item).
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');
const migration = readFileSync(
  join(prismaDir, 'migrations', '20260921140000_project_workspace_columns', 'migration.sql'),
  'utf8',
).replace(/--.*$/gm, '');
const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
const projectModel = /^model Project \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? '';

/** Evaluador mínimo del predicado SQL `(a IS NULL) = (b IS NULL)` para documentar los casos. */
const coherent = (orgId: string | null, orgLogin: string | null): boolean => (orgId === null) === (orgLogin === null);

describe('migración de columnas de workspace de projects', () => {
  it('agrega ambas columnas nullable de texto y el índice por githubOrgId, sin backfill', () => {
    expect(migration).toMatch(/ALTER TABLE "projects" ADD COLUMN\s+"githubOrgId" TEXT,\s+ADD COLUMN\s+"githubOrgLogin" TEXT;/);
    expect(migration).toMatch(/CREATE INDEX "projects_githubOrgId_idx" ON "projects"\("githubOrgId"\);/);
    expect(migration).not.toMatch(/\bUPDATE\b|\bINSERT\b|NOT NULL/i);
  });

  it('declara el check que exige ambas nulas o ambas presentes', () => {
    expect(migration).toMatch(
      /ALTER TABLE "projects" ADD CONSTRAINT "projects_github_org_coherence_check"\s+CHECK \(\("githubOrgId" IS NULL\) = \("githubOrgLogin" IS NULL\)\);/,
    );
  });

  it('acepta personal (ambas nulas) y organización (ambas presentes) y rechaza una sola', () => {
    expect(coherent(null, null)).toBe(true);
    expect(coherent('42', 'acme')).toBe(true);
    expect(coherent('42', null)).toBe(false);
    expect(coherent(null, 'acme')).toBe(false);
  });

  it('schema.prisma declara las mismas columnas nullable y el mismo índice', () => {
    expect(projectModel).toMatch(/^\s*githubOrgId\s+String\?/m);
    expect(projectModel).toMatch(/^\s*githubOrgLogin\s+String\?/m);
    expect(projectModel).toMatch(/@@index\(\[githubOrgId\]\)/);
  });
});
