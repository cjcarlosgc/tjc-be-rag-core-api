// WI-CORE-105: manifiesto del snapshot con ZIP reales construidos en memoria con adm-zip (sin disco ni red).
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import {
  MAX_ENTRY_BYTES,
  buildSnapshotManifest,
  isSafeArchivePath,
  isSnapshotManifestError,
} from './snapshot-manifest.mjs';
import { sha256Hex } from './util.mjs';

const KEY = 'project-versions/pv-1/snapshot.zip';
const ARGS = { projectVersionId: 'pv-1', key: KEY };

function zipOf(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

/** adm-zip sanea los nombres al añadir: se renombra después, con la misma longitud, sobre los bytes del ZIP. */
function renameBytes(zip: Buffer, renames: Record<string, string>): Buffer {
  let text = zip.toString('latin1');
  for (const [from, to] of Object.entries(renames)) {
    if (from.length !== to.length) throw new Error('el renombrado exige la misma longitud');
    text = text.split(from).join(to);
  }
  return Buffer.from(text, 'latin1');
}

/** Cambia el tamaño sin comprimir DECLARADO en el directorio central (offset 24) de la entrada con ese nombre. */
function declareSize(zip: Buffer, name: string, size: number): Buffer {
  const copy = Buffer.from(zip);
  for (let offset = 0; offset + 46 <= copy.length; offset += 1) {
    if (copy.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = copy.readUInt16LE(offset + 28);
    if (copy.toString('utf8', offset + 46, offset + 46 + nameLength) === name) copy.writeUInt32LE(size, offset + 24);
  }
  return copy;
}

describe('buildSnapshotManifest', () => {
  it('lista ruta, bytes y SHA-256 por entrada, con totales, conteo por extensión y datos del ZIP', () => {
    const zipBytes = zipOf({
      'src/Money.php': '<?php\nfinal class Money {}\n',
      'composer.json': '{"name":"a/b"}\n',
      'examples/rbac_model.conf': '[request_definition]\n',
      'LICENSE': 'MIT',
      '.gitignore': 'vendor/\n',
    });
    const manifest = buildSnapshotManifest(zipBytes, ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(manifest.schema).toBe('snapshot-manifest');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.key).toBe(KEY);
    expect(manifest.projectVersionId).toBe('pv-1');
    expect(manifest.zipBytes).toBe(zipBytes.length);
    expect(manifest.zipSha256).toBe(sha256Hex(zipBytes));
    const money = '<?php\nfinal class Money {}\n';
    expect(manifest.entries).toContainEqual({ path: 'src/Money.php', bytes: Buffer.byteLength(money), sha256: sha256Hex(Buffer.from(money)) });
    expect(manifest.entryCount).toBe(5);
    expect(manifest.totalUncompressedBytes).toBe(manifest.entries.reduce((sum: number, entry: { bytes: number }) => sum + entry.bytes, 0));
    expect(manifest.byExtension).toEqual({ php: 1, json: 1, conf: 1, '(sin extensión)': 2 });
    expect(manifest.skipped).toEqual([]);
  });

  it('ordena las entradas por ruta y es determinista', () => {
    const zipBytes = zipOf({ 'b.php': 'b', 'a/z.php': 'z', 'a/b.php': 'ab', 'A.php': 'A' });
    const first = buildSnapshotManifest(zipBytes, ARGS);
    const second = buildSnapshotManifest(zipBytes, ARGS);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (isSnapshotManifestError(first)) throw new Error('no debía fallar');
    expect(first.entries.map((entry: { path: string }) => entry.path)).toEqual(['A.php', 'a/b.php', 'a/z.php', 'b.php']);
  });

  it('las entradas de directorio no cuentan', () => {
    const zip = new AdmZip();
    zip.addFile('src/', Buffer.alloc(0));
    zip.addFile('src/a.php', Buffer.from('a'));
    const manifest = buildSnapshotManifest(zip.toBuffer(), ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(manifest.entries.map((entry: { path: string }) => entry.path)).toEqual(['src/a.php']);
    expect(manifest.entryCount).toBe(1);
  });

  it('una ruta insegura no se lista ni se descomprime: va a skipped con unsafe_path', () => {
    const raw = zipOf({
      'ok/a.php': 'a',
      'XX/evil.php': 'x',
      'zabs.php': 'x',
      'win_x.php': 'x',
      'C_/x.php': 'x',
      'a/Xb.php': 'x',
      'a/x.php': 'x',
      'a/q/b': 'x',
    });
    const bytes = renameBytes(raw, {
      'a/x.php': './x.php',
      'a/q/b': 'a/./b',
      'XX/evil.php': '../evil.php',
      'zabs.php': '/abs.php',
      'win_x.php': 'win\\x.php',
      'C_/x.php': 'C:/x.php',
      'a/Xb.php': 'a//b.php',
    });
    const manifest = buildSnapshotManifest(bytes, ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(manifest.entries.map((entry: { path: string }) => entry.path)).toEqual(['ok/a.php']);
    expect(manifest.skipped.map((item: { reason: string }) => item.reason)).toEqual(Array(7).fill('unsafe_path'));
    expect(manifest.skipped.map((item: { path: string }) => item.path).sort()).toEqual(['../evil.php', '/abs.php', 'C:/x.php', 'a//b.php', 'win\\x.php', './x.php', 'a/./b'].sort());
    expect(JSON.stringify(manifest.entries)).not.toContain('evil');
  });

  it('un nombre como a/..b.php es una ruta segura (solo un segmento exacto ".." es inseguro)', () => {
    expect(isSafeArchivePath('a/..b.php')).toBe(true);
    expect(isSafeArchivePath('a/../b.php')).toBe(false);
    expect(isSafeArchivePath('')).toBe(false);
    expect(isSafeArchivePath('/x')).toBe(false);
    expect(isSafeArchivePath('a\\b')).toBe(false);
    expect(isSafeArchivePath('a/\0b')).toBe(false);
    expect(isSafeArchivePath('a//b')).toBe(false);
    expect(isSafeArchivePath('./x.php')).toBe(false);
    expect(isSafeArchivePath('a/./b')).toBe(false);
    expect(isSafeArchivePath('a/.hidden/b')).toBe(true);
  });

  it('una entrada con tamaño declarado enorme se lista con sha256 null y too_large, sin descomprimirla', () => {
    const raw = zipOf({ 'big.bin': 'tiny', 'small.php': 'x' });
    const bytes = declareSize(raw, 'big.bin', MAX_ENTRY_BYTES + 1);
    const manifest = buildSnapshotManifest(bytes, ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(manifest.entries).toContainEqual({ path: 'big.bin', bytes: MAX_ENTRY_BYTES + 1, sha256: null });
    expect(manifest.entries.find((entry: { path: string }) => entry.path === 'small.php').sha256).toBe(sha256Hex(Buffer.from('x')));
    expect(manifest.skipped).toEqual([{ path: 'big.bin', reason: 'too_large' }]);
  });

  it('si el total declarado supera 256 MiB se detiene y declara total_too_large sin listar el resto', () => {
    const names = Array.from({ length: 20 }, (_, index) => `f${String(index).padStart(2, '0')}.bin`);
    let bytes = zipOf(Object.fromEntries(names.map((name) => [name, 'x'])));
    for (const name of names) bytes = declareSize(bytes, name, 17 * 1024 * 1024);
    const manifest = buildSnapshotManifest(bytes, ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    // 15 entradas de 17 MiB = 255 MiB caben; la 16.ª (272 MiB) detiene el recorrido.
    expect(manifest.entryCount).toBe(15);
    const stopped = manifest.skipped.filter((item: { reason: string }) => item.reason === 'total_too_large');
    expect(stopped).toHaveLength(5);
    expect(stopped.map((item: { path: string }) => item.path)).toEqual(names.slice(15));
    expect(manifest.entries.some((entry: { path: string }) => stopped.some((item: { path: string }) => item.path === entry.path))).toBe(false);
  });

  it('una ruta duplicada solo cuenta una vez', () => {
    const raw = zipOf({ 'aaa.php': 'primero', 'bbb.php': 'segundo' });
    const manifest = buildSnapshotManifest(renameBytes(raw, { 'bbb.php': 'aaa.php' }), ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(manifest.entryCount).toBe(1);
    expect(manifest.skipped).toEqual([{ path: 'aaa.php', reason: 'duplicate_path' }]);
  });

  it('un ZIP inválido o vacío devuelve { ok: false, reason: invalid_zip } sin lanzar', () => {
    for (const input of [Buffer.from('esto no es un zip'), Buffer.alloc(0), Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])]) {
      const result = buildSnapshotManifest(input, ARGS);
      expect(result).toEqual({ ok: false, reason: 'invalid_zip' });
      expect(isSnapshotManifestError(result)).toBe(true);
    }
  });

  it('un ZIP válido sin archivos produce un manifiesto vacío (no un error)', () => {
    const manifest = buildSnapshotManifest(new AdmZip().toBuffer(), ARGS);
    expect(isSnapshotManifestError(manifest)).toBe(false);
    expect(manifest).toMatchObject({ entryCount: 0, entries: [], byExtension: {}, skipped: [] });
  });

  it('una extensión como __proto__ no contamina el prototipo', () => {
    const manifest = buildSnapshotManifest(zipOf({ 'a.__proto__': 'x', 'b.php': 'y' }), ARGS);
    if (isSnapshotManifestError(manifest)) throw new Error('no debía fallar');
    expect(Object.keys(manifest.byExtension).sort()).toEqual(['__proto__', 'php']);
    expect(({} as Record<string, unknown>).php).toBeUndefined();
  });
});
