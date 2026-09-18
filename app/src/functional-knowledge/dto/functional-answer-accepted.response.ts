export interface FunctionalAnswerAcceptedResponse {
  status: 'PENDING';
  pollAfterMs: number;
  analysisRunId: string;
  questionId: string;
  continuationAttemptId: string | null;
  knowledgeId: string | null;
}
