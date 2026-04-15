const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { convert } = require('./convert.js');

// =============================================================================
// Phase 1: RED — All tests written before implementation
// =============================================================================

describe('convert(input, style)', () => {

  // ---------------------------------------------------------------------------
  // Core functionality (default = kebab)
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] core-hello-world-default-kebab
  it('converts "hello world" to "hello-world" by default (kebab)', () => {
    assert.strictEqual(convert('hello world', 'kebab'), 'hello-world');
  });

  // [TEST:WRITE] core-hello-world-snake
  it('converts "hello world" to "hello_world" with snake style', () => {
    assert.strictEqual(convert('hello world', 'snake'), 'hello_world');
  });

  // [TEST:WRITE] core-hello-world-explicit-kebab
  it('converts "hello world" to "hello-world" with explicit kebab style', () => {
    assert.strictEqual(convert('hello world', 'kebab'), 'hello-world');
  });

  // ---------------------------------------------------------------------------
  // camelCase and PascalCase splitting
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] camel-helloWorld
  it('splits camelCase: "helloWorld" → "hello-world"', () => {
    assert.strictEqual(convert('helloWorld', 'kebab'), 'hello-world');
  });

  // [TEST:WRITE] pascal-HelloWorld
  it('splits PascalCase: "HelloWorld" → "hello-world"', () => {
    assert.strictEqual(convert('HelloWorld', 'kebab'), 'hello-world');
  });

  // [TEST:WRITE] acronym-getHTTPResponse
  it('splits acronym boundaries: "getHTTPResponse" → "get-http-response"', () => {
    assert.strictEqual(convert('getHTTPResponse', 'kebab'), 'get-http-response');
  });

  // [TEST:WRITE] acronym-XMLParser
  it('splits leading acronym: "XMLParser" → "xml-parser"', () => {
    assert.strictEqual(convert('XMLParser', 'kebab'), 'xml-parser');
  });

  // ---------------------------------------------------------------------------
  // Mixed and degenerate separators
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] mixed-separators
  it('handles mixed separators: "foo_bar-baz qux" → "foo-bar-baz-qux"', () => {
    assert.strictEqual(convert('foo_bar-baz qux', 'kebab'), 'foo-bar-baz-qux');
  });

  // [TEST:WRITE] consecutive-separators
  it('collapses consecutive separators: "foo__bar--baz" → "foo-bar-baz"', () => {
    assert.strictEqual(convert('foo__bar--baz', 'kebab'), 'foo-bar-baz');
  });

  // [TEST:WRITE] all-caps-tokens
  it('handles all-caps input: "FOO BAR" → "foo-bar"', () => {
    assert.strictEqual(convert('FOO BAR', 'kebab'), 'foo-bar');
  });

  // ---------------------------------------------------------------------------
  // Digits
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] digit-boundary
  it('splits digit-to-uppercase boundary: "version2Release" → "version2-release"', () => {
    assert.strictEqual(convert('version2Release', 'kebab'), 'version2-release');
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] single-word-noop
  it('passes through single lowercase word: "hello" → "hello"', () => {
    assert.strictEqual(convert('hello', 'kebab'), 'hello');
  });

  // [TEST:WRITE] empty-string
  it('returns empty string for empty input: "" → ""', () => {
    assert.strictEqual(convert('', 'kebab'), '');
  });

  // ---------------------------------------------------------------------------
  // Snake style variants (ensure joining works for snake too)
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] snake-camelCase
  it('converts camelCase to snake: "helloWorld" → "hello_world"', () => {
    assert.strictEqual(convert('helloWorld', 'snake'), 'hello_world');
  });

  // [TEST:WRITE] snake-acronym
  it('converts acronym input to snake: "getHTTPResponse" → "get_http_response"', () => {
    assert.strictEqual(convert('getHTTPResponse', 'snake'), 'get_http_response');
  });

  // [TEST:WRITE] snake-mixed-separators
  it('converts mixed separators to snake: "foo_bar-baz qux" → "foo_bar_baz_qux"', () => {
    assert.strictEqual(convert('foo_bar-baz qux', 'snake'), 'foo_bar_baz_qux');
  });

  // ---------------------------------------------------------------------------
  // Special / non-alphanumeric characters (treated as separators, discarded)
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] special-chars-as-separators
  it('treats special characters as separators: "hello.world" → "hello-world"', () => {
    assert.strictEqual(convert('hello.world', 'kebab'), 'hello-world');
  });

  // [TEST:WRITE] multiple-special-chars
  it('treats multiple special chars as separators: "foo@bar$baz" → "foo-bar-baz"', () => {
    assert.strictEqual(convert('foo@bar$baz', 'kebab'), 'foo-bar-baz');
  });

  // ---------------------------------------------------------------------------
  // Additional boundary conditions
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] only-separators
  it('returns empty string for input of only separators: "___---   " → ""', () => {
    assert.strictEqual(convert('___---   ', 'kebab'), '');
  });

  // [TEST:WRITE] single-char
  it('handles single character: "A" → "a"', () => {
    assert.strictEqual(convert('A', 'kebab'), 'a');
  });

  // [TEST:WRITE] all-caps-single-word
  it('handles all-caps single word: "HTTP" → "http"', () => {
    assert.strictEqual(convert('HTTP', 'kebab'), 'http');
  });

  // [TEST:WRITE] digit-only
  it('handles digit-only input: "123" → "123"', () => {
    assert.strictEqual(convert('123', 'kebab'), '123');
  });

  // [TEST:WRITE] IOError-acronym
  it('splits two-letter acronym: "IOError" → "io-error"', () => {
    assert.strictEqual(convert('IOError', 'kebab'), 'io-error');
  });
});
