import { rm } from 'node:fs/promises';

/**
 * Elimina un directorio de trabajo temporal con reintentos y nunca lanza: una
 * limpieza fallida no debe reemplazar el resultado ni el error original del
 * flujo que la invoca. Si `rm` falla, registra un aviso sin la ruta ni el
 * mensaje crudo de la excepción (solo el código de error, si lo hay) y continúa.
 */
export async function removeWorkspaceDir(
  dir: string,
  logger?: { warn(message: string): void },
): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const detail = typeof code === 'string' ? ` (código ${code})` : '';
    logger?.warn(`No se pudo eliminar el directorio temporal de trabajo${detail}.`);
  }
}
