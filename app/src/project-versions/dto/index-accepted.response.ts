export interface IndexAcceptedResponse {
  projectId: string;
  projectVersionId: string;
  status: 'PENDING';
  pollAfterMs: number;
}
