export function appendAgentDiscovery(lines: string[], data: Record<string, unknown>): void {
  const discoveries = normalizeAgentDiscovery(data);
  if (discoveries.length === 0) return;
  lines.push('', '## Autonomous Agent Discovery', '');
  lines.push('| Suggested agent | Status | Selected model | Selected candidate | Generated path |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const entry of discoveries) {
    lines.push(`| ${cell(entry.name)} | ${cell(entry.status)} | ${cell(entry.model)} | ${cell(entry.selectedCandidate ?? '')} | ${cell(entry.generatedPath ?? '')} |`);
  }
  const rejectedModels = discoveries.flatMap((entry) => entry.rejectedModels);
  if (rejectedModels.length > 0) {
    lines.push('', 'Rejected hardware/model candidates:');
    for (const rejected of rejectedModels) {
      lines.push(`- ${rejected.model}: ${rejected.reason}`);
    }
  }
  const warnings = discoveries.flatMap((entry) => entry.warnings);
  if (warnings.length > 0) {
    lines.push('', 'Discovery warnings:');
    for (const warning of warnings) lines.push(`- ${warning}`);
  }
}

export function appendPlainAgentDiscovery(lines: string[], data: Record<string, unknown>): void {
  const discoveries = normalizeAgentDiscovery(data);
  if (discoveries.length === 0) return;
  lines.push('Autonomous Agent Discovery', '----------------------------');
  for (const entry of discoveries) {
    lines.push(`- ${entry.name}: ${entry.status}; model=${entry.model}; selectedCandidate=${entry.selectedCandidate ?? 'n/a'}${entry.generatedPath ? `; path=${entry.generatedPath}` : ''}`);
  }
  lines.push('');
}

export function renderHtmlAgentDiscovery(data: Record<string, unknown>): string {
  const discoveries = normalizeAgentDiscovery(data);
  if (discoveries.length === 0) return '';
  const rows = discoveries.map((entry) =>
    `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.status)}</td><td>${escapeHtml(entry.model)}</td><td>${escapeHtml(String(entry.selectedCandidate ?? ''))}</td><td>${escapeHtml(entry.generatedPath ?? '')}</td></tr>`,
  ).join('');
  const rejected = discoveries.flatMap((entry) => entry.rejectedModels);
  return [
    '<h2>Autonomous Agent Discovery</h2>',
    `<table><thead><tr><th>Suggested agent</th><th>Status</th><th>Selected model</th><th>Selected candidate</th><th>Generated path</th></tr></thead><tbody>${rows}</tbody></table>`,
    rejected.length > 0
      ? `<h3>Rejected hardware/model candidates</h3><ul>${rejected.map((entry) => `<li><strong>${escapeHtml(entry.model)}:</strong> ${escapeHtml(entry.reason)}</li>`).join('')}</ul>`
      : '',
  ].join('\n');
}

function normalizeAgentDiscovery(data: Record<string, unknown>): Array<{
  name: string;
  status: string;
  model: string;
  selectedCandidate?: number;
  generatedPath?: string;
  rejectedModels: Array<{ model: string; reason: string }>;
  warnings: string[];
}> {
  const raw = Array.isArray(data['agentDiscovery']) ? data['agentDiscovery'].filter(isRecord) : [];
  return raw.map((entry) => {
    const suggested = isRecord(entry['suggestedAgent']) ? entry['suggestedAgent'] : {};
    const model = isRecord(entry['model']) ? entry['model'] : {};
    const selected = isRecord(model['selected']) ? model['selected'] : {};
    const consensus = isRecord(entry['consensus']) ? entry['consensus'] : {};
    const rejectedModels = Array.isArray(model['rejected'])
      ? model['rejected'].filter(isRecord).map((candidate) => ({
          model: String(candidate['model'] ?? ''),
          reason: String(candidate['reason'] ?? ''),
        })).filter((candidate) => candidate.model || candidate.reason)
      : [];
    return {
      name: String(suggested['name'] ?? ''),
      status: String(entry['status'] ?? ''),
      model: String(selected['model'] ?? ''),
      ...(typeof consensus['selectedCandidate'] === 'number' ? { selectedCandidate: consensus['selectedCandidate'] } : {}),
      ...(typeof entry['generatedPath'] === 'string' ? { generatedPath: entry['generatedPath'] } : {}),
      rejectedModels,
      warnings: Array.isArray(entry['warnings']) ? entry['warnings'].map(String).filter(Boolean) : [],
    };
  }).filter((entry) => entry.name || entry.status || entry.model);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
