/** Presença por usuário (um usuário pode ter várias abas/sockets). */
export class Presence {
  private sockets = new Map<string, Set<string>>();

  /** true se o usuário acabou de ficar online. */
  add(userId: string, socketId: string): boolean {
    let s = this.sockets.get(userId);
    const wasOnline = !!s && s.size > 0;
    if (!s) this.sockets.set(userId, (s = new Set()));
    s.add(socketId);
    return !wasOnline;
  }

  /** true se o usuário acabou de ficar offline. */
  remove(userId: string, socketId: string): boolean {
    const s = this.sockets.get(userId);
    if (!s) return false;
    s.delete(socketId);
    if (s.size === 0) {
      this.sockets.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId: string): boolean { return this.sockets.has(userId); }
  list(): string[] { return [...this.sockets.keys()]; }
}
