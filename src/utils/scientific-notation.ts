const LATEX_GREEK: Record<string, string> = {
  alpha: 'alpha',
  beta: 'beta',
  gamma: 'gamma',
  delta: 'delta',
};

export function normalizeScientificNotation(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (match, body: string) => {
    const normalized = normalizeLatexBody(body.trim());
    return normalized ?? match;
  });
}

function normalizeLatexBody(body: string): string | null {
  if (/^\\(?:alpha|beta|gamma|delta)$/.test(body)) {
    return LATEX_GREEK[body.slice(1)] ?? null;
  }

  let output = body.replace(/\\text\{([^}]*)\}/g, '$1');
  output = output.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  output = output.replace(/_\{([^}]*)\}/g, '$1').replace(/_([A-Za-z0-9+-]+)/g, '$1');
  output = output.replace(/\\(?:,|;|:|!)/g, '').trim();

  if (isPlainChemicalLike(output)) return output;
  if (isPlainChemicalExpression(output)) return output;
  return null;
}

function isPlainChemicalExpression(value: string): boolean {
  if (value.length === 0 || value.length > 80) return false;
  if (!/^[A-Za-z0-9()+\-\s=]+$/.test(value)) return false;
  if (!/[A-Z][a-z]?/.test(value)) return false;
  return /\d/.test(value) || /\bR\b/.test(value);
}

function isPlainChemicalLike(value: string): boolean {
  if (value.length === 0) return false;
  if (!/^[A-Za-z0-9()+\-]+$/.test(value)) return false;
  if (!/[A-Z][a-z]?/.test(value)) return false;
  return /\d/.test(value) || /^-?[A-Z][A-Za-z0-9()+-]*$/.test(value);
}
