import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Matriz rol -> operación de `INTEROP-2.4` §6.13, copiada ruta por ruta. Es la referencia
 * contra la que se comparan las políticas realmente declaradas en el router (prueba de
 * matriz) y la que dirige la matriz e2e ruta x rol. `spec` es el fragmento literal (entre
 * comillas invertidas) tal como aparece en la fila del rol del contrato: una prueba lo
 * busca en `spec/contracts/interoperability-contract.md`, de modo que editar el contrato
 * sin actualizar esta matriz (o al revés) falla.
 */
export type ContractRole = 'PUBLIC' | 'NONE' | 'READER' | 'MAINTAINER' | 'ADMIN';
export type ContractRow = 'SIN_ROL' | 'READER' | 'MAINTAINER' | 'ADMIN';

export interface MatrixEntry {
  /** Método HTTP, o `WS` para el evento WebSocket. */
  method: string;
  /** Ruta del contrato con `{param}` (o el nombre del evento WebSocket). */
  path: string;
  role: ContractRole;
  /** Fragmento literal de la fila del contrato. */
  spec: string;
  /** `false` para rutas del contrato que Core aún no implementa (no hay ruta que clasificar). */
  implemented: boolean;
  /** Fila del contrato donde aparece (Sin rol / Reader / Maintainer / Admin). */
  row: ContractRow;
}

const entry = (
  row: ContractRow,
  method: string,
  path: string,
  spec: string,
  role: ContractRole,
  implemented = true,
): MatrixEntry => ({ method, path, role, spec, implemented, row });

export const INTEROP_ROLE_MATRIX: readonly MatrixEntry[] = [
  // Sin rol de Project (solo sesión GitHub válida) y sin sesión.
  entry('SIN_ROL', 'GET', '/workspaces', 'GET /workspaces', 'NONE'),
  entry('SIN_ROL', 'GET', '/integrations/github/repositories', 'GET /integrations/github/repositories', 'NONE'),
  entry('SIN_ROL', 'POST', '/integrations/github/repositories/verify-app-access', 'POST /integrations/github/repositories/verify-app-access', 'NONE'),
  entry('SIN_ROL', 'GET', '/integrations/github/repositories/{owner}/{repo}/branches', 'GET /integrations/github/repositories/{owner}/{repo}/branches', 'NONE'),
  entry('SIN_ROL', 'POST', '/projects', 'POST /projects', 'NONE'),
  entry('SIN_ROL', 'GET', '/health', 'GET /health', 'PUBLIC'),
  entry('SIN_ROL', 'POST', '/integrations/github/webhooks', 'POST /integrations/github/webhooks', 'PUBLIC'),
  // Reader.
  entry('READER', 'GET', '/projects', 'GET /projects', 'READER'),
  entry('READER', 'GET', '/projects/{projectId}', 'GET /projects/{projectId}', 'READER'),
  entry('READER', 'GET', '/projects/{projectId}/versions', 'GET /projects/{projectId}/versions', 'READER'),
  entry('READER', 'GET', '/project-versions/{id}', 'GET /project-versions/{id}', 'READER'),
  entry('READER', 'GET', '/project-versions/{id}/results', '.../results', 'READER'),
  entry('READER', 'GET', '/project-versions/{id}/test-inventory', '.../test-inventory', 'READER'),
  entry('READER', 'GET', '/projects/{projectId}/integrations/github', 'GET /projects/{projectId}/integrations/github', 'READER'),
  entry('READER', 'GET', '/projects/{projectId}/analysis-runs', 'GET /projects/{projectId}/analysis-runs', 'READER'),
  entry('READER', 'GET', '/analysis-runs', 'GET /analysis-runs', 'READER'),
  entry('READER', 'GET', '/analysis-runs/{id}', 'GET /analysis-runs/{id}', 'READER'),
  entry('READER', 'GET', '/action-required', 'GET /action-required', 'READER'),
  entry('READER', 'GET', '/analysis-runs/{id}/context-questions', 'GET /analysis-runs/{id}/context-questions', 'READER'),
  entry('READER', 'GET', '/projects/{projectId}/functional-knowledge', 'GET /projects/{projectId}/functional-knowledge', 'READER'),
  entry('READER', 'GET', '/analysis-runs/{id}/test-proposals', 'GET /analysis-runs/{id}/test-proposals', 'READER'),
  entry('READER', 'GET', '/test-publications/{id}', 'GET /test-publications/{id}', 'READER'),
  entry('READER', 'GET', '/experiments/{id}', 'GET /experiments/{id}', 'READER'),
  entry('READER', 'GET', '/experiments/{id}/results', '.../results', 'READER'),
  entry('READER', 'GET', '/analysis-runs/{id}/experiments', 'GET /analysis-runs/{id}/experiments', 'READER', false),
  entry('READER', 'GET', '/experiments/{id}/context-traces', 'GET /experiments/{id}/context-traces', 'READER'),
  entry('READER', 'GET', '/context-traces/{id}', 'GET /context-traces/{id}', 'READER'),
  entry('READER', 'GET', '/context-traces/{id}/discovered-files', '.../discovered-files', 'READER'),
  entry('READER', 'WS', 'subscribe:project-version', 'subscribe:project-version', 'READER'),
  // Maintainer.
  entry('MAINTAINER', 'POST', '/projects/{projectId}/integrations/github', 'POST /projects/{projectId}/integrations/github', 'MAINTAINER'),
  entry('MAINTAINER', 'POST', '/projects/{projectId}/integrations/github/enable', 'POST .../enable', 'MAINTAINER'),
  entry('MAINTAINER', 'DELETE', '/projects/{projectId}/integrations/github', 'DELETE .../integrations/github', 'MAINTAINER'),
  entry('MAINTAINER', 'POST', '/analysis-runs/{id}/context-questions/{questionId}/answers', 'POST /analysis-runs/{id}/context-questions/{questionId}/answers', 'MAINTAINER'),
  entry('MAINTAINER', 'POST', '/analysis-runs/{id}/test-publications', 'POST /analysis-runs/{id}/test-publications', 'MAINTAINER'),
  entry('MAINTAINER', 'POST', '/experiments', 'POST /experiments', 'MAINTAINER'),
  // Admin.
  entry('ADMIN', 'PATCH', '/projects/{projectId}', 'PATCH /projects/{projectId}', 'ADMIN'),
  entry('ADMIN', 'DELETE', '/projects/{projectId}', 'DELETE /projects/{projectId}', 'ADMIN'),
];

/**
 * Roles que una entrada puede declarar según la fila del contrato donde aparece. La fila "Sin rol
 * de Project" admite `NONE` (sesión GitHub válida) y `PUBLIC` (sin sesión); las demás filas son su rol.
 */
export const ROLES_OF_ROW: Record<ContractRow, readonly ContractRole[]> = {
  SIN_ROL: ['NONE', 'PUBLIC'],
  READER: ['READER'],
  MAINTAINER: ['MAINTAINER'],
  ADMIN: ['ADMIN'],
};

/**
 * `POST /projects` aparece en dos filas del contrato: "Sin rol de Project" (personal:
 * cualquiera) y "Admin" (`POST /projects` en una organización). En Core es una ruta sin rol
 * de Project cuyo servicio exige Admin de la organización en vivo (`WORKSPACE_ADMIN_REQUIRED`).
 */
export const SECOND_ROW_LISTINGS: ReadonlyArray<{ row: ContractRow; spec: string }> = [{ row: 'ADMIN', spec: 'POST /projects' }];

/** Normaliza `{param}` y `:param` a `{}` para comparar la forma de la ruta. */
export function normalizeRoutePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '{}').replace(/:[A-Za-z]+/g, '{}');
}

export function matrixKey(method: string, path: string): string {
  return `${method} ${normalizeRoutePath(path)}`;
}

const ROW_LABELS: Array<[RegExp, ContractRow]> = [
  [/^Sin rol de Project/, 'SIN_ROL'],
  [/^Reader$/, 'READER'],
  [/^Maintainer$/, 'MAINTAINER'],
  [/^Admin$/, 'ADMIN'],
];

/** Extrae de `INTEROP` §6.13 los fragmentos de operación de cada fila de la matriz. */
export function readContractMatrixRows(): Record<ContractRow, string[]> {
  const contract = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../spec/contracts/interoperability-contract.md'), 'utf8');
  const start = contract.indexOf('**Matriz rol -> operación.**');

  if (start === -1) {
    throw new Error('No se encontró la matriz rol -> operación en INTEROP §6.13.');
  }

  const rows: Partial<Record<ContractRow, string[]>> = {};

  for (const line of contract.slice(start).split('\n')) {
    if (!line.startsWith('| ') || line.startsWith('| Rol mínimo') || line.startsWith('|---')) {
      if (Object.keys(rows).length === 4) {
        break;
      }
      continue;
    }

    const [label, operations] = line.split('|').slice(1, 3).map((cell) => cell.trim());
    const row = ROW_LABELS.find(([pattern]) => pattern.test(label))?.[1];

    if (row) {
      // Solo los fragmentos que son operaciones: `METHOD /ruta`, `.../sufijo` o `subscribe:*`.
      rows[row] = [...operations.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .filter((span) => /^(GET|POST|PATCH|PUT|DELETE) |^\.\.\.\/|^subscribe:/.test(span));
    }
  }

  return rows as Record<ContractRow, string[]>;
}
