import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../src/adapters/codex-adapter.js';

describe('CodexAdapter', () => {
  it('has type codex', () => {
    const adapter = new CodexAdapter();
    expect(adapter.type).toBe('codex');
  });

  it('has undefined model', () => {
    const adapter = new CodexAdapter();
    expect(adapter.model).toBeUndefined();
  });

  it('detects codex binary', async () => {
    const adapter = new CodexAdapter();
    const info = await adapter.detect();
    expect(typeof info.installed).toBe('boolean');
  });
});
