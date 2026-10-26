import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CodeChunksRepository, PhpDeclarationQueryLimitError } from './code-chunks.repository.js';

/**
 * WI-CORE-106: `findPhpTypeDeclarationParts` y `findPhpMethodDeclarations` contra un PostgreSQL LOCAL descartable
 * con las migraciones aplicadas. Sin `CT_TEST_DATABASE_URL` se omite; la URL debe apuntar a localhost. Cada caso usa
 * versiones y símbolos únicos y al final borra solo las filas que creó, en orden de FK.
 *
 *   CT_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55439/rag_core_ct?schema=public npx vitest run src/project-versions/persistence/code-chunks.repository.php-hierarchy.pg.spec.ts
 */
const url = process.env.CT_TEST_DATABASE_URL;
const isLocal = url !== undefined && /@(127\.0\.0\.1|localhost)[:/]/.test(url);

describe.skipIf(!url)('CodeChunksRepository: jerarquía PHP contra PostgreSQL real (WI-CORE-106)', () => {
  let prisma: PrismaClient;
  let chunks: CodeChunksRepository;
  const projectIds: string[] = [];
  const versionIds: string[] = [];

  beforeAll(() => {
    if (!isLocal) {
      throw new Error('CT_TEST_DATABASE_URL debe apuntar a localhost.');
    }
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url as string }) });
    chunks = new CodeChunksRepository(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.codeChunk.deleteMany({ where: { projectVersionId: { in: versionIds } } });
    await prisma.projectVersion.deleteMany({ where: { id: { in: versionIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.$disconnect();
  });

  async function createVersion(): Promise<string> {
    const project = await prisma.project.create({ data: { name: `php-hierarchy-${randomUUID()}` } });
    projectIds.push(project.id);
    const version = await prisma.projectVersion.create({ data: { projectId: project.id } });
    versionIds.push(version.id);
    return version.id;
  }

  async function insert(
    projectVersionId: string,
    data: {
      filePath: string;
      symbolKind: string;
      symbolName: string | null;
      parentSymbolName?: string | null;
      content: string;
      partIndex?: number;
      importsUsed?: string[];
    },
  ): Promise<void> {
    await prisma.codeChunk.create({
      data: {
        projectVersionId,
        filePath: data.filePath,
        symbolKind: data.symbolKind,
        symbolName: data.symbolName,
        parentSymbolName: data.parentSymbolName ?? null,
        startLine: 1,
        endLine: 2,
        content: data.content,
        importsUsed: data.importsUsed ?? [],
        partIndex: data.partIndex ?? 1,
        partsTotal: 3,
      },
    });
  }

  it('findPhpTypeDeclarationParts: filtra por versión y .php, ordena por partIndex y omite símbolos ambiguos', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const big = `Pg${suffix}\\BigInterface`;
    const dupFiles = `Pg${suffix}\\DupFiles`;
    const dupKinds = `Pg${suffix}\\DupKinds`;
    const plain = `Pg${suffix}\\Plain`;
    const versionA = await createVersion();
    const versionB = await createVersion();

    // Partes insertadas fuera de orden a propósito.
    await insert(versionA, { filePath: 'src/Big.php', symbolKind: 'INTERFACE', symbolName: big, content: 'tres', partIndex: 3 });
    await insert(versionA, { filePath: 'src/Big.php', symbolKind: 'INTERFACE', symbolName: big, content: 'uno', partIndex: 1, importsUsed: ['Pg\\Dep'] });
    await insert(versionA, { filePath: 'src/Big.php', symbolKind: 'INTERFACE', symbolName: big, content: 'dos', partIndex: 2 });
    await insert(versionA, { filePath: 'src/Plain.php', symbolKind: 'CLASS', symbolName: plain, content: 'class Plain {' });
    // Ambiguo: el mismo FQCN en dos archivos .php.
    await insert(versionA, { filePath: 'src/DupFiles.php', symbolKind: 'CLASS', symbolName: dupFiles, content: 'class A {' });
    await insert(versionA, { filePath: 'src/Other/DupFiles.php', symbolKind: 'CLASS', symbolName: dupFiles, content: 'class B {' });
    // Ambiguo: el mismo FQCN con dos tipos de símbolo.
    await insert(versionA, { filePath: 'src/DupKinds.php', symbolKind: 'CLASS', symbolName: dupKinds, content: 'class A {' });
    await insert(versionA, { filePath: 'src/DupKinds.php', symbolKind: 'INTERFACE', symbolName: dupKinds, content: 'interface A {' });
    // No son chunks de tipo PHP: un METHOD y un chunk de un archivo .ts con el mismo nombre.
    await insert(versionA, { filePath: 'src/Method.php', symbolKind: 'METHOD', symbolName: plain, content: 'public function plain() {}' });
    await insert(versionA, { filePath: 'src/plain.ts', symbolKind: 'CLASS', symbolName: big, content: 'export class Big {}' });
    // La otra versión tiene los mismos símbolos con otro contenido: nunca debe aparecer.
    await insert(versionB, { filePath: 'src/Big.php', symbolKind: 'INTERFACE', symbolName: big, content: 'OTRA VERSION', partIndex: 1 });
    await insert(versionB, { filePath: 'src/Plain.php', symbolKind: 'CLASS', symbolName: plain, content: 'OTRA VERSION' });

    const parts = await chunks.findPhpTypeDeclarationParts(versionA, [big, plain, dupFiles, dupKinds]);

    expect(parts.map((part) => [part.symbolName, part.partIndex, part.content])).toEqual([
      [big, 1, 'uno'],
      [big, 2, 'dos'],
      [big, 3, 'tres'],
      [plain, 1, 'class Plain {'],
    ]);
    expect(parts[0]).toMatchObject({ symbolKind: 'INTERFACE', importsUsed: ['Pg\\Dep'] });
    expect(parts.find((part) => part.symbolName === plain)?.symbolKind).toBe('CLASS');

    const other = await chunks.findPhpTypeDeclarationParts(versionB, [big, plain]);
    expect(other.map((part) => part.content)).toEqual(['OTRA VERSION', 'OTRA VERSION']);
    await expect(chunks.findPhpTypeDeclarationParts(versionA, [])).resolves.toEqual([]);
  });

  it('findPhpTypeDeclarationParts: al alcanzar el tope lanza PhpDeclarationQueryLimitError y por debajo devuelve todo', async () => {
    const symbol = `Pg${randomUUID().replace(/-/g, '').slice(0, 8)}\\Limited`;
    const version = await createVersion();
    for (const partIndex of [1, 2, 3, 4, 5]) {
      await insert(version, { filePath: 'src/Limited.php', symbolKind: 'CLASS', symbolName: symbol, content: `parte ${partIndex}`, partIndex });
    }

    await expect(chunks.findPhpTypeDeclarationParts(version, [symbol], 5)).rejects.toBeInstanceOf(PhpDeclarationQueryLimitError);
    const all = await chunks.findPhpTypeDeclarationParts(version, [symbol], 6);
    expect(all.map((part) => part.partIndex)).toEqual([1, 2, 3, 4, 5]);
  });

  it('findPhpMethodDeclarations: solo METHOD y CONSTRUCTOR parte 1 de .php de la versión pedida, sin ambiguos', async () => {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 8);
    const owner = `Pg${suffix}\\Owner`;
    const ambiguous = `Pg${suffix}\\Ambiguous`;
    const versionA = await createVersion();
    const versionB = await createVersion();

    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'METHOD', symbolName: `${owner}::run`, parentSymbolName: owner, content: 'public function run(): void {}' });
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'CONSTRUCTOR', symbolName: `${owner}::__construct`, parentSymbolName: owner, content: 'public function __construct() {}' });
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'METHOD', symbolName: `${owner}::hook`, parentSymbolName: owner, content: 'abstract protected function hook(): void;' });
    // Parte 2 de un método grande: no es la declaración.
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'METHOD', symbolName: `${owner}::long`, parentSymbolName: owner, content: 'public function long() { /* parte 1 */', partIndex: 1 });
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'METHOD', symbolName: `${owner}::long`, parentSymbolName: owner, content: 'return 1; }', partIndex: 2 });
    // Otros tipos de símbolo con el mismo padre y un archivo .ts: no se devuelven.
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'CLASS', symbolName: owner, parentSymbolName: owner, content: 'class Owner {' });
    await insert(versionA, { filePath: 'src/Owner.php', symbolKind: 'FUNCTION', symbolName: 'helper', parentSymbolName: owner, content: 'function helper() {}' });
    await insert(versionA, { filePath: 'src/owner.ts', symbolKind: 'METHOD', symbolName: `${owner}::ts`, parentSymbolName: owner, content: 'run() {}' });
    // Ambiguo: métodos del mismo padre en dos archivos.
    await insert(versionA, { filePath: 'src/Ambiguous.php', symbolKind: 'METHOD', symbolName: `${ambiguous}::a`, parentSymbolName: ambiguous, content: 'public function a() {}' });
    await insert(versionA, { filePath: 'src/Other/Ambiguous.php', symbolKind: 'METHOD', symbolName: `${ambiguous}::b`, parentSymbolName: ambiguous, content: 'public function b() {}' });
    // Otra versión con el mismo padre.
    await insert(versionB, { filePath: 'src/Owner.php', symbolKind: 'METHOD', symbolName: `${owner}::run`, parentSymbolName: owner, content: 'OTRA VERSION' });

    const methods = await chunks.findPhpMethodDeclarations(versionA, [owner, ambiguous]);

    expect(methods.map((method) => method.content).sort()).toEqual(
      [
        'abstract protected function hook(): void;',
        'public function __construct() {}',
        'public function long() { /* parte 1 */',
        'public function run(): void {}',
      ].sort(),
    );
    expect(methods.every((method) => method.parentSymbolName === owner)).toBe(true);

    const other = await chunks.findPhpMethodDeclarations(versionB, [owner]);
    expect(other.map((method) => method.content)).toEqual(['OTRA VERSION']);
    await expect(chunks.findPhpMethodDeclarations(versionA, [])).resolves.toEqual([]);
  });

  it('findPhpMethodDeclarations: al alcanzar el tope lanza PhpDeclarationQueryLimitError y por debajo devuelve todo', async () => {
    const owner = `Pg${randomUUID().replace(/-/g, '').slice(0, 8)}\\Limited`;
    const version = await createVersion();
    for (const name of ['a', 'b', 'c', 'd']) {
      await insert(version, { filePath: 'src/Limited.php', symbolKind: 'METHOD', symbolName: `${owner}::${name}`, parentSymbolName: owner, content: `public function ${name}() {}` });
    }

    await expect(chunks.findPhpMethodDeclarations(version, [owner], 4)).rejects.toBeInstanceOf(PhpDeclarationQueryLimitError);
    const all = await chunks.findPhpMethodDeclarations(version, [owner], 5);
    expect(all.map((method) => method.symbolName)).toEqual([`${owner}::a`, `${owner}::b`, `${owner}::c`, `${owner}::d`]);
  });
});
