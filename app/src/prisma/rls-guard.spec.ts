import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guardia de seguridad de datos (HU62): la Data API de Supabase (PostgREST) expone
// el schema `public` a la clave pública. Toda tabla de `schema.prisma` debe habilitar
// RLS en alguna migración; una tabla nueva sin RLS rompe el build.
const prismaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma');

function schemaTables(): string[] {
  const schema = readFileSync(join(prismaDir, 'schema.prisma'), 'utf8');
  const tables: string[] = [];
  for (const match of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const mapped = match[2].match(/@@map\("([^"]+)"\)/);
    tables.push(mapped ? mapped[1] : match[1]);
  }
  return tables;
}

function migrationsSql(): string {
  const migrationsDir = join(prismaDir, 'migrations');
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8'))
    .join('\n')
    .replace(/--.*$/gm, '');
}

describe('RLS en todas las tablas del schema (guardia Data API)', () => {
  const tables = schemaTables();
  const sql = migrationsSql();

  it('detecta las tablas del schema', () => {
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain('projects');
    expect(tables).toContain('user_github_identities');
  });

  it.each(tables)('la tabla %s habilita ROW LEVEL SECURITY en una migración', (table) => {
    const pattern = new RegExp(
      `ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?"?${table}"?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
      'i',
    );
    expect(
      pattern.test(sql),
      `Falta ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY en las migraciones`,
    ).toBe(true);
  });
});
