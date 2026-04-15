// Tests for CLI behavior
// Phase 1: RED — All tests written before implementation

const { execFileSync } = require('child_process');
const path = require('path');

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli.js');

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    });
    return { stdout: stdout, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: err.status,
    };
  }
}

// =============================================================================
// 1. Default kebab-case conversion via CLI
// =============================================================================

describe('CLI default (kebab-case)', () => {
  // [TEST:WRITE] cli-camel-to-kebab
  test('converts camelCase to kebab-case', () => {
    const result = run(['helloWorld']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });

  // [TEST:WRITE] cli-pascal-to-kebab
  test('converts PascalCase to kebab-case', () => {
    const result = run(['HelloWorld']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });

  // [TEST:WRITE] cli-snake-to-kebab
  test('converts snake_case to kebab-case', () => {
    const result = run(['hello_world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });

  // [TEST:WRITE] cli-acronym-to-kebab
  test('converts acronym input to kebab-case', () => {
    const result = run(['parseXMLDocument']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('parse-xml-document');
  });

  // [TEST:WRITE] cli-digit-to-kebab
  test('converts digit input to kebab-case', () => {
    const result = run(['version2Release']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('version2-release');
  });

  // [TEST:WRITE] cli-kebab-passthrough
  test('passes through already-kebab string', () => {
    const result = run(['already-kebab']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('already-kebab');
  });

  // [TEST:WRITE] cli-snake-passthrough
  test('converts already_snake to kebab-case', () => {
    const result = run(['already_snake']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('already-snake');
  });
});

// =============================================================================
// 2. --style flag
// =============================================================================

describe('CLI --style flag', () => {
  // [TEST:WRITE] cli-style-kebab
  test('--style kebab produces kebab-case', () => {
    const result = run(['--style', 'kebab', 'helloWorld']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });

  // [TEST:WRITE] cli-style-snake
  test('--style snake produces snake_case', () => {
    const result = run(['--style', 'snake', 'helloWorld']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello_world');
  });

  // [TEST:WRITE] cli-style-camel
  test('--style camel produces camelCase', () => {
    const result = run(['--style', 'camel', 'hello-world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('helloWorld');
  });

  // [TEST:WRITE] cli-style-pascal
  test('--style pascal produces PascalCase', () => {
    const result = run(['--style', 'pascal', 'hello-world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('HelloWorld');
  });
});

// =============================================================================
// 3. Flag ordering — flag before positional arg
// =============================================================================

describe('CLI flag ordering', () => {
  // [TEST:WRITE] cli-flag-before-positional
  test('--style before positional arg works', () => {
    const result = run(['--style', 'snake', 'helloWorld']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello_world');
  });

  // [TEST:WRITE] cli-flag-after-positional
  test('--style after positional arg works', () => {
    const result = run(['helloWorld', '--style', 'snake']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello_world');
  });
});

// =============================================================================
// 4. Empty string input
// =============================================================================

describe('CLI empty string', () => {
  // [TEST:WRITE] cli-empty-string
  test('empty string produces empty line with exit 0', () => {
    const result = run(['']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('\n');
  });
});

// =============================================================================
// 5. Whitespace handling
// =============================================================================

describe('CLI whitespace', () => {
  // [TEST:WRITE] cli-whitespace-trimmed
  test('trims leading/trailing whitespace', () => {
    const result = run(['  helloWorld  ']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello-world');
  });
});

// =============================================================================
// 6. Exit codes
// =============================================================================

describe('CLI exit codes', () => {
  // [TEST:WRITE] cli-exit-0-on-success
  test('exits with code 0 on successful conversion', () => {
    const result = run(['helloWorld']);
    expect(result.exitCode).toBe(0);
  });

  // [TEST:WRITE] cli-exit-nonzero-no-input
  test('exits with non-zero code when no input is provided', () => {
    const result = run([]);
    expect(result.exitCode).not.toBe(0);
  });

  // [TEST:WRITE] cli-exit-nonzero-invalid-style
  test('exits with non-zero code for invalid --style value', () => {
    const result = run(['--style', 'invalid', 'hello']);
    expect(result.exitCode).not.toBe(0);
  });
});
