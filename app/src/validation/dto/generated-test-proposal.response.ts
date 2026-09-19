import type { GeneratedTestProposal } from '../../generated/prisma/client.js';
import type { AnalysisSymbolResponse } from '../../analysis-runs/dto/analysis-run.response.js';

export interface GeneratedTestProposalResponse {
  id: string;
  relativePath: string;
  target: AnalysisSymbolResponse;
  contentSha256: string;
  status: GeneratedTestProposal['status'];
}

export interface GeneratedTestProposalSetResponse {
  analysisRunId: string;
  headSha: string;
  items: GeneratedTestProposalResponse[];
}

export function toGeneratedTestProposalResponse(
  proposal: GeneratedTestProposal,
): GeneratedTestProposalResponse {
  return {
    id: proposal.id,
    relativePath: proposal.relativePath,
    target: {
      language: proposal.symbolLanguage,
      kind: proposal.symbolKind,
      qualifiedName: proposal.qualifiedName,
      filePath: proposal.filePath,
      changeKind: 'DIRECTLY_CHANGED',
    },
    contentSha256: proposal.contentSha256,
    status: proposal.status,
  };
}
