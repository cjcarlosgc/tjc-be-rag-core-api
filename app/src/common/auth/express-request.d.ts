declare global {
  namespace Express {
    interface Request {
      userId?: string;
      githubUserId?: string;
    }
  }
}

export {};
