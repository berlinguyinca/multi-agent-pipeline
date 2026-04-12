import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude-adapter.js';

describe('ClaudeAdapter', () => {
  it('has type claude', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.type).toBe('claude');
  });

  it('has undefined model', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.model).toBeUndefined();
  });

  it('detects claude binary', async () => {
    const adapter = new ClaudeAdapter();
    const info = await adapter.detect();
    expect(typeof info.installed).toBe('boolean');
  });
});
