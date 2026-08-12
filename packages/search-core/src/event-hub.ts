import type { SearchEvent } from '@cairn/shared';
import type { CairnRepository } from '@cairn/storage';

export type EventListener = (event: SearchEvent) => void;

/** 进程内实时广播 + SQLite 事件日志。先落库后广播，避免断线窗口丢事件。 */
export class EventHub {
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(private readonly repo: CairnRepository) {}

  publish(event: SearchEvent): SearchEvent {
    const stored = this.repo.appendEvent(event);
    for (const listener of this.listeners.get(stored.sessionId) ?? []) listener(stored);
    return stored;
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<EventListener>();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(sessionId);
    };
  }
}
