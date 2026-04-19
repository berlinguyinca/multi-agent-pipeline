import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSearchTool } from '../../src/tools/builtin/web-search.js';

describe('web-search tool', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('includes retrievedAt metadata for evidence ledgers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`
      <a class="result__a" href="https://example.test/source">Current source</a>
      <div class="result__snippet">Current medical use evidence.</div>
    `, { status: 200 })));

    const result = await createWebSearchTool({ maxResults: 1 }).execute({ query: 'cocaine current medical use' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('RetrievedAt: 2026-04-19');
    expect(result.output).toContain('URL: https://example.test/source');
  });
});
