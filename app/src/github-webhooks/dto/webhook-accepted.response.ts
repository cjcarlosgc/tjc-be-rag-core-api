export interface GitHubWebhookAcceptedResponse {
  deliveryId: string;
  accepted: boolean;
  duplicate: boolean;
  analysisRunId: string | null;
}
