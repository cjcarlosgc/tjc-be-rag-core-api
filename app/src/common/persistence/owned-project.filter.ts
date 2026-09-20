/**
 * Filtro `where` de un Project visible para su dueño: propio y no borrado
 * lógicamente (HU56). Todo acceso owner-scoped debe pasar por aquí para que un
 * Project borrado se comporte como inexistente (`404 PROJECT_NOT_FOUND`).
 */
export function ownedProject(ownerUserId: string): { ownerUserId: string; deletedAt: null } {
  return { ownerUserId, deletedAt: null };
}
