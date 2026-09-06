export interface JobHandler<TPayload = unknown> {
  readonly type: string;
  handle(payload: TPayload, jobId: string): Promise<void>;
}
