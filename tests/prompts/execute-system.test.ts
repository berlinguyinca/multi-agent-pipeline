import { describe, it, expect } from 'vitest';
import { buildExecutePrompt } from '../../src/prompts/execute-system.js';

describe('buildExecutePrompt', () => {
  it('includes the reviewed spec content', () => {
    const result = buildExecutePrompt('# Reviewed Spec\n- [ ] CRUD endpoints');
    expect(result).toContain('# Reviewed Spec');
    expect(result).toContain('CRUD endpoints');
  });

  it('instructs TDD phases: RED, GREEN, REFACTOR', () => {
    const result = buildExecutePrompt('test');
    expect(result).toContain('RED');
    expect(result).toContain('GREEN');
    expect(result).toContain('REFACTOR');
  });

  it('instructs to write tests first', () => {
    const result = buildExecutePrompt('test');
    expect(result).toContain('write test files FIRST');
  });

  it('includes test markers for parsing', () => {
    const result = buildExecutePrompt('test');
    expect(result).toContain('[TEST:WRITE]');
    expect(result).toContain('[TEST:PASS]');
    expect(result).toContain('[TEST:FAIL]');
  });
});
