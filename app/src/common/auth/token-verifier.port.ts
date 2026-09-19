export interface VerifiedToken {
  userId: string;
}

export class InvalidTokenError extends Error {}

export interface TokenVerifierPort {
  verify(token: string): Promise<VerifiedToken>;
}
