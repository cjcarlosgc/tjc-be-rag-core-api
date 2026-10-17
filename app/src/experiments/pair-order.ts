import { createHash, randomBytes } from 'node:crypto';
import { uuidV5 } from '../common/uuid-v5.util.js';

/**
 * WI-CORE-025 (HU17, OE5 pareado): módulo puro de orden y de identidad de pares.
 * Sin efectos ni dependencias de persistencia.
 */

/** Namespace URL de RFC 4122 (mismo valor fijado por DEC-IDEMP-001). */
export const EXPERIMENT_PAIR_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

export const EXPERIMENT_STRATEGIES = ['RAG', 'GENERALIST_AGENT'] as const;
export type PairStrategy = (typeof EXPERIMENT_STRATEGIES)[number];

/** Semilla de aleatorización: 32 bytes aleatorios en hexadecimal (64 caracteres). */
export function generateRandomizationSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Orden de las dos estrategias dentro del par `i` (1..3) para la semilla dada.
 * digest = SHA-256(utf8(seed + ':' + i)); readUInt32BE(0) % 2 === 0 => [RAG, GENERALIST_AGENT];
 * en otro caso el orden inverso. La posición 1 es la primera en ejecutarse.
 */
export function pairOrder(seed: string, i: number): [PairStrategy, PairStrategy] {
  const digest = createHash('sha256').update(Buffer.from(`${seed}:${i}`, 'utf8')).digest();
  return digest.readUInt32BE(0) % 2 === 0
    ? ['RAG', 'GENERALIST_AGENT']
    : ['GENERALIST_AGENT', 'RAG'];
}

/** UUID v5 estable del par `i` de un experimento; igual para ambas estrategias y ante redelivery. */
export function experimentPairId(experimentId: string, i: number): string {
  return uuidV5(EXPERIMENT_PAIR_NAMESPACE, `urn:tjc:experiment-pair:v1:${experimentId}:${i}`);
}
