import { describe, expect, it } from 'vitest';
import { createRawOutputStore } from '../../src/tui/raw-output-store.js';

describe('createRawOutputStore', () => {
  it('accumulates content for the active entry', () => {
    const store = createRawOutputStore();

    store.setCurrent('router', 'Router', '', true);
    store.append('router', 'Router', 'Thinking...\n');
    store.append('router', 'Router', '{"plan":[]}');

    const current = store.getCurrent();
    expect(current).not.toBeNull();
    expect(current?.key).toBe('router');
    expect(current?.content).toBe('Thinking...\n{"plan":[]}');
    expect(current?.streaming).toBe(true);
  });

  it('stores the log path when an entry completes', () => {
    const store = createRawOutputStore();

    store.setCurrent('router', 'Router', 'Hello', true);
    store.complete('router', 'Router', '/tmp/router.log');

    const current = store.getCurrent();
    expect(current?.logPath).toBe('/tmp/router.log');
    expect(current?.streaming).toBe(false);
  });
});
