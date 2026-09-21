import { Injectable, Logger, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/auth/auth.constants.js';
import { ACCESS_POLICY_KEY, WS_HANDSHAKE_KEY, type AccessPolicy } from './access-policy.js';

const MESSAGE_MAPPING_METADATA = 'websockets:message_mapping';
const MESSAGE_METADATA = 'message';
const GATEWAY_METADATA = 'websockets:is_gateway';

export interface RouteAccessEntry {
  transport: 'http' | 'ws-message' | 'ws-handshake';
  /** Método HTTP (`GET`, `POST`...) o `WS`. */
  method: string;
  /** Ruta HTTP con `:params`, o el nombre del evento WebSocket (`subscribe:project-version`). */
  path: string;
  handler: string;
  /** `PUBLIC` (sin sesión), la política declarada o `null` si la ruta no declara nada. */
  policy: AccessPolicy | 'PUBLIC' | null;
}

function joinPath(...parts: Array<string | string[] | undefined>): string {
  const segments = parts
    .flatMap((part) => (Array.isArray(part) ? part.slice(0, 1) : [part]))
    .flatMap((part) => (part ?? '').split('/'))
    .filter((segment) => segment.length > 0);
  return `/${segments.join('/')}`;
}

/**
 * Enumera TODAS las rutas HTTP y los puntos de entrada WebSocket (handshake y mensajes) de
 * la aplicación con su política de acceso. Es la fuente de la prueba de default-deny, de la
 * comparación con la matriz de `INTEROP-2.4` §6.13 y de la comprobación de arranque.
 */
export function listRouteAccess(discovery: DiscoveryService, scanner: MetadataScanner): RouteAccessEntry[] {
  const entries: RouteAccessEntry[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as (new (...args: never[]) => object) | null;

    if (!controller) {
      continue;
    }

    const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;

    for (const name of scanner.getAllMethodNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name] as object;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;

      if (requestMethod === undefined) {
        continue;
      }

      const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      entries.push({
        transport: 'http',
        method: RequestMethod[requestMethod],
        path: joinPath(controllerPath, Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined),
        handler: `${controller.name}.${name}`,
        policy: isPublic ? 'PUBLIC' : ((Reflect.getMetadata(ACCESS_POLICY_KEY, handler) as AccessPolicy | undefined) ?? null),
      });
    }
  }

  for (const wrapper of discovery.getProviders()) {
    const gateway = wrapper.metatype as (new (...args: never[]) => object) | null;

    if (!gateway || typeof gateway !== 'function' || Reflect.getMetadata(GATEWAY_METADATA, gateway) !== true) {
      continue;
    }

    let handshakes = 0;

    for (const name of scanner.getAllMethodNames(gateway.prototype)) {
      const handler = (gateway.prototype as Record<string, unknown>)[name] as object;
      const policy = (Reflect.getMetadata(ACCESS_POLICY_KEY, handler) as AccessPolicy | undefined) ?? null;

      if (Reflect.getMetadata(WS_HANDSHAKE_KEY, handler) === true) {
        handshakes += 1;
        entries.push({ transport: 'ws-handshake', method: 'WS', path: 'handshake', handler: `${gateway.name}.${name}`, policy });
      } else if (Reflect.getMetadata(MESSAGE_MAPPING_METADATA, handler) === true) {
        entries.push({
          transport: 'ws-message',
          method: 'WS',
          path: Reflect.getMetadata(MESSAGE_METADATA, handler) as string,
          handler: `${gateway.name}.${name}`,
          policy,
        });
      }
    }

    if (handshakes === 0) {
      entries.push({ transport: 'ws-handshake', method: 'WS', path: 'handshake', handler: `${gateway.name}.<sin handshake declarado>`, policy: null });
    }
  }

  return entries;
}

/**
 * Fail-fast de default-deny: la aplicación NO arranca si alguna ruta o el handshake
 * WebSocket carece de `@RequireProjectRole`/`@NoProjectRole`/`@Public()`.
 */
@Injectable()
export class RouteAccessAuditor implements OnApplicationBootstrap {
  private readonly logger = new Logger(RouteAccessAuditor.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared = listRouteAccess(this.discovery, this.scanner).filter((entry) => entry.policy === null);

    if (undeclared.length > 0) {
      const detail = undeclared.map((entry) => `${entry.method} ${entry.path} (${entry.handler})`).join(', ');
      this.logger.error(`Rutas sin política de acceso (default-deny): ${detail}`);
      throw new Error(`Rutas sin @RequireProjectRole/@NoProjectRole: ${detail}`);
    }
  }
}
