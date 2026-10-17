import type { Prisma } from '../generated/prisma/client.js';

/**
 * Un handler la lanza para devolver su job a `PENDING` a los `delayMs` SIN consumir un
 * intento ni contarlo como fallo (p. ej. GitHub no verificable: se reintenta con backoff
 * en lugar de agotar `maxAttempts`). `payload` reemplaza el del job (contador del backoff).
 */
export class RescheduleJobError extends Error {
  constructor(
    readonly delayMs: number,
    readonly reason: string,
    readonly payload?: Prisma.InputJsonValue,
  ) {
    super(reason);
    this.name = 'RescheduleJobError';
  }
}
