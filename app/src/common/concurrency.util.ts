/**
 * Aplica `worker` a cada elemento con a lo sumo `limit` ejecuciones simultáneas,
 * conservando el orden de `items` en el resultado. `worker` no debe lanzar: un
 * rechazo aborta el resultado como en `Promise.all`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}
