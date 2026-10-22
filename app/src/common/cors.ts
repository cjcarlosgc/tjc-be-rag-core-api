import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import { Logger } from '@nestjs/common';

/**
 * Orígenes permitidos de la Console. `CONSOLE_CORS_ORIGINS` es una lista separada por comas (origen exacto, sin
 * barra final). Sin valor se conserva el comportamiento abierto anterior y se avisa una vez, para no romper un
 * despliegue que aún no configuró la variable.
 */
export function parseConsoleCorsOrigins(raw: string | undefined): string[] | null {
  const origins = (raw ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => value.length > 0);
  return origins.length > 0 ? origins : null;
}

type OriginDelegate = NonNullable<CorsOptions['origin']> & ((origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => void);

/**
 * El aviso de CORS abierto es único en el proceso: HTTP (`main.ts`) y el gateway de socket.io llaman a esta
 * fábrica por separado, así que el flag vive a nivel de módulo y no por instancia (WI-CORE-074, F5).
 */
const corsLogger = new Logger('Cors');
let openCorsWarned = false;

/** Delegado de `origin` que lee la variable en cada petición y sirve tanto a HTTP como a socket.io. */
export function createConsoleCorsOrigin(read: () => string | undefined = () => process.env.CONSOLE_CORS_ORIGINS): OriginDelegate {
  return ((origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    const allowed = parseConsoleCorsOrigins(read());
    if (allowed === null) {
      if (!openCorsWarned) {
        openCorsWarned = true;
        corsLogger.warn('CONSOLE_CORS_ORIGINS no está configurada: CORS queda abierto a cualquier origen. Defínela en producción.');
      }
      callback(null, true);
      return;
    }
    // Sin cabecera Origin (servidor a servidor, curl, health checks) no hay navegador que proteger.
    callback(null, origin === undefined || allowed.includes(origin));
  }) as OriginDelegate;
}
