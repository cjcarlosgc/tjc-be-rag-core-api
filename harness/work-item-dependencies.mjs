const statusesRequiringCompletedDependencies = new Set([
  'W-READY', 'W-SELECTED', 'W-SPEC_VERIFIED', 'W-AWAITING_APPROVAL',
  'W-IN_PROGRESS', 'W-IN_REVIEW', 'W-DONE',
]);

export function localDependencyIssues(item, itemsById) {
  const issues = [];
  for (const dependencyId of item.dependsOn ?? []) {
    const dependency = itemsById.get(dependencyId);
    if (!dependency || dependencyId === item.id) {
      issues.push(`invalid dependency ${dependencyId} in ${item.id}`);
    } else if (statusesRequiringCompletedDependencies.has(item.status) && dependency.status !== 'W-DONE') {
      issues.push(`${item.id} cannot be ${item.status} before dependency ${dependencyId} finishes`);
    }
  }
  return issues;
}
