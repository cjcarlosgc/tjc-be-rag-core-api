export interface JobHandler<TPayload = unknown> {
  readonly type: string;
  handle(payload: TPayload, jobId: string): Promise<void>;
  /**
   * Gancho de cierre opcional (WI-CORE-030, DEC-JOBS-001): el job quedó FAILED terminal (agotó
   * `maxAttempts`) por una liberación de lock obsoleto o por un fallo, con o sin ejecución de
   * `handle()`. Permite cerrar la entidad de dominio. No reprograma ni reejecuta; sus errores se
   * registran sin interrumpir el barrido de la cola.
   */
  onExhausted?(payload: TPayload, reason: string): Promise<void>;
}
