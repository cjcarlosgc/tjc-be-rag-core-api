/** `INTEROP-2.4` §6.13. */
export type WorkspaceKind = 'PERSONAL' | 'ORGANIZATION';
export type WorkspaceRole = 'ADMIN' | 'MEMBER';

export interface WorkspaceRefResponse {
  kind: WorkspaceKind;
  /** Id numérico de GitHub de la cuenta u organización, como texto: es el `workspaceId` de las demás rutas. */
  id: string;
  /** `null` solo en un workspace personal cuyo login Core aún no conoce. */
  login: string | null;
}

export interface WorkspaceResponse extends WorkspaceRefResponse {
  avatarUrl: string | null;
  /** `ADMIN`: cuenta personal siempre, u owner activo de la organización. */
  role: WorkspaceRole;
}

export interface WorkspaceListResponse {
  items: WorkspaceResponse[];
}
