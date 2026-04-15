import type { Tool, ToolResult } from '../types.js';

interface WebSearchToolConfig {
  maxResults?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export function createWebSearchTool(config: WebSearchToolConfig = {}): Tool {
  return {
    name: 'web-search',
    description: 'Search the public web for current information and return result snippets',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query',
        required: true,
      },
    ],
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      const query = String(params['query'] ?? '').trim();
      if (!query) {
        return { success: false, output: '', error: 'Missing search query' };
      }

      const limit = Math.max(1, Math.min(config.maxResults ?? 5, 10));

      try {
        const url = new URL('https://html.duckduckgo.com/html/');
        url.searchParams.set('q', query);
        const response = await fetch(url, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (compatible; MAP/0.1; +https://example.invalid/multi-agent-pipeline)',
          },
        });

        if (!response.ok) {
          return {
            success: false,
            output: '',
            error: `Search request failed with status ${response.status}`,
          };
        }

        const html = await response.text();
        const results = extractSearchResults(html, limit);
        return {
          success: true,
          output:
            results.length > 0
              ? results
                  .map(
                    (result, index) =>
                      `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`,
                  )
                  .join('\n\n')
              : 'No search results found.',
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

function extractSearchResults(html: string, limit: number): SearchResult[] {
  const matches = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>)([\s\S]*?)(?:<\/a>|<\/div>)/g)];

  return matches.slice(0, limit).map((match) => ({
    url: decodeHtml(match[1] ?? ''),
    title: stripTags(decodeHtml(match[2] ?? '')).trim(),
    snippet: stripTags(decodeHtml(match[3] ?? '')).replace(/\s+/g, ' ').trim(),
  }));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
