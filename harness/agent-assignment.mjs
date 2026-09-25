export function agentAssignmentIssues(item) {
  const issues = [];
  const execution = item.execution ?? {};
  const requiresReview = ['W-IN_REVIEW', 'W-DONE'].includes(item.status);

  if (execution.implementationAgent && execution.reviewAgent && execution.implementationAgent === execution.reviewAgent) {
    issues.push('implementer cannot be final reviewer');
  }
  if (requiresReview && (!execution.implementationAgent || !execution.reviewAgent)) {
    issues.push('review requires assigned implementer and independent reviewer');
  }
  if (item.coordination?.uiImpact && requiresReview && execution.uxReviewAgent !== 'ux-reviewer') {
    issues.push('UI impact requires ux-reviewer before review');
  }
  return issues;
}
