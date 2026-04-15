import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLI_PATH = path.resolve(__dirname, '..', 'dist', 'cli.js');

function run(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

describe('pantry CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-cli-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('add command', () => {
    // [TEST:WRITE] cli-add-new-item
    test('adds a new item to empty directory, creates pantry.json', () => {
      const { stdout, exitCode } = run(['add', 'rice', '5'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      expect(stdout).toContain('5');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 5 });
    });

    // [TEST:WRITE] cli-add-existing-item
    test('increments existing item quantity', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 5}');
      const { stdout, exitCode } = run(['add', 'rice', '3'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      expect(stdout).toContain('8');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] cli-add-case-normalization
    test('normalizes item name to lowercase', () => {
      const { stdout, exitCode } = run(['add', 'Rice', '2'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 2 });
    });

    // [TEST:WRITE] cli-add-no-low-stock-warning
    test('does not emit low-stock warnings', () => {
      const { stderr, exitCode } = run(['add', 'rice', '1'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    // [TEST:WRITE] cli-add-invalid-quantity-zero
    test('rejects quantity of 0', () => {
      const { stderr, exitCode } = run(['add', 'rice', '0'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-invalid-quantity-negative
    test('rejects negative quantity', () => {
      const { stderr, exitCode } = run(['add', 'rice', '-3'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-invalid-quantity-float
    test('rejects float quantity', () => {
      const { stderr, exitCode } = run(['add', 'rice', '1.5'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-invalid-quantity-string
    test('rejects non-numeric quantity', () => {
      const { stderr, exitCode } = run(['add', 'rice', 'foo'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-invalid-quantity-trailing-chars
    test('rejects quantity with trailing characters', () => {
      const { stderr, exitCode } = run(['add', 'rice', '3abc'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-empty-name
    test('rejects empty name', () => {
      const { stderr, exitCode } = run(['add', '', '1'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-add-missing-args
    test('prints usage when arguments are missing', () => {
      const { exitCode } = run(['add'], tmpDir);
      expect(exitCode).not.toBe(0);
    });

    // [TEST:WRITE] cli-add-extra-args
    test('prints usage when extra arguments provided', () => {
      const { exitCode } = run(['add', 'rice', '1', 'extra'], tmpDir);
      expect(exitCode).not.toBe(0);
    });

    // [TEST:WRITE] cli-add-leading-zero-quantity
    test('accepts leading zero quantity as valid (01 -> 1)', () => {
      const { stdout, exitCode } = run(['add', 'rice', '01'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 1 });
    });
  });

  describe('list command', () => {
    // [TEST:WRITE] cli-list-missing-file
    test('prints empty pantry message when no pantry.json', () => {
      const { stdout, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Pantry is empty');
    });

    // [TEST:WRITE] cli-list-empty-object
    test('prints empty pantry message when pantry.json is {}', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{}');
      const { stdout, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Pantry is empty');
    });

    // [TEST:WRITE] cli-list-alphabetical
    test('lists items in alphabetical order', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"tea": 3, "rice": 8, "beans": 5}');
      const { stdout, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split('\n');
      expect(lines[0]).toContain('beans');
      expect(lines[0]).toContain('5');
      expect(lines[1]).toContain('rice');
      expect(lines[1]).toContain('8');
      expect(lines[2]).toContain('tea');
      expect(lines[2]).toContain('3');
    });

    // [TEST:WRITE] cli-list-low-stock-warning
    test('emits low-stock warnings to stderr after list', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8, "tea": 1}');
      const { stderr, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('Warning');
      expect(stderr).toContain('tea');
      expect(stderr).toContain('1');
    });

    // [TEST:WRITE] cli-list-low-stock-zero
    test('emits low-stock warning for items at quantity 0', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 0}');
      const { stderr, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('Warning');
      expect(stderr).toContain('rice');
      expect(stderr).toContain('0');
    });

    // [TEST:WRITE] cli-list-low-stock-alphabetical
    test('emits low-stock warnings in alphabetical order', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"tea": 1, "beans": 0, "rice": 10}');
      const { stderr, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      const lines = stderr.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('beans');
      expect(lines[1]).toContain('tea');
    });

    // [TEST:WRITE] cli-list-no-warnings-when-all-sufficient
    test('emits no warnings when all items have quantity >= 2', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 5, "tea": 2}');
      const { stderr, exitCode } = run(['list'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
    });

    // [TEST:WRITE] cli-list-extra-args
    test('prints usage when extra arguments provided to list', () => {
      const { exitCode } = run(['list', 'extra'], tmpDir);
      expect(exitCode).not.toBe(0);
    });
  });

  describe('use command', () => {
    // [TEST:WRITE] cli-use-success
    test('uses item and prints confirmation', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stdout, exitCode } = run(['use', 'rice', '4'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      expect(stdout).toContain('4');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 4 });
    });

    // [TEST:WRITE] cli-use-to-zero
    test('allows using entire stock to zero', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stdout, exitCode } = run(['use', 'rice', '8'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
      expect(stdout).toContain('0');
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 0 });
    });

    // [TEST:WRITE] cli-use-low-stock-warning
    test('emits low-stock warning after successful use', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stderr, exitCode } = run(['use', 'rice', '8'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stderr).toContain('Warning');
      expect(stderr).toContain('rice');
    });

    // [TEST:WRITE] cli-use-low-stock-all-items
    test('emits low-stock warnings for all low items after use', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 2, "tea": 1}');
      const { stderr, exitCode } = run(['use', 'rice', '1'], tmpDir);
      expect(exitCode).toBe(0);
      // Both rice (now 1) and tea (1) are low
      expect(stderr).toContain('rice');
      expect(stderr).toContain('tea');
    });

    // [TEST:WRITE] cli-use-insufficient-stock
    test('rejects use when quantity exceeds stock', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stderr, exitCode } = run(['use', 'rice', '100'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
      // File unchanged
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] cli-use-nonexistent-item
    test('rejects use of nonexistent item', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stderr, exitCode } = run(['use', 'nonexistent', '1'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
      // File unchanged
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] cli-use-missing-args
    test('prints usage when arguments are missing', () => {
      const { exitCode } = run(['use'], tmpDir);
      expect(exitCode).not.toBe(0);
    });

    // [TEST:WRITE] cli-use-extra-args
    test('prints usage when extra arguments provided', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { exitCode } = run(['use', 'rice', '1', 'extra'], tmpDir);
      expect(exitCode).not.toBe(0);
    });

    // [TEST:WRITE] cli-use-case-normalization
    test('normalizes item name to lowercase', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 8}');
      const { stdout, exitCode } = run(['use', 'RICE', '1'], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rice');
    });
  });

  describe('usage and errors', () => {
    // [TEST:WRITE] cli-no-args
    test('prints usage and exits non-zero when no arguments given', () => {
      const { exitCode, stderr, stdout } = run([], tmpDir);
      expect(exitCode).not.toBe(0);
      // Usage text should mention all commands
      const output = stderr + stdout;
      expect(output).toContain('pantry add');
      expect(output).toContain('pantry list');
      expect(output).toContain('pantry use');
    });

    // [TEST:WRITE] cli-unknown-command
    test('prints usage and exits non-zero for unknown command', () => {
      const { exitCode, stderr, stdout } = run(['unknown'], tmpDir);
      expect(exitCode).not.toBe(0);
      const output = stderr + stdout;
      expect(output).toContain('pantry add');
      expect(output).toContain('pantry list');
      expect(output).toContain('pantry use');
    });

    // [TEST:WRITE] cli-malformed-json
    test('exits non-zero for malformed pantry.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{bad json');
      const { exitCode, stderr } = run(['list'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-invalid-schema-array
    test('exits non-zero for schema-invalid pantry.json (array)', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '[1,2,3]');
      const { exitCode, stderr } = run(['list'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-invalid-schema-negative
    test('exits non-zero for schema-invalid pantry.json (negative value)', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": -1}');
      const { exitCode, stderr } = run(['list'], tmpDir);
      expect(exitCode).not.toBe(0);
      expect(stderr).toBeTruthy();
    });

    // [TEST:WRITE] cli-failed-command-no-modify
    test('failed add command does not modify existing pantry.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 5}');
      run(['add', 'rice', 'foo'], tmpDir);
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 5 });
    });

    // [TEST:WRITE] cli-failed-use-no-modify
    test('failed use command does not modify existing pantry.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'pantry.json'), '{"rice": 5}');
      run(['use', 'rice', '100'], tmpDir);
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pantry.json'), 'utf-8'));
      expect(data).toEqual({ rice: 5 });
    });
  });
});
