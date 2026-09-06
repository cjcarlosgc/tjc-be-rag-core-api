import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Cada archivo levanta su propia app Nest con JobsService pollando la
    // misma tabla "jobs" real de Postgres (no scoped por proceso de test);
    // correr archivos e2e en paralelo permite que el poller de un archivo
    // reclame jobs encolados por otro, cuyo storage en memoria (fake) es
    // distinto -> "Objeto no encontrado". Se fuerza ejecución secuencial.
    fileParallelism: false,
  },
});
