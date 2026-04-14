import { describe, it, expect } from 'vitest';
import { runStaticScan } from '../../src/security/scanner.js';

describe('runStaticScan', () => {
  it('returns passed=true for safe code', () => {
    const result = runStaticScan('const x = 1 + 2;\nconsole.log(x);');
    expect(result.passed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('returns passed=false for dangerous code', () => {
    const result = runStaticScan('eval(userInput);');
    expect(result.passed).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it('reports duration >= 0', () => {
    const result = runStaticScan('const safe = true;');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('collects findings from multiple patterns in same content', () => {
    const code = [
      'eval(userInput);',
      'new Function(code);',
      'writeFileSync("/etc/passwd", payload);',
      'exec("sudo rm -rf /tmp");',
    ].join('\n');
    const result = runStaticScan(code);
    expect(result.passed).toBe(false);
    const rules = new Set(result.findings.map(f => f.rule));
    expect(rules.size).toBeGreaterThanOrEqual(3);
  });

  it('findings have correct structure', () => {
    const result = runStaticScan('eval(dynamicCode);');
    expect(result.findings.length).toBeGreaterThan(0);
    const finding = result.findings[0];
    expect(finding).toHaveProperty('rule');
    expect(finding).toHaveProperty('severity');
    expect(finding).toHaveProperty('message');
    expect(finding).toHaveProperty('line');
    expect(finding).toHaveProperty('snippet');
  });
});
