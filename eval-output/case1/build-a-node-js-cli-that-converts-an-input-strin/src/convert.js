'use strict';

const VALID_STYLES = ['kebab', 'snake', 'camel', 'pascal'];

function tokenize(input) {
  const trimmed = input.trim();
  if (trimmed.length === 0) return [];

  let result = trimmed.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
  result = result.replace(/([a-z0-9])([A-Z])/g, '$1_$2');

  const tokens = result
    .split(/[^a-zA-Z0-9]+/)
    .filter(t => t.length > 0)
    .map(t => t.toLowerCase());

  return tokens;
}

function convert(input, style) {
  if (style === undefined) style = 'kebab';

  const tokens = tokenize(input);
  if (tokens.length === 0) return '';

  switch (style) {
    case 'kebab':
      return tokens.join('-');

    case 'snake':
      return tokens.join('_');

    case 'camel':
      return tokens[0] + tokens.slice(1)
        .map(t => t.charAt(0).toUpperCase() + t.slice(1))
        .join('');

    case 'pascal':
      return tokens
        .map(t => t.charAt(0).toUpperCase() + t.slice(1))
        .join('');

    default:
      throw new Error('Unknown style: ' + style + '. Valid styles: ' + VALID_STYLES.join(', '));
  }
}

module.exports = { convert, tokenize, VALID_STYLES };
