export interface FunctionalAnswerAcceptedResponse {
  status: 'PENDING';
  pollAfterMs: number;
  analysisRunId: string;
  questionId: string;
  continuationAttemptId: string | null;
  knowledgeId: string | null;
  /** `ABSTAINED` (`UNKNOWN`, DEC-FK-002) implica `continuationAttemptId` y `knowledgeId` nulos. */
  outcome: 'ANSWERED' | 'ABSTAINED';
}
