import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  cleanRawOutputContent,
  formatRawOutputForStorage,
  persistRawOutputLog,
  persistRawOutputLogSync,
  buildRawOutputLogPath,
} from '../../src/tui/raw-output-log.js';

describe('raw-output-log', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
  });

  it('removes terminal frames while preserving log text', () => {
    const cleaned = cleanRawOutputContent(
      '╭────────────────────────────╮\n│ 🍌 Bello! Create Issue │\n│   Body: (empty)           │\n╰────────────────────────────╯',
    );

    expect(cleaned).toBe('🍌 Bello! Create Issue\n  Body: (empty)');
  });

  it('reconstructs carriage-return rewrites before stripping frames', () => {
    const cleaned = cleanRawOutputContent(
      'draft text\rfinal text\n╭──────╮\n│ done │\n╰──────╯',
    );

    expect(cleaned).toBe('final text\ndone');
  });

  it('reconstructs backspace rewrites before stripping frames', () => {
    const cleaned = cleanRawOutputContent('abcd\b\bXY\n╭────╮\n│ ok │\n╰────╯');

    expect(cleaned).toBe('abXY\nok');
  });

  it('extracts and pretty-prints the last router JSON object', () => {
    const formatted = formatRawOutputForStorage(
      '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Researc{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research and synthesize a comprehensive overview","dependsOn":[]}]}',
    );

    expect(formatted).toContain('{\n  "kind": "plan"');
    expect(formatted).toContain('"dependsOn": []');
    expect(formatted).not.toContain('Researc{');
  });

  it('writes a sanitized log file under .map/logs', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-raw-log-'));

    const logPath = await persistRawOutputLog(
      tmpDir,
      'router',
      'Router',
      '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Researc{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research and synthesize a comprehensive overview","dependsOn":[]}]}',
      new Date('2026-04-14T12:34:56.000Z'),
    );

    expect(logPath).toBe(buildRawOutputLogPath(
      tmpDir,
      'router',
      'Router',
      new Date('2026-04-14T12:34:56.000Z'),
    ));
    expect(logPath).toContain(path.join('.map', 'logs'));

    const content = await fs.readFile(logPath, 'utf8');
    expect(content).toContain('{\n  "kind": "plan"');
    expect(content).toContain('"dependsOn": []');
  });

  it('writes a sanitized log file synchronously under .map/logs', async () => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'map-raw-log-sync-'));

    const logPath = persistRawOutputLogSync(
      tmpDir,
      'session',
      'session',
      '╭────────╮\n│ Hello │\n╰────────╯',
      new Date('2026-04-14T12:34:56.000Z'),
    );

    expect(logPath).toBe(buildRawOutputLogPath(
      tmpDir,
      'session',
      'session',
      new Date('2026-04-14T12:34:56.000Z'),
    ));
    await expect(fs.readFile(logPath, 'utf8')).resolves.toBe('Hello\n');
  });
});
