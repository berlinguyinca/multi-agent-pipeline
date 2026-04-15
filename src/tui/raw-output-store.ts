export interface RawOutputEntry {
  key: string;
  title: string;
  content: string;
  logPath?: string;
  streaming: boolean;
  scroll: number;
  autoScroll: boolean;
}

type RawOutputListener = () => void;

export interface RawOutputSnapshot {
  current: RawOutputEntry | null;
  get(key: string): RawOutputEntry | null;
}

export interface RawOutputStore {
  setCurrent(key: string, title: string, content?: string, streaming?: boolean): void;
  append(key: string, title: string, chunk: string): void;
  complete(key: string, title: string, logPath?: string): void;
  setScroll(key: string, scroll: number, autoScroll: boolean): void;
  getCurrent(): RawOutputEntry | null;
  get(key: string): RawOutputEntry | null;
  subscribe(listener: RawOutputListener): () => void;
}

export function createRawOutputStore(): RawOutputStore {
  const entries = new Map<string, RawOutputEntry>();
  const listeners = new Set<RawOutputListener>();
  let currentKey: string | null = null;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function ensureEntry(
    key: string,
    title: string,
    content?: string,
    streaming?: boolean,
  ): RawOutputEntry {
    const existing = entries.get(key);
    if (existing) {
      existing.title = title;
      if (content !== undefined) {
        existing.content = content;
      }
      if (streaming !== undefined) {
        existing.streaming = streaming;
      }
      return existing;
    }

    const entry: RawOutputEntry = {
      key,
      title,
      content: content ?? '',
      streaming: streaming ?? true,
      scroll: 0,
      autoScroll: true,
    };
    entries.set(key, entry);
    return entry;
  }

  return {
    setCurrent(key, title, content = '', streaming = true) {
      ensureEntry(key, title, content, streaming);
      currentKey = key;
      notify();
    },
    append(key, title, chunk) {
      const entry = ensureEntry(key, title);
      entry.content += chunk;
      currentKey = key;
      notify();
    },
    complete(key, title, logPath) {
      const entry = ensureEntry(key, title, entries.get(key)?.content ?? '', false);
      entry.streaming = false;
      if (logPath !== undefined) {
        entry.logPath = logPath;
      }
      currentKey = key;
      notify();
    },
    setScroll(key, scroll, autoScroll) {
      const entry = entries.get(key);
      if (!entry) return;
      entry.scroll = scroll;
      entry.autoScroll = autoScroll;
    },
    getCurrent() {
      return currentKey ? entries.get(currentKey) ?? null : null;
    },
    get(key) {
      return entries.get(key) ?? null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
