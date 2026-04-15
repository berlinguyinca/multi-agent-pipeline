// Tests for the string conversion module
// Phase 1: RED — All tests written before implementation

const { convert, tokenize } = require('../src/convert');

// =============================================================================
// 1. Tokenization
// =============================================================================

describe('tokenize', () => {
  // [TEST:WRITE] tokenize-camelCase
  test('splits camelCase into tokens', () => {
    expect(tokenize('helloWorld')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-PascalCase
  test('splits PascalCase into tokens', () => {
    expect(tokenize('HelloWorld')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-snake_case
  test('splits snake_case into tokens', () => {
    expect(tokenize('hello_world')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-kebab-case
  test('splits kebab-case into tokens', () => {
    expect(tokenize('hello-world')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-acronym
  test('splits acronym boundaries correctly', () => {
    expect(tokenize('parseXMLDocument')).toEqual(['parse', 'xml', 'document']);
  });

  // [TEST:WRITE] tokenize-acronym-start
  test('splits leading acronym correctly', () => {
    expect(tokenize('XMLParser')).toEqual(['xml', 'parser']);
  });

  // [TEST:WRITE] tokenize-digits
  test('treats digits as lowercase (no boundary break)', () => {
    expect(tokenize('version2Release')).toEqual(['version2', 'release']);
  });

  // [TEST:WRITE] tokenize-digits-middle
  test('keeps digits attached to surrounding lowercase', () => {
    expect(tokenize('log4jConfig')).toEqual(['log4j', 'config']);
  });

  // [TEST:WRITE] tokenize-empty
  test('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  // [TEST:WRITE] tokenize-whitespace-trim
  test('trims leading and trailing whitespace', () => {
    expect(tokenize('  hello  ')).toEqual(['hello']);
  });

  // [TEST:WRITE] tokenize-mixed-separators
  test('handles mixed separators', () => {
    expect(tokenize('hello_world-foo')).toEqual(['hello', 'world', 'foo']);
  });

  // [TEST:WRITE] tokenize-spaces
  test('splits on spaces', () => {
    expect(tokenize('hello world')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-multiple-underscores
  test('handles multiple consecutive separators', () => {
    expect(tokenize('hello__world')).toEqual(['hello', 'world']);
  });

  // [TEST:WRITE] tokenize-all-uppercase
  test('handles all-uppercase word', () => {
    expect(tokenize('HTML')).toEqual(['html']);
  });
});

// =============================================================================
// 2. Kebab-case conversion (default style)
// =============================================================================

describe('convert to kebab-case (default)', () => {
  // [TEST:WRITE] kebab-from-camel
  test('converts camelCase to kebab-case', () => {
    expect(convert('helloWorld')).toBe('hello-world');
  });

  // [TEST:WRITE] kebab-from-pascal
  test('converts PascalCase to kebab-case', () => {
    expect(convert('HelloWorld')).toBe('hello-world');
  });

  // [TEST:WRITE] kebab-from-snake
  test('converts snake_case to kebab-case', () => {
    expect(convert('hello_world')).toBe('hello-world');
  });

  // [TEST:WRITE] kebab-from-acronym
  test('converts acronym input to kebab-case', () => {
    expect(convert('parseXMLDocument')).toBe('parse-xml-document');
  });

  // [TEST:WRITE] kebab-from-leading-acronym
  test('converts leading acronym to kebab-case', () => {
    expect(convert('XMLParser')).toBe('xml-parser');
  });

  // [TEST:WRITE] kebab-from-digits
  test('converts digit input to kebab-case (digits stay with word)', () => {
    expect(convert('version2Release')).toBe('version2-release');
  });

  // [TEST:WRITE] kebab-passthrough
  test('passes through already-kebab string unchanged', () => {
    expect(convert('already-kebab')).toBe('already-kebab');
  });

  // [TEST:WRITE] kebab-from-snake-passthrough
  test('converts already_snake to kebab-case', () => {
    expect(convert('already_snake')).toBe('already-snake');
  });

  // [TEST:WRITE] kebab-empty-string
  test('returns empty string for empty input', () => {
    expect(convert('')).toBe('');
  });

  // [TEST:WRITE] kebab-whitespace-trimmed
  test('trims whitespace and converts', () => {
    expect(convert('  helloWorld  ')).toBe('hello-world');
  });

  // [TEST:WRITE] kebab-single-word
  test('handles single lowercase word', () => {
    expect(convert('hello')).toBe('hello');
  });

  // [TEST:WRITE] kebab-complex-mixed
  test('handles complex mixed input', () => {
    expect(convert('myHTTPSConnection')).toBe('my-https-connection');
  });
});

// =============================================================================
// 3. Snake-case conversion
// =============================================================================

describe('convert to snake_case', () => {
  // [TEST:WRITE] snake-from-camel
  test('converts camelCase to snake_case', () => {
    expect(convert('helloWorld', 'snake')).toBe('hello_world');
  });

  // [TEST:WRITE] snake-from-pascal
  test('converts PascalCase to snake_case', () => {
    expect(convert('HelloWorld', 'snake')).toBe('hello_world');
  });

  // [TEST:WRITE] snake-from-kebab
  test('converts kebab-case to snake_case', () => {
    expect(convert('hello-world', 'snake')).toBe('hello_world');
  });

  // [TEST:WRITE] snake-from-acronym
  test('converts acronym input to snake_case', () => {
    expect(convert('parseXMLDocument', 'snake')).toBe('parse_xml_document');
  });

  // [TEST:WRITE] snake-from-digits
  test('converts digit input to snake_case', () => {
    expect(convert('version2Release', 'snake')).toBe('version2_release');
  });

  // [TEST:WRITE] snake-passthrough
  test('passes through already_snake string', () => {
    expect(convert('already_snake', 'snake')).toBe('already_snake');
  });
});

// =============================================================================
// 4. CamelCase conversion
// =============================================================================

describe('convert to camelCase', () => {
  // [TEST:WRITE] camel-from-kebab
  test('converts kebab-case to camelCase', () => {
    expect(convert('hello-world', 'camel')).toBe('helloWorld');
  });

  // [TEST:WRITE] camel-from-snake
  test('converts snake_case to camelCase', () => {
    expect(convert('hello_world', 'camel')).toBe('helloWorld');
  });

  // [TEST:WRITE] camel-from-pascal
  test('converts PascalCase to camelCase', () => {
    expect(convert('HelloWorld', 'camel')).toBe('helloWorld');
  });

  // [TEST:WRITE] camel-from-acronym
  test('converts acronym input to camelCase', () => {
    expect(convert('parseXMLDocument', 'camel')).toBe('parseXmlDocument');
  });

  // [TEST:WRITE] camel-from-digits
  test('converts digit input to camelCase', () => {
    expect(convert('version2Release', 'camel')).toBe('version2Release');
  });

  // [TEST:WRITE] camel-single-word
  test('handles single word', () => {
    expect(convert('hello', 'camel')).toBe('hello');
  });
});

// =============================================================================
// 5. PascalCase conversion
// =============================================================================

describe('convert to PascalCase', () => {
  // [TEST:WRITE] pascal-from-kebab
  test('converts kebab-case to PascalCase', () => {
    expect(convert('hello-world', 'pascal')).toBe('HelloWorld');
  });

  // [TEST:WRITE] pascal-from-snake
  test('converts snake_case to PascalCase', () => {
    expect(convert('hello_world', 'pascal')).toBe('HelloWorld');
  });

  // [TEST:WRITE] pascal-from-camel
  test('converts camelCase to PascalCase', () => {
    expect(convert('helloWorld', 'pascal')).toBe('HelloWorld');
  });

  // [TEST:WRITE] pascal-from-acronym
  test('converts acronym input to PascalCase', () => {
    expect(convert('parseXMLDocument', 'pascal')).toBe('ParseXmlDocument');
  });

  // [TEST:WRITE] pascal-from-digits
  test('converts digit input to PascalCase', () => {
    expect(convert('version2Release', 'pascal')).toBe('Version2Release');
  });

  // [TEST:WRITE] pascal-single-word
  test('handles single word', () => {
    expect(convert('hello', 'pascal')).toBe('Hello');
  });
});
