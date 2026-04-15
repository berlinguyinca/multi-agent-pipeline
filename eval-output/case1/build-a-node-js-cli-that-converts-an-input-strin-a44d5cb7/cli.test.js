const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, 'cli.js');
const NODE = process.execPath;

function run(...args) {
  try {
    const stdout = execFileSync(NODE, [CLI, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
    };
  }
}

// =============================================================================
// Phase 1: RED — All tests written before implementation
// =============================================================================

describe('cli.js integration tests', () => {

  // ---------------------------------------------------------------------------
  // Core functionality
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-hello-world-default
  it('node cli.js "hello world" → stdout: "hello-world\\n"', () => {
    const result = run('hello world');
    assert.strictEqual(result.stdout, 'hello-world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-hello-world-snake
  it('node cli.js "hello world" --style snake → stdout: "hello_world\\n"', () => {
    const result = run('hello world', '--style', 'snake');
    assert.strictEqual(result.stdout, 'hello_world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-hello-world-explicit-kebab
  it('node cli.js "hello world" --style kebab → stdout: "hello-world\\n"', () => {
    const result = run('hello world', '--style', 'kebab');
    assert.strictEqual(result.stdout, 'hello-world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // camelCase and PascalCase splitting
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-camelCase
  it('node cli.js "helloWorld" → stdout: "hello-world\\n"', () => {
    const result = run('helloWorld');
    assert.strictEqual(result.stdout, 'hello-world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-PascalCase
  it('node cli.js "HelloWorld" → stdout: "hello-world\\n"', () => {
    const result = run('HelloWorld');
    assert.strictEqual(result.stdout, 'hello-world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-getHTTPResponse
  it('node cli.js "getHTTPResponse" → stdout: "get-http-response\\n"', () => {
    const result = run('getHTTPResponse');
    assert.strictEqual(result.stdout, 'get-http-response\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-XMLParser
  it('node cli.js "XMLParser" → stdout: "xml-parser\\n"', () => {
    const result = run('XMLParser');
    assert.strictEqual(result.stdout, 'xml-parser\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // Mixed and degenerate separators
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-mixed-separators
  it('node cli.js "foo_bar-baz qux" → stdout: "foo-bar-baz-qux\\n"', () => {
    const result = run('foo_bar-baz qux');
    assert.strictEqual(result.stdout, 'foo-bar-baz-qux\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-consecutive-separators
  it('node cli.js "foo__bar--baz" → stdout: "foo-bar-baz\\n"', () => {
    const result = run('foo__bar--baz');
    assert.strictEqual(result.stdout, 'foo-bar-baz\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-all-caps
  it('node cli.js "FOO BAR" → stdout: "foo-bar\\n"', () => {
    const result = run('FOO BAR');
    assert.strictEqual(result.stdout, 'foo-bar\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // Digits
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-version2Release
  it('node cli.js "version2Release" → stdout: "version2-release\\n"', () => {
    const result = run('version2Release');
    assert.strictEqual(result.stdout, 'version2-release\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-single-word
  it('node cli.js "hello" → stdout: "hello\\n"', () => {
    const result = run('hello');
    assert.strictEqual(result.stdout, 'hello\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // [TEST:WRITE] cli-empty-string
  it('node cli.js "" → stdout: "\\n" (empty output)', () => {
    const result = run('');
    assert.strictEqual(result.stdout, '\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // Flag ordering: --style before positional arg
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-flag-before-positional
  it('node cli.js --style snake "hello world" → stdout: "hello_world\\n"', () => {
    const result = run('--style', 'snake', 'hello world');
    assert.strictEqual(result.stdout, 'hello_world\n');
    assert.strictEqual(result.exitCode, 0);
  });

  // ---------------------------------------------------------------------------
  // Output format: no leading/trailing whitespace beyond trailing \n
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-no-extra-whitespace
  it('output has no leading/trailing whitespace beyond trailing \\n', () => {
    const result = run('hello world');
    assert.ok(!result.stdout.startsWith(' '), 'no leading space');
    assert.ok(!result.stdout.startsWith('\t'), 'no leading tab');
    assert.strictEqual(result.stdout, result.stdout.trimStart().trimEnd() + '\n');
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  // [TEST:WRITE] cli-error-no-args
  it('no arguments → stderr contains "Usage", exit code 1', () => {
    const result = run();
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('Usage'), `stderr should contain "Usage", got: ${result.stderr}`);
    assert.ok(result.stderr.includes('cli.js <string> [--style kebab|snake]'), `stderr should contain syntax pattern`);
  });

  // [TEST:WRITE] cli-error-multiple-positional
  it('multiple positional args → stderr contains "Usage", exit code 1', () => {
    const result = run('a', 'b');
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('Usage'), `stderr should contain "Usage", got: ${result.stderr}`);
  });

  // [TEST:WRITE] cli-error-invalid-style
  it('--style invalid → stderr contains "Invalid style", exit code 1', () => {
    const result = run('hello', '--style', 'invalid');
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('Invalid style'), `stderr should contain "Invalid style", got: ${result.stderr}`);
    assert.ok(result.stderr.includes('invalid'), `stderr should contain the invalid value`);
  });

  // [TEST:WRITE] cli-error-style-missing-value
  it('--style with no value → stderr contains "Invalid style", exit code 1', () => {
    const result = run('hello', '--style');
    assert.strictEqual(result.exitCode, 1);
    assert.ok(result.stderr.includes('Invalid style'), `stderr should contain "Invalid style", got: ${result.stderr}`);
  });
});
