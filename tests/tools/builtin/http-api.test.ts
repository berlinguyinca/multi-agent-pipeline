import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpApiTool } from '../../../src/tools/builtin/http-api.js';

describe('HttpApiTool', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects absolute URLs outside the configured base origin', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const tool = createHttpApiTool({ baseUrl: 'https://api.example.com/v1/' });

    const result = await tool.execute({ path: 'https://evil.example.com/secrets' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside configured base URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
