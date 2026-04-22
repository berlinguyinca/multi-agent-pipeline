import { describe, expect, it } from 'vitest';
import { normalizeScientificNotation } from '../../src/utils/scientific-notation.js';

describe('normalizeScientificNotation', () => {
  it('converts LaTeX chemical formulas to plain text', () => {
    const input = 'Alanine ($\\text{C}_3\\text{H}_7\\text{NO}_2$) includes $\\text{NH}_2$ and $\\text{COOH}$.';

    expect(normalizeScientificNotation(input)).toBe('Alanine (C3H7NO2) includes NH2 and COOH.');
  });

  it('converts alpha amino acid notation without preserving math delimiters', () => {
    expect(normalizeScientificNotation('It is an $\\alpha$-amino acid.')).toBe('It is an alpha-amino acid.');
  });


  it('converts mixed chemical side-chain expressions without preserving LaTeX', () => {
    expect(normalizeScientificNotation('Side chain ($\\text{R} = \\text{CH}_3$).')).toBe('Side chain (R = CH3).');
  });

  it('does not aggressively rewrite general equations', () => {
    const input = 'The equation $E = mc^2$ is not a chemical formula.';

    expect(normalizeScientificNotation(input)).toBe(input);
  });
});
