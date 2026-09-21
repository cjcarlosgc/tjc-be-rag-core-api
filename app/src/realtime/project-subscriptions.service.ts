import { Injectable, Logger } from '@nestjs/common';
import { ProjectAccessRepository } from '../project-access/project-access.repository.js';

/** Sala de Socket.IO de una `ProjectVersion` (una sala por id; nunca broadcast global). */
export function projectVersionRoom(projectVersionId: string): string {
  return `project-version:${projectVersionId}`;
}

/** Lo mínimo que se necesita de un socket para sacarlo de sus salas. */
export interface TrackedSocket {
  id: string;
  leave(room: string): void | Promise<void>;
}

interface SocketSubscriptions {
  socket: TrackedSocket;
  userId: string;
  /** `projectVersionId` -> `projectId` de cada suscripción del socket. */
  versions: Map<string, string>;
}

/**
 * Mapa socket -> Project de las suscripciones WebSocket (`INTEROP-2.4` §6.6) y la expulsión
 * de los sockets de un Project cuando el usuario deja de tener acceso. Un servicio
 * invocable: el corte 5 lo dispara desde los eventos de GitHub y las reverificaciones una
 * vez que el estado ya cambió (registro borrado, binding `REVOKED`), y `DELETE
 * /projects/{id}` lo dispara tras el borrado lógico.
 */
@Injectable()
export class ProjectSubscriptionsService {
  private readonly logger = new Logger(ProjectSubscriptionsService.name);
  private readonly sockets = new Map<string, SocketSubscriptions>();

  constructor(private readonly accessRepository: ProjectAccessRepository) {}

  track(socket: TrackedSocket, userId: string, projectVersionId: string, projectId: string): void {
    const entry = this.sockets.get(socket.id) ?? { socket, userId, versions: new Map<string, string>() };
    entry.versions.set(projectVersionId, projectId);
    this.sockets.set(socket.id, entry);
  }

  untrack(socketId: string, projectVersionId: string): void {
    const entry = this.sockets.get(socketId);
    entry?.versions.delete(projectVersionId);

    if (entry && entry.versions.size === 0) {
      this.sockets.delete(socketId);
    }
  }

  /** Una desconexión limpia todas las suscripciones del socket sin más acción del servidor. */
  forget(socketId: string): void {
    this.sockets.delete(socketId);
  }

  /** Projects a los que está suscrito un socket (el mapa socket -> Project). */
  projectsOf(socketId: string): string[] {
    return [...new Set(this.sockets.get(socketId)?.versions.values() ?? [])];
  }

  /**
   * Saca de las salas de `projectId` a los sockets cuyo usuario YA NO ve el Project (registro
   * de acceso borrado, Project borrado lógicamente, o binding `REVOKED` y no Admin), con el
   * mismo predicado `accessibleProject` que las rutas HTTP y sin llamar a GitHub. Los que lo
   * siguen viendo permanecen. Devuelve los sockets expulsados. Un error de base de datos se
   * propaga: quien lo dispara (un job del corte 5) reintenta.
   */
  async revalidateProject(projectId: string): Promise<number> {
    const usersOfProject = new Map<string, TrackedSocket[]>();

    for (const entry of this.sockets.values()) {
      if ([...entry.versions.values()].includes(projectId)) {
        usersOfProject.set(entry.userId, [...(usersOfProject.get(entry.userId) ?? []), entry.socket]);
      }
    }

    let evicted = 0;

    for (const [userId, sockets] of usersOfProject) {
      if (await this.accessRepository.findVisible(projectId, userId)) {
        continue;
      }

      for (const socket of sockets) {
        await this.evict(socket.id, projectId);
        evicted += 1;
      }
    }

    return evicted;
  }

  /**
   * Segunda comprobación de una suscripción recién registrada (`subscribe:project-version`): con el
   * socket ya en el mapa y en la sala, vuelve a evaluar el predicado de visibilidad (sin GitHub). Si el
   * usuario ya no ve el Project (una revocación llegó entre la verificación y el registro, cuando
   * `revalidateProject` aún no podía ver el socket), lo expulsa y devuelve `false`.
   */
  async revalidateSocket(socketId: string, projectId: string): Promise<boolean> {
    const entry = this.sockets.get(socketId);

    if (!entry) {
      return false;
    }

    if (await this.accessRepository.findVisible(projectId, entry.userId)) {
      return true;
    }

    await this.evict(socketId, projectId);
    return false;
  }

  /** Expulsión incondicional de un usuario de un Project (p. ej. su registro se borró). */
  async evictUser(projectId: string, userId: string): Promise<number> {
    let evicted = 0;

    for (const entry of this.sockets.values()) {
      if (entry.userId === userId && [...entry.versions.values()].includes(projectId)) {
        await this.evict(entry.socket.id, projectId);
        evicted += 1;
      }
    }

    return evicted;
  }

  private async evict(socketId: string, projectId: string): Promise<void> {
    const entry = this.sockets.get(socketId);

    if (!entry) {
      return;
    }

    for (const [projectVersionId, owner] of entry.versions) {
      if (owner === projectId) {
        entry.versions.delete(projectVersionId);
        try {
          await entry.socket.leave(projectVersionRoom(projectVersionId));
        } catch (error) {
          this.logger.warn(`No se pudo sacar al socket "${socketId}" de la sala de "${projectVersionId}": ${String(error)}`);
        }
      }
    }

    if (entry.versions.size === 0) {
      this.sockets.delete(socketId);
    }
  }
}
