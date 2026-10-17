export const CONTRACT_SYNC_NAMESPACE_CUTOVER = '20260925';

const tagsBySource = new Map([
  ['CORE', 'CORE'],
  ['CONSOLE', 'CONSOLE'],
  ['SANDBOX', 'SANDBOX'],
  ['GH', 'GH'],
  ['core', 'CORE'],
  ['console', 'CONSOLE'],
  ['sandbox', 'SANDBOX'],
  ['github-integration', 'GH'],
]);

export function contractSyncIdIssue(id, sourceOrComponent, sourceWorkItem) {
  const match = typeof id === 'string' ? id.match(/^CS-(?:(CORE|CONSOLE|SANDBOX|GH)-)?(\d{8})-(\d{3})$/) : null;
  if (!match) return 'invalid Contract Sync ID format';

  const [, namespace, date] = match;
  const expectedTag = tagsBySource.get(sourceOrComponent);
  if (!expectedTag) return `unknown Contract Sync source/component: ${sourceOrComponent}`;
  if (namespace && namespace !== expectedTag) return `ID namespace ${namespace} does not match source/component ${sourceOrComponent}`;

  const expectedWorkItem = new RegExp(`^WI-${expectedTag}-\\d{3}$`);
  if (namespace && !expectedWorkItem.test(sourceWorkItem ?? '')) return `namespaced event ${id} requires a matching sourceWorkItem`;
  if (!namespace && date >= CONTRACT_SYNC_NAMESPACE_CUTOVER) return `unnamespaced ID ${id} is only valid as historical data before ${CONTRACT_SYNC_NAMESPACE_CUTOVER}`;
  if (sourceWorkItem && !expectedWorkItem.test(sourceWorkItem)) return `sourceWorkItem does not match source/component ${sourceOrComponent}`;

  return null;
}
