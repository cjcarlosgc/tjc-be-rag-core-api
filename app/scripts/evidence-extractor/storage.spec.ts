// WI-CORE-094 (SEC-04a, SEC-07): el descargador solo puede llamar a `storage.from(bucket).download`. Un cliente falso
// tipo Proxy falla ante cualquier otra propiedad, así que una llamada a `remove`, `createBucket`, `list`... no pasa.
import { describe, expect, it } from 'vitest';
import { createSupabaseDownloader } from './storage.mjs';

function downloadOnlyClient(behavior: { data?: unknown; error?: unknown }) {
  const touched: string[] = [];
  const bucketApi = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(`bucket.${String(property)}`);
        if (property === 'download') {
          return async () => ({ data: behavior.data ?? null, error: behavior.error ?? null });
        }
        throw new Error(`método no permitido: ${String(property)}`);
      },
    },
  );
  const storage = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(`storage.${String(property)}`);
        if (property === 'from') return () => bucketApi;
        throw new Error(`método no permitido: ${String(property)}`);
      },
    },
  );
  const client = new Proxy(
    {},
    {
      get(_target, property) {
        touched.push(`client.${String(property)}`);
        if (property === 'storage') return storage;
        throw new Error(`propiedad no permitida: ${String(property)}`);
      },
    },
  );
  return { client, touched, factory: () => client };
}

function blobOf(bytes: Buffer) {
  return { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) };
}

describe('createSupabaseDownloader', () => {
  it('descarga con storage.from(bucket).download y no toca ningún otro método', async () => {
    const bytes = Buffer.from('<?php\n', 'utf8');
    const fake = downloadOnlyClient({ data: blobOf(bytes) });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      createSupabaseClient: fake.factory as never,
    });

    const result = await downloader.download('analysis-runs/r1/proposals/p1');

    expect(result).toEqual({ ok: true, bytes });
    expect(fake.touched).toEqual(['client.storage', 'storage.from', 'bucket.download']);
  });

  it('nunca llama a remove ni a createBucket: el intento se registra como error', async () => {
    const fake = downloadOnlyClient({ data: blobOf(Buffer.from('x')) });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      createSupabaseClient: fake.factory as never,
    });
    // Un cliente que aceptara `remove` antes de descargar no pasaría la comprobación de `touched`.
    await downloader.download('analysis-runs/r1/proposals/p1');
    expect(fake.touched.some((entry) => /remove|createBucket|list/.test(entry))).toBe(false);
  });

  it('clasifica no encontrado sin repetir el texto del proveedor', async () => {
    const fake = downloadOnlyClient({ error: { statusCode: '404', message: 'Object not found en https://secreto.example' } });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      createSupabaseClient: fake.factory as never,
    });
    const result = await downloader.download('analysis-runs/r1/proposals/p1');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(JSON.stringify(result)).not.toContain('secreto.example');
  });

  it('un error genérico no devuelve el mensaje del proveedor', async () => {
    const fake = downloadOnlyClient({ error: { statusCode: '500', message: 'filtrado: clave-de-prueba' } });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      createSupabaseClient: fake.factory as never,
    });
    const result = await downloader.download('analysis-runs/r1/proposals/p1');
    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(JSON.stringify(result)).not.toContain('clave-de-prueba');
  });

  it('aplica el tope de tamaño al Blob antes de bufferizar: un objeto mayor es too_large', async () => {
    let buffered = false;
    const big = {
      size: 11,
      arrayBuffer: async () => {
        buffered = true;
        return new ArrayBuffer(11);
      },
    };
    const fake = downloadOnlyClient({ data: big });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      maxBytes: 10,
      createSupabaseClient: fake.factory as never,
    });
    expect(await downloader.download('analysis-runs/r1/proposals/p1')).toEqual({ ok: false, reason: 'too_large' });
    expect(buffered).toBe(false);
  });

  it('si el Blob no informa tamaño, el tope se comprueba tras leer', async () => {
    const bytes = Buffer.alloc(11, 1);
    const fake = downloadOnlyClient({ data: { arrayBuffer: async () => bytes.buffer } });
    const downloader = createSupabaseDownloader({
      url: 'https://proyecto.example.test',
      secretKey: 'clave-de-prueba',
      bucket: 'evidencia',
      maxBytes: 10,
      createSupabaseClient: fake.factory as never,
    });
    expect(await downloader.download('analysis-runs/r1/proposals/p1')).toEqual({ ok: false, reason: 'too_large' });
  });
});
