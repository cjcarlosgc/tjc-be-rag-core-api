// WI-CORE-094: lectura de Object Storage (Supabase) SOLO con `download`. No reutiliza `SupabaseObjectStorageAdapter`
// del producto, que crea el bucket si falta. Las credenciales llegan del entorno del operador; este módulo nunca
// las imprime ni las devuelve en resultados o errores.
//
// Límite de tamaño: el SDK no permite conocer el tamaño antes de descargar sin `list`/HEAD, que no se usan. Por eso
// el tope se aplica al Blob recibido, ANTES de bufferizarlo en memoria. La transferencia ya ha ocurrido en ese punto.
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_STORAGE_MAX_BYTES } from './options.mjs';

export { DEFAULT_STORAGE_MAX_BYTES };

/**
 * Crea un descargador de objetos. Devuelve `{ ok: true, bytes }` o `{ ok: false, reason }`, donde `reason` es
 * `not_found`, `too_large` o `error`. Nunca repite el texto del proveedor.
 */
export function createSupabaseDownloader({
  url,
  secretKey,
  bucket,
  maxBytes = DEFAULT_STORAGE_MAX_BYTES,
  createSupabaseClient = createClient,
}) {
  const client = createSupabaseClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    bucket,
    maxBytes,
    async download(key) {
      try {
        const { data, error } = await client.storage.from(bucket).download(key);
        if (error || !data) {
          const status = String(error?.statusCode ?? '');
          const notFound = status === '404' || /not\s*found/i.test(String(error?.message ?? ''));
          return { ok: false, reason: notFound ? 'not_found' : 'error' };
        }
        if (typeof data.size === 'number' && data.size > maxBytes) return { ok: false, reason: 'too_large' };
        const bytes = Buffer.from(await data.arrayBuffer());
        if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' };
        return { ok: true, bytes };
      } catch {
        return { ok: false, reason: 'error' };
      }
    },
  };
}
