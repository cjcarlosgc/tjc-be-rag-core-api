import { json, urlencoded } from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const githubWebhookEventsRoute = '/internal/v1/github/webhook-events';
const githubWebhookEventsLimit = '25mb';
const defaultJsonLimit = '100kb';

/**
 * Mantiene el parser general pequeño y eleva el límite solo para el webhook normalizado,
 * cuya lista de repositorios puede representar un evento legítimo grande de GitHub.
 * La credencial de servicio se comprueba antes de leer el cuerpo; el guard Nest vuelve a
 * validarla antes de ejecutar el controlador.
 */
export function configureRequestBodyParsers(server: Express, githubIntegrationToken: string): void {
  server.post(
    githubWebhookEventsRoute,
    (request, response, next) => {
      if (hasValidServiceBearer(request.headers.authorization, githubIntegrationToken)) {
        next();
        return;
      }
      writeParserError(request, response, 401, 'AUTH_REQUIRED', 'La credencial interna no es válida.');
    },
    withNormalizedParserErrors(json({ limit: githubWebhookEventsLimit })),
  );

  server.use(withNormalizedParserErrors(json({ limit: defaultJsonLimit })));
  server.use(withNormalizedParserErrors(urlencoded({ extended: true, limit: defaultJsonLimit })));
}

function hasValidServiceBearer(authorization: string | string[] | undefined, expected: string): boolean {
  const match = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/.exec(authorization) : null;
  const supplied = match ? Buffer.from(match[1]) : Buffer.alloc(0);
  const expectedBytes = Buffer.from(expected);
  return supplied.length > 0 && supplied.length === expectedBytes.length && timingSafeEqual(supplied, expectedBytes);
}

function withNormalizedParserErrors(parser: (request: Request, response: Response, next: NextFunction) => void) {
  return (request: Request, response: Response, next: NextFunction): void => {
    parser(request, response, (error?: unknown) => {
      if (!error) {
        next();
        return;
      }
      const tooLarge = typeof error === 'object' && error !== null && 'status' in error && error.status === 413;
      writeParserError(
        request,
        response,
        tooLarge ? 413 : 400,
        'INVALID_REQUEST',
        'La solicitud no es válida.',
      );
    });
  };
}

function writeParserError(
  request: Request,
  response: Response,
  status: 400 | 401 | 413,
  code: 'AUTH_REQUIRED' | 'INVALID_REQUEST',
  message: string,
): void {
  const incomingCorrelationId = request.header('X-Correlation-ID');
  const correlationId = incomingCorrelationId && /^[a-zA-Z0-9._:-]{1,128}$/.test(incomingCorrelationId)
    ? incomingCorrelationId
    : randomUUID();
  response.setHeader('X-Correlation-ID', correlationId);
  response.status(status).json({
    statusCode: status,
    code,
    message,
    details: null,
    correlationId,
    timestamp: new Date().toISOString(),
    path: request.originalUrl,
  });
}
