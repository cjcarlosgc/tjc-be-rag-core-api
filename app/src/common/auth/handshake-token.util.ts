const BEARER_PREFIX = 'Bearer ';

export interface HandshakeLike {
  auth?: Record<string, unknown>;
  headers?: Record<string, unknown>;
}

/** Token del handshake de Socket.IO: `auth.token` o `Authorization: Bearer`. */
export function extractHandshakeToken(handshake: HandshakeLike): string | null {
  const authToken = handshake.auth?.token;
  if (typeof authToken === 'string' && authToken) {
    return authToken;
  }
  const header = handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith(BEARER_PREFIX)) {
    return header.slice(BEARER_PREFIX.length).trim() || null;
  }
  return null;
}
