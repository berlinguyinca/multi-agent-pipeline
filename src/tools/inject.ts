import type { Tool } from './types.js';
import { formatToolCatalog } from './types.js';

export function injectToolCatalog(taskPrompt: string, tools: Tool[], systemPrompt?: string): string {
  const parts: string[] = [];
  if (systemPrompt) parts.push(systemPrompt);
  if (tools.length > 0) parts.push(formatToolCatalog(tools));
  parts.push(taskPrompt);
  return parts.join('\n\n');
}
