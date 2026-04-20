import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  VerboseReporter,
  SilentReporter,
  createReporter,
  type VerboseWriter,
} from '../../src/utils/verbose-reporter.js';

function createTestWriter(): VerboseWriter & { output: string[] } {
  const output: string[] = [];
  return {
    output,
    write(text: string) {
      output.push(text);
    },
    clearLine() {
      output.push('[CLEAR]');
    },
  };
}

describe('VerboseReporter', () => {
  let writer: ReturnType<typeof createTestWriter>;
  let reporter: VerboseReporter;

  beforeEach(() => {
    writer = createTestWriter();
    reporter = new VerboseReporter(writer);
  });

  it('logs pipeline start with truncated prompt', () => {
    reporter.pipelineStart('Build a todo app');
    const line = writer.output.find((s) => s.includes('Pipeline started'));
    expect(line).toBeDefined();
    expect(line).toContain('Build a todo app');
  });

  it('truncates long prompts at 80 characters', () => {
    const longPrompt = 'A'.repeat(100);
    reporter.pipelineStart(longPrompt);
    const line = writer.output.find((s) => s.includes('Pipeline started'));
    expect(line).toContain('…');
    expect(line).not.toContain('A'.repeat(100));
  });

  it('logs stage start with description', () => {
    reporter.stageStart('spec');
    const line = writer.output.find((s) => s.includes('Specification'));
    expect(line).toBeDefined();
    expect(line).toContain('Generating specification from prompt');
  });

  it('logs stage start with iteration number', () => {
    reporter.stageStart('spec', 3);
    const line = writer.output.find((s) => s.includes('Specification'));
    expect(line).toContain('iteration 3');
  });

  it('omits iteration label for iteration 1', () => {
    reporter.stageStart('spec', 1);
    const line = writer.output.find((s) => s.includes('Specification'));
    expect(line).not.toContain('iteration');
  });

  it('logs stage complete with duration and bytes', () => {
    reporter.stageStart('review');
    reporter.onChunk(2048);
    reporter.stageComplete('review', 5000);
    const line = writer.output.find((s) => s.includes('Review complete'));
    expect(line).toBeDefined();
    expect(line).toContain('2.0 KB');
  });

  it('logs stage failure', () => {
    reporter.stageFailed('execute', 'adapter crashed');
    const line = writer.output.find((s) => s.includes('Execution failed'));
    expect(line).toContain('adapter crashed');
  });

  it('tracks chunk bytes', () => {
    reporter.stageStart('spec');
    reporter.onChunk(100);
    reporter.onChunk(200);
    reporter.onChunk(300);
    reporter.stageComplete('spec', 1000);
    const line = writer.output.find((s) => s.includes('Specification complete'));
    expect(line).toContain('600 B');
  });

  it('logs spec QA pass', () => {
    reporter.specQaResult(true, 1, 3);
    const line = writer.output.find((s) => s.includes('Spec QA passed'));
    expect(line).toContain('iteration 1');
  });

  it('logs spec QA fail with retry info', () => {
    reporter.specQaResult(false, 2, 3);
    const line = writer.output.find((s) => s.includes('Spec QA failed'));
    expect(line).toContain('2/3');
  });

  it('logs code QA pass', () => {
    reporter.codeQaResult(true, 1, 3);
    const line = writer.output.find((s) => s.includes('Code QA passed'));
    expect(line).toBeDefined();
  });

  it('logs code QA fail with retry info', () => {
    reporter.codeQaResult(false, 1, 3);
    const line = writer.output.find((s) => s.includes('Code QA failed'));
    expect(line).toContain('1/3');
  });

  it('logs adapter failover', () => {
    reporter.adapterFailover('claude', 'codex');
    const line = writer.output.find((s) => s.includes('quota exhausted'));
    expect(line).toBeDefined();
    expect(line).toContain('claude');
    expect(line).toContain('codex');
  });

  it('logs pipeline complete on success', () => {
    reporter.pipelineComplete(true, 60000);
    const line = writer.output.find((s) => s.includes('Task finished successfully'));
    expect(line).toContain('01:00');
  });

  it('logs pipeline failed on failure', () => {
    reporter.pipelineComplete(false, 30000);
    const line = writer.output.find((s) => s.includes('Task finished with errors'));
    expect(line).toBeDefined();
  });

  // DAG events

  it('logs DAG routing start', () => {
    reporter.dagRoutingStart();
    const line = writer.output.find((s) => s.includes('Router'));
    expect(line).toContain('Planning task execution DAG');
  });

  it('logs DAG routing complete with step count', () => {
    reporter.dagRoutingComplete(5, 3000);
    const line = writer.output.find((s) => s.includes('Router complete'));
    expect(line).toContain('5 steps');
  });

  it('uses distinct colors for different agents and step ids', () => {
    const colorWriter = createTestWriter();
    colorWriter.supportsColor = true;
    const colorReporter = new VerboseReporter(colorWriter);

    colorReporter.dagStepStart('step-1', 'implementation-coder', 'Implement');
    colorReporter.dagStepStart('step-2', 'legal-license-advisor', 'Recommend licenses');

    const output = colorWriter.output.join('');
    const implementationColor = output.match(/\x1b\[([0-9;]+)mimplementation-coder\x1b\[0m/)?.[1];
    const legalColor = output.match(/\x1b\[([0-9;]+)mlegal-license-advisor\x1b\[0m/)?.[1];
    const stepOneColor = output.match(/\x1b\[([0-9;]+)mstep-1\x1b\[0m/)?.[1];
    const stepTwoColor = output.match(/\x1b\[([0-9;]+)mstep-2\x1b\[0m/)?.[1];

    expect(implementationColor).toBeDefined();
    expect(legalColor).toBeDefined();
    expect(implementationColor).not.toBe(legalColor);
    expect(stepOneColor).toBeDefined();
    expect(stepTwoColor).toBeDefined();
    expect(stepOneColor).not.toBe(stepTwoColor);
  });

  it('colorizes agent decisions, agents, and verdicts when color is supported', () => {
    const colorWriter = createTestWriter();
    colorWriter.supportsColor = true;
    const colorReporter = new VerboseReporter(colorWriter);

    colorReporter.agentDecision({
      by: 'router',
      agent: 'implementation-coder',
      decision: 'selected',
      reason: 'best fit for code changes',
    });
    colorReporter.dagStepStart('step-1', 'implementation-coder', 'Implement the fix');
    colorReporter.crossReviewDecision({
      stepId: 'step-1',
      gate: 'fileOutputs',
      decision: 'revise',
      round: 1,
      reason: 'missing test',
    });

    const output = colorWriter.output.join('');
    expect(output).toContain('\x1b[');
    expect(output).toMatch(/\x1b\[[0-9;]+mimplementation-coder\x1b\[0m/);
    expect(output).toMatch(/\x1b\[[0-9;]+mselected\x1b\[0m/);
    expect(output).toMatch(/decision=\x1b\[[0-9;]+mrevise\x1b\[0m/);
  });

  it('renders failures as red with an indented why line', () => {
    const colorWriter = createTestWriter();
    colorWriter.supportsColor = true;
    const colorReporter = new VerboseReporter(colorWriter);

    colorReporter.dagStepFailed('step-9', 'code-qa-analyst', 'missing implementation artifacts\nsecondary detail');

    const output = colorWriter.output.join('');
    expect(output).toMatch(/\x1b\[31m✘\x1b\[0m/);
    expect(output).toMatch(/\x1b\[31mfailed\x1b\[0m/);
    expect(output).toContain('  ');
    expect(output).toContain('↳ Why:');
    expect(output).toContain('missing implementation artifacts');
    expect(output).not.toContain('secondary detail');
  });

  it('logs agent routing and helper decisions', () => {
    reporter.agentDecision({
      by: 'router',
      agent: 'usage-classification-tree',
      decision: 'selected',
      reason: 'specialized usage evidence is needed',
    });
    reporter.agentDecision({
      by: 'router',
      agent: 'researcher',
      decision: 'skipped',
      reason: 'specialized taxonomy and usage agents cover this request',
    });
    reporter.agentDecision({
      by: 'step-2 [usage-classification-tree]',
      agent: 'usage-classification-fact-checker',
      decision: 'added',
      stepId: 'step-2-fact-check-1',
      reason: 'medium evidence warning requires independent review',
    });
    reporter.agentDecision({
      by: 'step-3 [writer]',
      agent: 'grammar-spelling-specialist',
      decision: 'not-needed',
      reason: 'output is structured data',
    });

    expect(writer.output.find((s) => s.includes('selected usage-classification-tree'))).toContain('specialized usage evidence');
    expect(writer.output.find((s) => s.includes('skipped researcher'))).toContain('specialized taxonomy');
    const addedLine = writer.output.find((s) => s.includes('usage-classification-fact-checker') && s.includes('step-2-fact-check-1'));
    expect(addedLine).toMatch(/medium\s+evidence\s+warning/);
    const notNeededLine = writer.output.find((s) => s.includes('grammar-spelling-specialist') && s.includes('did not add'));
    expect(notNeededLine).toContain('structured data');
  });

  it('logs cross-review decisions', () => {
    const writes: string[] = [];
    const reporter = new VerboseReporter({
      supportsColor: false,
      write(text) { writes.push(text); },
      clearLine() {},
    });

    reporter.crossReviewDecision({
      stepId: 'step-1',
      gate: 'fileOutputs',
      decision: 'revise',
      round: 1,
      reason: 'missing regression test',
    });

    expect(writes.join('')).toContain('Cross-review');
    expect(writes.join('')).toContain('step-1');
    expect(writes.join('')).toContain('missing regression test');
  });

  it('logs DAG routing complete singular step', () => {
    reporter.dagRoutingComplete(1, 1000);
    const line = writer.output.find((s) => s.includes('Router complete'));
    expect(line).toContain('1 step planned');
  });

  it('logs DAG step start with truncated task', () => {
    reporter.dagStepStart('s1', 'coder', 'Implement the widget');
    const line = writer.output.find((s) => s.includes('Step s1'));
    expect(line).toContain('[coder]');
    expect(line).toContain('Implement the widget');
  });

  it('truncates long DAG task descriptions', () => {
    const longTask = 'X'.repeat(80);
    reporter.dagStepStart('s1', 'coder', longTask);
    const line = writer.output.find((s) => s.includes('Step s1'));
    expect(line).toContain('…');
  });


  it('logs sanitized DAG step output snippets for live inspection', () => {
    reporter.dagStepOutput('s1', 'researcher', 'Ths output\ncontains details\n'.repeat(8));
    const line = writer.output.find((s) => s.includes('Output s1') && s.includes('[researcher]'));
    expect(line).toBeDefined();
    expect(line).toContain('Ths output');
    expect(line).toContain('contains details');
  });

  it('logs DAG step complete', () => {
    reporter.dagStepComplete('s1', 'coder', 5000);
    const line = writer.output.find((s) => s.includes('Step s1') && s.includes('complete'));
    expect(line).toBeDefined();
  });

  it('logs DAG step failed with an indented one-line reason', () => {
    reporter.dagStepFailed('s2', 'tester', 'timeout\nfull stack trace');
    const line = writer.output.find((s) => s.includes('Step s2') && s.includes('failed'));
    expect(line).toContain('↳ Why: timeout');
    expect(line).not.toContain('full stack trace');
  });

  it('logs DAG step skipped', () => {
    reporter.dagStepSkipped('s3', 'Dependency failed: s2');
    const line = writer.output.find((s) => s.includes('Step s3') && s.includes('skipped'));
    expect(line).toContain('Dependency failed');
  });

  it('logs DAG complete success', () => {
    reporter.dagComplete(true, 10000);
    const line = writer.output.find((s) => s.includes('Task finished successfully'));
    expect(line).toBeDefined();
  });

  it('logs DAG complete failure', () => {
    reporter.dagComplete(false, 10000);
    const line = writer.output.find((s) => s.includes('Task finished with errors'));
    expect(line).toBeDefined();
  });

  it('dispose cleans up without error', () => {
    reporter.stageStart('spec');
    expect(() => reporter.dispose()).not.toThrow();
  });

  it('includes elapsed timestamp in each line', () => {
    reporter.pipelineStart('test');
    const line = writer.output.find((s) => s.includes('Pipeline started'));
    // Should match [MM:SS] pattern
    expect(line).toMatch(/\[\d{2}:\d{2}\]/);
  });
});

describe('SilentReporter', () => {
  it('produces no output for any method', () => {
    const reporter = new SilentReporter();
    reporter.pipelineStart('test');
    reporter.stageStart('spec');
    reporter.onChunk(100);
    reporter.stageComplete('spec', 1000);
    reporter.specQaResult(true, 1, 3);
    reporter.codeQaResult(true, 1, 3);
    reporter.adapterFailover('a', 'b');
    reporter.dagRoutingStart();
    reporter.dagRoutingComplete(5, 1000);
    reporter.dagStepStart('s1', 'a', 'b');
    reporter.dagStepComplete('s1', 'a', 1000);
    reporter.dagStepOutput('s1', 'a', 'output');
    reporter.dagStepFailed('s1', 'a', 'err');
    reporter.dagStepSkipped('s1', 'reason');
    reporter.dagComplete(true, 1000);
    reporter.pipelineComplete(true, 1000);
    reporter.dispose();
    // No throw = success; SilentReporter is no-op
  });
});

describe('createReporter', () => {
  it('returns VerboseReporter when verbose is true', () => {
    const reporter = createReporter(true);
    expect(reporter).toBeInstanceOf(VerboseReporter);
    expect(reporter).not.toBeInstanceOf(SilentReporter);
    reporter.dispose();
  });

  it('returns SilentReporter when verbose is false', () => {
    const reporter = createReporter(false);
    expect(reporter).toBeInstanceOf(SilentReporter);
    reporter.dispose();
  });
});
