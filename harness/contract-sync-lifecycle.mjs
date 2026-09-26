import fs from 'node:fs';
import path from 'node:path';

const statusAliases = new Map([
  ['PENDING', 'C-PENDING'],
  ['ACKNOWLEDGED', 'C-ACKNOWLEDGED'],
  ['RESOLVED', 'C-RESOLVED'],
  ['REJECTED', 'C-REJECTED'],
]);
const isSafeReportPath = (value) => typeof value === 'string'
  && value.startsWith('harness/reports/')
  && !value.split('/').includes('..')
  && !path.isAbsolute(value);

export function canonicalContractSyncStatus(status) {
  return statusAliases.get(status) ?? status;
}

export function stableContractSyncPayload(text) {
  return text
    .replace(/^status:\s*.*$/m, 'status: <status>')
    .replace(/^acknowledgementEvidence:\s*.*\n?/m, '')
    .replace(/^resolutionEvidence:\s*.*\n?/m, '')
    .replace(/^consumerImportedAt:\s*.*\n?/m, '');
}

export function contractSyncImportTime(text) {
  const value = text.match(/^consumerImportedAt:\s*(.+)$/m)?.[1]?.trim();
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return Number.NaN;
  }
  return timestamp;
}

export function contractSyncWasKnownAt(text, closedAt) {
  const importedAt = contractSyncImportTime(text);
  if (importedAt === null || Number.isNaN(importedAt)) return true;
  const closedTimestamp = Date.parse(closedAt);
  if (!Number.isFinite(closedTimestamp)) return true;
  return importedAt <= closedTimestamp;
}

export function contractSyncLocalEvidenceIssue({ id, text }, root) {
  if (!/^CS-(?:CORE|CONSOLE|SANDBOX|GH)-/.test(id ?? '')) return null;
  const consumerImportedAt = text.match(/^consumerImportedAt:\s*(.+)$/m)?.[1]?.trim();
  if (consumerImportedAt) {
    const parsed = Date.parse(consumerImportedAt);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== consumerImportedAt) {
      return 'consumerImportedAt must be an ISO UTC timestamp';
    }
  }
  const status = canonicalContractSyncStatus(text.match(/^status:\s*(.+)$/m)?.[1]?.trim());
  const acknowledgementEvidence = text.match(/^acknowledgementEvidence:\s*(.+)$/m)?.[1]?.trim();
  const resolutionEvidence = text.match(/^resolutionEvidence:\s*(.+)$/m)?.[1]?.trim();
  if (['C-ACKNOWLEDGED', 'C-RESOLVED'].includes(status)
    && (!isSafeReportPath(acknowledgementEvidence) || !fs.existsSync(path.join(root, acknowledgementEvidence)))) {
    return 'acknowledged Contract Sync requires existing acknowledgementEvidence';
  }
  if (status === 'C-RESOLVED'
    && (!isSafeReportPath(resolutionEvidence) || !fs.existsSync(path.join(root, resolutionEvidence)))) {
    return 'resolved Contract Sync requires existing resolutionEvidence';
  }
  return null;
}

export function contractSyncTransitionText(text, transition, evidencePath) {
  if (!['acknowledge', 'resolve'].includes(transition)) throw new Error(`unknown Contract Sync transition: ${transition}`);
  if (typeof evidencePath !== 'string' || !evidencePath.startsWith('harness/reports/') || evidencePath.split('/').includes('..')) {
    throw new Error('evidence must be a repository-relative harness/reports path');
  }
  const statusLine = text.match(/^status:\s*(.+)$/m);
  if (!statusLine) throw new Error('Contract Sync event has no lifecycle status');
  const current = canonicalContractSyncStatus(statusLine[1].trim());
  const next = transition === 'acknowledge' && current !== 'C-RESOLVED' ? 'C-ACKNOWLEDGED' : 'C-RESOLVED';
  const allowed = transition === 'acknowledge'
    ? ['C-PENDING', 'C-ACKNOWLEDGED', 'C-RESOLVED']
    : ['C-ACKNOWLEDGED', 'C-RESOLVED'];
  if (!allowed.includes(current)) throw new Error(`cannot ${transition} Contract Sync from ${current}`);

  const evidenceField = transition === 'acknowledge' ? 'acknowledgementEvidence' : 'resolutionEvidence';
  const existingEvidence = text.match(new RegExp(`^${evidenceField}:\\s*(.*)$`, 'm'))?.[1]?.trim();
  if (existingEvidence && existingEvidence !== evidencePath) {
    throw new Error(`cannot replace existing ${evidenceField}`);
  }
  if (current === next && existingEvidence === evidencePath) return text;

  let updated = text.replace(/^status:\s*.*$/m, `status: ${next}`);
  const evidenceLine = new RegExp(`^${evidenceField}:\\s*.*$`, 'm');
  if (evidenceLine.test(updated)) updated = updated.replace(evidenceLine, `${evidenceField}: ${evidencePath}`);
  else updated = `${updated.trimEnd()}\n${evidenceField}: ${evidencePath}\n`;
  return updated;
}
