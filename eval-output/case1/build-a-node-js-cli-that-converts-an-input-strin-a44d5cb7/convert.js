/**
 * Tokenizes an input string and joins tokens with the specified style separator.
 *
 * @param {string} input - The string to convert
 * @param {'kebab'|'snake'} style - The target case style
 * @returns {string} The converted string
 */
function convert(input, style) {
  if (!input) return '';

  // Step 1: Replace non-alphanumeric characters with spaces (they act as separators)
  let normalized = input.replace(/[^a-zA-Z0-9]/g, ' ');

  // Step 2: Insert spaces at camelCase/PascalCase boundaries
  // Boundary: lowercase or digit followed by uppercase
  normalized = normalized.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

  // Step 3: Insert spaces at acronym boundaries
  // Boundary: uppercase letter followed by uppercase then lowercase (e.g., "XMLParser" → "XML Parser")
  normalized = normalized.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  // Step 4: Lowercase everything, split on whitespace, discard empties
  const tokens = normalized.toLowerCase().split(/\s+/).filter(Boolean);

  if (tokens.length === 0) return '';

  const separator = style === 'snake' ? '_' : '-';
  return tokens.join(separator);
}

module.exports = { convert };
