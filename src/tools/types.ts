export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

export function formatToolCatalog(tools: Tool[]): string {
  if (tools.length === 0) return '';

  const sections = tools.map((tool) => {
    const params = tool.parameters
      .map((p) => `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`)
      .join('\n');
    return `### ${tool.name}\n${tool.description}\nParameters:\n${params}`;
  });

  return `## Available Tools\n\nYou can call tools by outputting a JSON block:\n\`\`\`json\n{"tool": "<name>", "params": {<parameters>}}\n\`\`\`\n\n${sections.join('\n\n')}`;
}
