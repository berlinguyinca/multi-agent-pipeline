import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createActor } from 'xstate';
import { createPipelineActor, pipelineMachine } from '../../src/pipeline/machine.js';
import { createPipelineContext } from '../../src/pipeline/context.js';
import { runWithActor, runHeadless, runHeadlessV2 } from '../../src/headless/runner.js';
import type {
  ExecutionResult,
  Spec,
  ReviewedSpec,
  RefinementScore,
  QaAssessment,
} from '../../src/types/spec.js';
import type { HeadlessResult } from '../../src/types/headless.js';
import type { PipelineContext } from '../../src/types/pipeline.js';
import type { PipelineActor } from '../../src/pipeline/machine.js';
import type { AgentAdapter, AdapterConfig, DetectionResult, RunOptions } from '../../src/types/adapter.js';

// ---------------------------------------------------------------------------
// Mock loadConfig at the top level (hoisted by vitest)
// ---------------------------------------------------------------------------

vi.mock('../../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

// Mock gh CLI so resolveGitHubToken doesn't try to exec a real binary
vi.mock('../../src/github/token.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/github/token.js')>();
  return {
    ...actual,
    resolveGitHubToken: async (
      config?: unknown,
      env: NodeJS.ProcessEnv = process.env,
    ) => {
      const token = (env['GITHUB_TOKEN'] as string | undefined)?.trim();
      if (token && token !== '') return token;
      const cfg = config as { github?: { token?: string } } | undefined;
      const cfgToken = cfg?.github?.token;
      if (cfgToken && cfgToken.trim() !== '') return cfgToken.trim();
      return undefined; // Skip gh CLI in tests
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSpec: Spec = {
  content: '# Test Spec',
  version: 1,
  createdAt: new Date(),
  acceptanceCriteria: [],
};

const mockReviewedSpec: ReviewedSpec = {
  content: '# Reviewed Spec',
  version: 1,
  annotations: [],
  originalSpecVersion: 1,
};

const mockScore: RefinementScore = {
  iteration: 1,
  score: 80,
  completeness: 0.8,
  testability: 0.8,
  specificity: 0.8,
  timestamp: new Date(),
};

const mockExecutionResult: ExecutionResult = {
  success: true,
  testsTotal: 4,
  testsPassing: 4,
  testsFailing: 0,
  filesCreated: ['src/index.ts', 'tests/index.test.ts'],
  outputDir: './output',
  duration: 1234,
};

const defaultConfigMock = {
  agents: {
    spec: { adapter: 'claude' as const },
    review: { adapter: 'codex' as const },
    qa: { adapter: 'codex' as const },
    execute: { adapter: 'claude' as const },
    docs: { adapter: 'claude' as const },
  },
  github: {},
  ollama: {
    host: 'http://localhost:11434',
  },
  quality: {
    maxSpecQaIterations: 3,
    maxCodeQaIterations: 3,
  },
  outputDir: './output',
  gitCheckpoints: false,
  headless: {
    totalTimeoutMs: 60 * 60 * 1000,
    inactivityTimeoutMs: 10 * 60 * 1000,
    pollIntervalMs: 10 * 1000,
  },
};

const mockSpecQa: QaAssessment = {
  passed: true,
  target: 'spec',
  summary: 'Spec passed',
  findings: [],
  requiredChanges: [],
  rawOutput: 'QA_RESULT: pass',
  duration: 50,
};

const mockCodeQa: QaAssessment = {
  passed: true,
  target: 'code',
  summary: 'Code passed',
  findings: [],
  requiredChanges: [],
  rawOutput: 'QA_RESULT: pass',
  duration: 50,
};

// ---------------------------------------------------------------------------
// Helper: create a test actor with a subscriber that drives events
// ---------------------------------------------------------------------------

function makeActor(outputDir = './output'): PipelineActor {
  const context = createPipelineContext({
    prompt: 'test prompt',
    agents: {
      spec: { type: 'claude' },
      review: { type: 'codex' },
      qa: { type: 'codex' },
      execute: { type: 'claude' },
      docs: { type: 'claude' },
    },
    outputDir,
  });
  return createActor(pipelineMachine, {
    snapshot: pipelineMachine.resolveState({ value: 'idle', context }),
  }) as PipelineActor;
}

// ---------------------------------------------------------------------------
// State machine auto-approve tests
// ---------------------------------------------------------------------------

describe('headless: state machine auto-approve at feedback', () => {
  it('transitions idle → specifying → reviewing → feedback → executing → complete', () => {
    const actor = makeActor();
    actor.start();

    actor.send({ type: 'START', prompt: 'Build something' });
    expect(actor.getSnapshot().value).toBe('specifying');

    actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
    expect(actor.getSnapshot().value).toBe('reviewing');

    actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
    expect(actor.getSnapshot().value).toBe('specAssessing');

    actor.send({ type: 'SPEC_QA_COMPLETE', assessment: mockSpecQa, maxReached: false });
    expect(actor.getSnapshot().value).toBe('feedback');

    // Simulate headless auto-approve
    actor.send({ type: 'APPROVE' });
    expect(actor.getSnapshot().value).toBe('executing');

    actor.send({ type: 'EXECUTE_COMPLETE', result: mockExecutionResult });
    expect(actor.getSnapshot().value).toBe('codeAssessing');

    actor.send({ type: 'CODE_QA_COMPLETE', assessment: mockCodeQa, maxReached: false });
    expect(actor.getSnapshot().value).toBe('documenting');

    actor.send({
      type: 'DOCS_COMPLETE',
      result: { filesUpdated: ['README.md'], outputDir: './output', duration: 100, rawOutput: 'done' },
    });
    expect(actor.getSnapshot().value).toBe('complete');
    expect(actor.getSnapshot().context.executionResult).toEqual(mockExecutionResult);

    actor.stop();
  });

  it('auto-approve fires exactly once at feedback, not repeatedly', () => {
    const actor = makeActor();
    const approvesSent: string[] = [];

    actor.subscribe((snapshot) => {
      if (snapshot.value === 'feedback') {
        approvesSent.push('approve');
        actor.send({ type: 'APPROVE' });
      }
    });

    actor.start();
    actor.send({ type: 'START', prompt: 'test' });
    actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
    actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
    actor.send({ type: 'SPEC_QA_COMPLETE', assessment: mockSpecQa, maxReached: false });

    // After APPROVE, state is executing — subscriber won't fire again for feedback
    expect(actor.getSnapshot().value).toBe('executing');
    expect(approvesSent).toHaveLength(1);

    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// runWithActor tests — inject actor directly, no module mocking needed
// ---------------------------------------------------------------------------

describe('runWithActor', () => {
  it('returns HeadlessResult with version: 1 on complete path', async () => {
    const actor = makeActor();

    // Drive the machine from an external subscription after runWithActor starts it
    let step = 0;
    const origSubscribe = actor.subscribe.bind(actor);
    actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
      return origSubscribe((snapshot) => {
        if (typeof listener === 'function') listener(snapshot);
        else if (typeof listener === 'object' && listener !== null) {
          (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
        }

        const value = snapshot.value as string;
        if (value === 'specifying' && step === 0) {
          step = 1;
          actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
        } else if (value === 'reviewing' && step === 1) {
          step = 2;
          actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
        } else if (value === 'specAssessing' && step === 2) {
          step = 3;
          actor.send({ type: 'SPEC_QA_COMPLETE', assessment: mockSpecQa, maxReached: false });
        } else if (value === 'executing' && step === 3) {
          step = 4;
          actor.send({ type: 'EXECUTE_COMPLETE', result: mockExecutionResult });
        } else if (value === 'codeAssessing' && step === 4) {
          step = 5;
          actor.send({ type: 'CODE_QA_COMPLETE', assessment: mockCodeQa, maxReached: false });
        } else if (value === 'documenting' && step === 5) {
          step = 6;
          actor.send({
            type: 'DOCS_COMPLETE',
            result: { filesUpdated: ['README.md'], outputDir: './output', duration: 100, rawOutput: 'done' },
          });
        }
      });
    }) as typeof actor.subscribe;

    const result = await runWithActor({ prompt: 'test' }, './output', actor);

    expect(result.version).toBe(1);
    expect(result.success).toBe(true);
    expect(result.testsTotal).toBe(4);
    expect(result.testsPassing).toBe(4);
    expect(result.testsFailing).toBe(0);
    expect(result.filesCreated).toEqual(mockExecutionResult.filesCreated);
    expect(result.spec).toBe(mockReviewedSpec.content);
    expect(result.error).toBeUndefined();
    expect(typeof result.duration).toBe('number');
  });

  it('returns { success: false, error } on failed state', async () => {
    const actor = makeActor();

    let errorSent = false;
    const origSubscribe = actor.subscribe.bind(actor);
    actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
      return origSubscribe((snapshot) => {
        if (typeof listener === 'function') listener(snapshot);
        else if (typeof listener === 'object' && listener !== null) {
          (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
        }

        if (snapshot.value === 'specifying' && !errorSent) {
          errorSent = true;
          actor.send({ type: 'ERROR', error: 'Claude is unavailable' });
        }
      });
    }) as typeof actor.subscribe;

    const result = await runWithActor({ prompt: 'test' }, './output', actor);

    expect(result.version).toBe(1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Claude is unavailable');
    expect(result.filesCreated).toEqual([]);
  });

  it('returns { success: false, error: "Pipeline cancelled" } on cancelled state', async () => {
    const actor = makeActor('/custom/output');

    let cancelSent = false;
    const origSubscribe = actor.subscribe.bind(actor);
    actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
      return origSubscribe((snapshot) => {
        if (typeof listener === 'function') listener(snapshot);
        else if (typeof listener === 'object' && listener !== null) {
          (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
        }

        if (snapshot.value === 'specifying' && !cancelSent) {
          cancelSent = true;
          actor.send({ type: 'CANCEL' });
        }
      });
    }) as typeof actor.subscribe;

    const result = await runWithActor({ prompt: 'test', outputDir: '/custom/output' }, '/custom/output', actor);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Pipeline cancelled');
    expect(result.outputDir).toBe('/custom/output');
  });

  it('captures reviewedSpec content as spec field in result', async () => {
    const actor = makeActor();

    let step = 0;
    const origSubscribe = actor.subscribe.bind(actor);
    actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
      return origSubscribe((snapshot) => {
        if (typeof listener === 'function') listener(snapshot);
        else if (typeof listener === 'object' && listener !== null) {
          (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
        }

        const value = snapshot.value as string;
        if (value === 'specifying' && step === 0) {
          step = 1;
          actor.send({ type: 'SPEC_COMPLETE', spec: mockSpec });
        } else if (value === 'reviewing' && step === 1) {
          step = 2;
          actor.send({
            type: 'REVIEW_COMPLETE',
            reviewedSpec: { ...mockReviewedSpec, content: 'Final reviewed content' },
            score: mockScore,
          });
        } else if (value === 'specAssessing' && step === 2) {
          step = 3;
          actor.send({ type: 'SPEC_QA_COMPLETE', assessment: mockSpecQa, maxReached: false });
        } else if (value === 'executing' && step === 3) {
          step = 4;
          actor.send({ type: 'EXECUTE_COMPLETE', result: mockExecutionResult });
        } else if (value === 'codeAssessing' && step === 4) {
          step = 5;
          actor.send({ type: 'CODE_QA_COMPLETE', assessment: mockCodeQa, maxReached: false });
        } else if (value === 'documenting' && step === 5) {
          step = 6;
          actor.send({
            type: 'DOCS_COMPLETE',
            result: { filesUpdated: ['README.md'], outputDir: './output', duration: 100, rawOutput: 'done' },
          });
        }
      });
    }) as typeof actor.subscribe;

    const result = await runWithActor({ prompt: 'test' }, './output', actor);
    expect(result.spec).toBe('Final reviewed content');
  });

  it('starts from reviewing when initialSpec is provided', async () => {
    const actor = makeActor();

    let step = 0;
    const origSubscribe = actor.subscribe.bind(actor);
    actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
      return origSubscribe((snapshot) => {
        if (typeof listener === 'function') listener(snapshot);
        else if (typeof listener === 'object' && listener !== null) {
          (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
        }

        const value = snapshot.value as string;
        if (value === 'reviewing' && step === 0) {
          step = 1;
          expect(snapshot.context.spec?.content).toBe('# Imported Spec');
          actor.send({ type: 'REVIEW_COMPLETE', reviewedSpec: mockReviewedSpec, score: mockScore });
        } else if (value === 'specAssessing' && step === 1) {
          step = 2;
          actor.send({ type: 'SPEC_QA_COMPLETE', assessment: mockSpecQa, maxReached: false });
        } else if (value === 'executing' && step === 2) {
          step = 3;
          actor.send({ type: 'EXECUTE_COMPLETE', result: mockExecutionResult });
        } else if (value === 'codeAssessing' && step === 3) {
          step = 4;
          actor.send({ type: 'CODE_QA_COMPLETE', assessment: mockCodeQa, maxReached: false });
        } else if (value === 'documenting' && step === 4) {
          step = 5;
          actor.send({
            type: 'DOCS_COMPLETE',
            result: { filesUpdated: ['README.md'], outputDir: './output', duration: 100, rawOutput: 'done' },
          });
        }
      });
    }) as typeof actor.subscribe;

    const result = await runWithActor(
      { prompt: 'review this imported spec', initialSpec: '# Imported Spec', specFilePath: 'docs/spec.md' },
      './output',
      actor,
    );

    expect(result.success).toBe(true);
    expect(result.spec).toBe(mockReviewedSpec.content);
    expect(result.specFilePath).toBe('docs/spec.md');
  });
});

// ---------------------------------------------------------------------------
// runHeadless error path tests (uses mocked loadConfig)
// ---------------------------------------------------------------------------

describe('runHeadless', () => {
  it('returns { success: false, error } when loadConfig throws', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    vi.mocked(loadConfig).mockRejectedValueOnce(new Error('Config file not found'));

    const result = await runHeadless({ prompt: 'test', configPath: '/nonexistent/config.yaml' });

    expect(result.version).toBe(1);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Config file not found');
    expect(result.filesCreated).toEqual([]);
  });

  it('passes options.outputDir through to context when provided', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    vi.mocked(loadConfig).mockResolvedValueOnce(defaultConfigMock);
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-custom-output-'));

    let capturedContext: PipelineContext | null = null;
    const mockActorFactory = (ctx: PipelineContext): PipelineActor => {
      capturedContext = ctx;
      const actor = makeActor(ctx.outputDir);
      // Immediately cancel so runWithActor resolves
      let cancelSent = false;
      const origSubscribe = actor.subscribe.bind(actor);
      actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
        return origSubscribe((snapshot) => {
          if (typeof listener === 'function') listener(snapshot);
          else if (typeof listener === 'object' && listener !== null) {
            (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
          }
          if (snapshot.value === 'specifying' && !cancelSent) {
            cancelSent = true;
            actor.send({ type: 'CANCEL' });
          }
        });
      }) as typeof actor.subscribe;
      return actor;
    };

    await runHeadless({ prompt: 'test', outputDir }, mockActorFactory);

    expect(capturedContext?.outputDir).toBe(outputDir);
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('defaults to current working directory when options.outputDir not provided', async () => {
    const { loadConfig } = await import('../../src/config/loader.js');
    vi.mocked(loadConfig).mockResolvedValueOnce({ ...defaultConfigMock, outputDir: '/from-config' });

    let capturedContext: PipelineContext | null = null;
    const mockActorFactory = (ctx: PipelineContext): PipelineActor => {
      capturedContext = ctx;
      const actor = makeActor(ctx.outputDir);
      let cancelSent = false;
      const origSubscribe = actor.subscribe.bind(actor);
      actor.subscribe = ((listener: Parameters<typeof origSubscribe>[0]) => {
        return origSubscribe((snapshot) => {
          if (typeof listener === 'function') listener(snapshot);
          else if (typeof listener === 'object' && listener !== null) {
            (listener as { next?: (s: typeof snapshot) => void }).next?.(snapshot);
          }
          if (snapshot.value === 'specifying' && !cancelSent) {
            cancelSent = true;
            actor.send({ type: 'CANCEL' });
          }
        });
      }) as typeof actor.subscribe;
      return actor;
    };

    await runHeadless({ prompt: 'test' }, mockActorFactory);

    expect(capturedContext?.outputDir).toBe(process.cwd());
  });

  it('runs the live headless pipeline end-to-end with adapter output', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-live-'));

    class FakeAdapter implements AgentAdapter {
      readonly model: string | undefined = undefined;

      constructor(
        readonly type: AdapterConfig['type'],
        private readonly onRun: (prompt: string, options?: RunOptions) => Promise<string>,
      ) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        yield await this.onRun(prompt, options);
      }

      cancel() {}
    }

    const detection: DetectionResult = {
      claude: { installed: true },
      codex: { installed: true },
      ollama: { installed: true, models: ['tiny'] },
    };

    const result = await runHeadless(
      { prompt: 'Build a calculator library' },
      createPipelineActor,
      {
        loadConfigFn: async () => ({
          agents: {
            spec: { adapter: 'claude' },
            review: { adapter: 'codex' },
            qa: { adapter: 'codex' },
            execute: { adapter: 'claude' },
            docs: { adapter: 'claude' },
          },
          ollama: { host: 'http://localhost:11434' },
          quality: {
            maxSpecQaIterations: 3,
            maxCodeQaIterations: 3,
          },
          outputDir: baseDir,
          gitCheckpoints: false,
          headless: {
            totalTimeoutMs: 60 * 60 * 1000,
            inactivityTimeoutMs: 10 * 60 * 1000,
            pollIntervalMs: 10 * 1000,
          },
        }),
        detectAllAdaptersFn: async () => detection,
        createAdapterFn: (config) => {
          if (config.type === 'codex') {
            return new FakeAdapter('codex', async (prompt) => {
              if (prompt.includes('QA_RESULT: pass|fail')) {
                return 'QA_RESULT: pass\nSUMMARY: Looks good\nFINDING: Meets expectations\n';
              }

              return `
IMPROVEMENT: Add subtraction support

# Calculator Library

## Goal
Build a calculator library.

## Acceptance Criteria
- [ ] Adds numbers
- [ ] Subtracts numbers

SCORES: completeness=0.9 testability=0.8 specificity=0.9
`.trim();
            });
          }

          return new FakeAdapter('claude', async (prompt, options) => {
            if (prompt.includes('senior technical writer') && options?.cwd) {
              await fs.writeFile(path.join(options.cwd, 'README.md'), '# Calculator Library\n', 'utf8');
              return 'Updated README.md';
            }

            if (prompt.includes('strict Test-Driven Development') && options?.cwd) {
              await fs.mkdir(path.join(options.cwd, 'src'), { recursive: true });
              await fs.writeFile(path.join(options.cwd, 'package.json'), '{"name":"calc"}\n', 'utf8');
              await fs.writeFile(path.join(options.cwd, 'src', 'index.ts'), 'export const add = () => 2;\n', 'utf8');
              return '// [TEST:WRITE] adds numbers\n// [TEST:PASS] adds numbers\n';
            }

            return '# Calculator Library\n\n## Goal\nBuild a calculator library.\n\n## Acceptance Criteria\n- [ ] Adds numbers\n';
          });
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.spec).toContain('# Calculator Library');
    expect(result.testsPassing).toBe(1);
    expect(result.filesCreated).toEqual(['package.json', 'src/index.ts']);
    expect(result.documentationResult?.filesUpdated).toEqual(['README.md']);

    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('loops spec QA findings back into another spec iteration', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-spec-qa-loop-'));
    let specRuns = 0;
    let specQaRuns = 0;

    class FakeAdapter implements AgentAdapter {
      readonly model: string | undefined = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        if (prompt.includes('senior QA architect')) {
          specQaRuns += 1;
          yield specQaRuns === 1
            ? 'QA_RESULT: fail\nSUMMARY: Needs edge cases\nREQUIRED_CHANGE: Add edge cases\n'
            : 'QA_RESULT: pass\nSUMMARY: Spec is ready\n';
          return;
        }

        if (prompt.includes('senior QA engineer')) {
          yield 'QA_RESULT: pass\nSUMMARY: Code is ready\n';
          return;
        }

        if (prompt.includes('reviewing a specification')) {
          yield '# Reviewed Spec\n\n## Goal\nBuild it\n\n## Acceptance Criteria\n- [ ] Works\n\nSCORES: completeness=0.8 testability=0.8 specificity=0.8';
          return;
        }

        if (prompt.includes('strict Test-Driven Development') && options?.cwd) {
          await fs.mkdir(path.join(options.cwd, 'src'), { recursive: true });
          await fs.writeFile(path.join(options.cwd, 'src', 'index.ts'), 'export {};\n', 'utf8');
          yield '// [TEST:WRITE] works\n// [TEST:PASS] works\n';
          return;
        }

        if (prompt.includes('senior technical writer') && options?.cwd) {
          await fs.writeFile(path.join(options.cwd, 'README.md'), '# Build It\n', 'utf8');
          yield 'Updated README.md';
          return;
        }

        specRuns += 1;
        yield `# Spec ${specRuns}\n\n## Goal\nBuild it\n\n## Acceptance Criteria\n- [ ] Works\n`;
      }

      cancel() {}
    }

    const result = await runHeadless(
      { prompt: 'Build it' },
      createPipelineActor,
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir: baseDir,
          quality: {
            maxSpecQaIterations: 2,
            maxCodeQaIterations: 1,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    expect(specRuns).toBe(2);
    expect(result.qaAssessments?.map((qa) => qa.passed)).toEqual([false, true, true]);

    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('loops code QA findings back through the execute agent for fixes', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-code-qa-loop-'));
    let codeQaRuns = 0;
    let fixRuns = 0;

    class FakeAdapter implements AgentAdapter {
      readonly model: string | undefined = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        if (prompt.includes('senior QA architect')) {
          yield 'QA_RESULT: pass\nSUMMARY: Spec is ready\n';
          return;
        }

        if (prompt.includes('senior QA engineer')) {
          codeQaRuns += 1;
          yield codeQaRuns === 1
            ? 'QA_RESULT: fail\nSUMMARY: Missing tests\nREQUIRED_CHANGE: Add coverage\n'
            : 'QA_RESULT: pass\nSUMMARY: Code is ready\n';
          return;
        }

        if (prompt.includes('reviewing a specification')) {
          yield '# Reviewed Spec\n\n## Goal\nBuild it\n\n## Acceptance Criteria\n- [ ] Works\n\nSCORES: completeness=0.8 testability=0.8 specificity=0.8';
          return;
        }

        if (prompt.includes('fixing an existing generated project') && options?.cwd) {
          fixRuns += 1;
          await fs.writeFile(path.join(options.cwd, 'README.md'), '# Fixed\n', 'utf8');
          yield '// [TEST:PASS] works\n';
          return;
        }

        if (prompt.includes('strict Test-Driven Development') && options?.cwd) {
          await fs.mkdir(path.join(options.cwd, 'src'), { recursive: true });
          await fs.writeFile(path.join(options.cwd, 'src', 'index.ts'), 'export {};\n', 'utf8');
          yield '// [TEST:WRITE] works\n// [TEST:PASS] works\n';
          return;
        }

        if (prompt.includes('senior technical writer') && options?.cwd) {
          await fs.writeFile(path.join(options.cwd, 'README.md'), '# Build It\n', 'utf8');
          yield 'Updated README.md';
          return;
        }

        yield '# Spec\n\n## Goal\nBuild it\n\n## Acceptance Criteria\n- [ ] Works\n';
      }

      cancel() {}
    }

    const result = await runHeadless(
      { prompt: 'Build it' },
      createPipelineActor,
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir: baseDir,
          quality: {
            maxSpecQaIterations: 1,
            maxCodeQaIterations: 2,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    expect(codeQaRuns).toBe(2);
    expect(fixRuns).toBe(1);
    expect(result.filesCreated).toContain('README.md');

    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('uses GitHub issue content as prompt and posts final report', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-github-'));
    let firstSpecPrompt = '';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            html_url: 'https://github.com/openai/codex/issues/123',
            title: 'Build issue app',
            body: 'Issue body requirements',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ html_url: 'https://github.com/openai/codex/issues/123#issuecomment-1' }), {
          status: 201,
        }),
      );

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        if (prompt.includes('senior QA architect') || prompt.includes('senior QA engineer')) {
          yield 'QA_RESULT: pass\nSUMMARY: Looks good\n';
          return;
        }

        if (prompt.includes('reviewing a specification')) {
          yield '# Reviewed Spec\n\n## Goal\nBuild it\n\nSCORES: completeness=0.8 testability=0.8 specificity=0.8';
          return;
        }

        if (prompt.includes('strict Test-Driven Development') && options?.cwd) {
          await fs.writeFile(path.join(options.cwd, 'package.json'), '{"name":"demo"}\n', 'utf8');
          yield '// [TEST:PASS] works\n';
          return;
        }

        if (prompt.includes('senior technical writer') && options?.cwd) {
          await fs.writeFile(path.join(options.cwd, 'README.md'), '# Demo\n', 'utf8');
          yield 'Updated README.md';
          return;
        }

        firstSpecPrompt = prompt;
        yield '# Spec\n\n## Goal\nBuild it\n';
      }

      cancel() {}
    }

    const result = await runHeadless(
      {
        prompt: 'Additional prompt',
        githubIssueUrl: 'https://github.com/openai/codex/issues/123',
      },
      createPipelineActor,
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir: baseDir,
          quality: {
            maxSpecQaIterations: 1,
            maxCodeQaIterations: 1,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
        fetchFn: fetchMock as typeof fetch,
        env: { GITHUB_TOKEN: 'token' },
      },
    );

    expect(result.success).toBe(true);
    expect(firstSpecPrompt).toContain('Build issue app');
    expect(firstSpecPrompt).toContain('Issue body requirements');
    expect(firstSpecPrompt).toContain('Additional prompt');
    expect(result.githubReport?.posted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('fails before agent execution when GitHub token is missing', async () => {
    let adapterCreated = false;

    const result = await runHeadless(
      {
        prompt: '',
        githubIssueUrl: 'https://github.com/openai/codex/issues/123',
      },
      createPipelineActor,
      {
        loadConfigFn: async () => defaultConfigMock,
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => {
          adapterCreated = true;
          throw new Error(`unexpected adapter ${config.type}`);
        },
        env: {},
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'GitHub token not found. Set GITHUB_TOKEN, add github.token to pipeline.yaml, or run "gh auth login"',
    );
    expect(adapterCreated).toBe(false);
  });

  it('applies v2 router and Ollama CLI overrides before probing and routing', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-overrides-'));
    const adapterConfigs: AdapterConfig[] = [];
    const probeCalls: unknown[] = [];

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        void options;
        if (prompt.includes('You are a task router')) {
          yield JSON.stringify({
            kind: 'plan',
            plan: [{ id: 'step-1', agent: 'researcher', task: 'Research the task', dependsOn: [] }],
            rationale: {
              selectedAgents: [{ agent: 'researcher', reason: 'researcher can gather evidence' }],
              rejectedAgents: [{ agent: 'writer', reason: 'writer is not needed for research-only output' }],
            },
          });
          return;
        }
        if (prompt.includes('Fact-check the researcher report')) {
          yield 'Fact-check verdict: supported\n\nClaims are supported.';
          return;
        }

        yield 'Research result';
      }

      cancel() {}
    }

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runHeadlessV2(
      {
        prompt: 'Research this task',
        outputDir,
        verbose: true,
        routerModel: 'qwen3:latest',
        routerConsensusModels: ['qwen3:latest', 'llama3.1:8b'],
        ollama: {
          host: 'http://127.0.0.1:11435',
          contextLength: 64000,
          numParallel: 4,
          maxLoadedModels: 3,
        },
      },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            consensus: { enabled: true, models: [] },
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => {
          adapterConfigs.push(config);
          return new FakeAdapter(config.type);
        },
        probeOllamaConcurrencyCapacityFn: async (options) => {
          probeCalls.push(options);
          return { maxParallel: 2, testedParallel: 3 };
        },
      },
    );

    expect(result.success).toBe(true);
    const verboseOutput = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(verboseOutput).toContain('Agent decision');
    expect(verboseOutput).toContain('selected researcher');
    expect(verboseOutput).toContain('skipped writer');
    stderrWrite.mockRestore();
    expect(probeCalls[0]).toMatchObject({
      host: 'http://127.0.0.1:11435',
      contextLength: 64000,
      numParallel: 4,
      maxLoadedModels: 3,
      model: 'qwen3:latest',
      models: ['qwen3:latest', 'llama3.1:8b'],
    });
    expect(adapterConfigs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ollama',
          model: 'qwen3:latest',
          host: 'http://127.0.0.1:11435',
          contextLength: 64000,
          numParallel: 4,
          maxLoadedModels: 3,
        }),
        expect.objectContaining({
          type: 'ollama',
          model: 'llama3.1:8b',
          host: 'http://127.0.0.1:11435',
          contextLength: 64000,
          numParallel: 4,
          maxLoadedModels: 3,
        }),
      ]),
    );

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('autonomously creates a suggested agent with consensus and reroutes instead of failing no-match', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-discovery-output-'));
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-discovery-agents-'));
    await fs.mkdir(path.join(agentsDir, 'researcher'), { recursive: true });
    await fs.writeFile(path.join(agentsDir, 'researcher', 'agent.yaml'), [
      'name: researcher',
      'description: "General researcher"',
      'adapter: ollama',
      'model: qwen2.5:7b',
      'prompt: prompt.md',
      'pipeline:',
      '  - name: research',
      'handles: "general research"',
      'output:',
      '  type: answer',
      'tools: []',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(agentsDir, 'researcher', 'prompt.md'), 'You research.');

    const pulledModels: string[] = [];
    let routerCalls = 0;
    const candidateOutputs = [
      `---AGENT_YAML---
name: invoice-generalist
description: "Broad invoice helper"
adapter: ollama
model: placeholder
prompt: prompt.md
pipeline:
  - name: analyze
handles: "invoice helper"
output:
  type: answer
tools: []
---PROMPT_MD---
# Invoice Generalist
Do not use emoji. Use a professional engineering tone.
Generate code and text output in a human-readable form.
Exceptions are allowed only for explicitly requested binary or media artifacts.`,
      `---AGENT_YAML---
name: invoice-analysis-specialist
description: "Analyze invoice anomalies"
adapter: ollama
model: placeholder
prompt: prompt.md
pipeline:
  - name: analyze
handles: "invoice anomaly analysis"
output:
  type: answer
tools: []
---PROMPT_MD---
# Invoice Analysis Specialist
Do not use emoji. Use a professional engineering tone.
Generate code and text output in a human-readable form.
Exceptions are allowed only for explicitly requested binary or media artifacts.`,
      'bad candidate',
    ];

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;
      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a task router')) {
          routerCalls += 1;
          if (routerCalls === 1) {
            yield JSON.stringify({
              kind: 'no-match',
              reason: 'No enabled invoice specialist exists.',
              suggestedAgent: {
                name: 'invoice-analysis-specialist',
                description: 'Analyze invoice anomalies and vendor payment risks',
              },
            });
            return;
          }
          yield JSON.stringify({
            kind: 'plan',
            plan: [{ id: 'step-1', agent: 'invoice-analysis-specialist', task: 'Analyze invoice anomalies', dependsOn: [] }],
          });
          return;
        }
        if (prompt.includes('Generate two files')) {
          yield candidateOutputs.shift() ?? 'bad candidate';
          return;
        }
        yield 'Invoice anomaly report';
      }

      cancel() {}
    }

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runHeadlessV2(
      { prompt: 'Analyze invoice anomalies', outputDir, verbose: true },
      {
        agentsDir,
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          ollama: { host: 'http://localhost:11434', contextLength: 32000, numParallel: 1, maxLoadedModels: 1 },
          router: {
            adapter: 'ollama',
            model: 'qwen2.5:7b',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
            consensus: { enabled: false, models: [], scope: 'router', mode: 'majority' },
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: { adapter: 'ollama', model: 'qwen2.5:7b' },
          agentConsensus: {
            enabled: false,
            runs: 3,
            outputTypes: ['answer'],
            minSimilarity: 0.35,
            perAgent: {},
            fileOutputs: { enabled: false, runs: 3, isolation: 'git-worktree', keepWorktreesOnFailure: true, verificationCommands: [], selection: 'best-passing-minimal-diff' },
          },
          evidence: { enabled: true, mode: 'strict', requiredAgents: [], currentClaimMaxSourceAgeDays: 730, freshnessProfiles: {}, requireRetrievedAtForWebClaims: true, blockUnsupportedCurrentClaims: true, remediationMaxRetries: 0 },
          security: { enabled: false, maxRemediationRetries: 0, adapter: 'ollama', model: 'qwen2.5:7b', staticPatternsEnabled: false, llmReviewEnabled: false },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: ['qwen2.5:7b'] },
          hermes: { installed: true },
          metadata: { installed: true },
          huggingface: { installed: true },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
        ensureOllamaModelReadyFn: async (model) => {
          pulledModels.push(model);
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.steps[0]?.agent).toBe('invoice-analysis-specialist');
    expect(result.agentDiscovery?.[0]).toMatchObject({
      status: 'created',
      suggestedAgent: { name: 'invoice-analysis-specialist' },
      consensus: { selectedCandidate: 2 },
    });
    expect(pulledModels).toEqual(['qwen2.5:7b']);
    const verboseLog = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(verboseLog).toContain('Router recovery attempt 1/3');
    expect(verboseLog).toContain('Preparing Ollama model "qwen2.5:7b"');
    expect(verboseLog).toContain('sent the original prompt back through the router');
    stderrWrite.mockRestore();
    expect(await fs.readdir(agentsDir)).toEqual(expect.arrayContaining(['invoice-analysis-specialist']));

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(agentsDir, { recursive: true, force: true });
  });

  it('runs v2 agents in workspaceDir while keeping reports in outputDir', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-output-'));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-workspace-'));
    const captured: { prompts: string[]; cwds: Array<string | undefined> } = { prompts: [], cwds: [] };

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        captured.prompts.push(prompt);
        captured.cwds.push(options?.cwd);
        if (prompt.includes('You are a task router')) {
          yield '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Inspect existing sources","dependsOn":[]}]}';
          return;
        }
        if (prompt.includes('Fact-check the researcher report')) {
          yield 'Fact-check verdict: supported\n\nClaims are supported.';
          return;
        }

        yield 'Workspace-aware result';
      }

      cancel() {}
    }

    const result = await runHeadlessV2(
      { prompt: 'Add a feature to the existing app', outputDir, workspaceDir } as Parameters<typeof runHeadlessV2>[0] & { workspaceDir: string },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    expect(result.outputDir).toBe(outputDir);
    expect(result.workspaceDir).toBe(workspaceDir);
    expect(captured.cwds).toContain(workspaceDir);
    expect(captured.prompts.join('\n')).toContain('Workspace directory');
    expect(captured.prompts.join('\n')).toContain(workspaceDir);
    expect(result.markdownFiles.every((file) => file.startsWith(outputDir))).toBe(true);

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('filters disabled agents out of smart routing and records rerun hints', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-disabled-agents-'));
    const routerPrompts: string[] = [];

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a task router')) {
          routerPrompts.push(prompt);
          yield '{"kind":"plan","plan":[{"id":"step-1","agent":"docs-maintainer","task":"Summarize the task","dependsOn":[]}]}';
          return;
        }

        yield 'Documentation result';
      }

      cancel() {}
    }

    const result = await runHeadlessV2(
      { prompt: 'Summarize this task', outputDir, disabledAgents: ['researcher'] },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    expect(routerPrompts[0]).not.toContain('**researcher**');
    expect(result.rerun?.disabledAgents).toEqual(['researcher']);
    expect(result.rerun?.command).toContain('map --headless');
    expect(result.rerun?.disableAgentFlag).toBe('--disable-agent <agent-name>');

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('writes an agent summary for v2 runs when enabled', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-summary-'));

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a task router')) {
          yield '{"kind":"plan","plan":[{"id":"step-1","agent":"researcher","task":"Research the topic","dependsOn":[]}]}';
          return;
        }
        if (prompt.includes('Fact-check the researcher report')) {
          yield 'Fact-check verdict: supported\n\nClaims are supported.';
          return;
        }

        yield 'Research result';
      }

      cancel() {}
    }

    const result = await runHeadlessV2(
      { prompt: 'Research this task', outputDir },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          generateAgentSummary: true,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    const summaryPath = path.join(outputDir, 'AGENTS_SUMMARY.md');
    expect(result.markdownFiles).toContain(summaryPath);
    await expect(fs.readFile(summaryPath, 'utf8')).resolves.toContain('### researcher');

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('runs agent ablation comparisons and writes performance memory', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-compare-'));
    const routerPrompts: string[] = [];

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a task router')) {
          routerPrompts.push(prompt);
          if (prompt.includes('**researcher**')) {
            yield JSON.stringify({
              kind: 'plan',
              plan: [{ id: 'step-1', agent: 'researcher', task: 'Research the topic', dependsOn: [] }],
              rationale: {
                selectedAgents: [{ agent: 'researcher', reason: 'Evidence synthesis helps the answer' }],
                rejectedAgents: [{ agent: 'docs-maintainer', reason: 'No docs requested' }],
              },
            });
            return;
          }
          yield '{"kind":"plan","plan":[{"id":"step-1","agent":"docs-maintainer","task":"Summarize without research","dependsOn":[]}]}';
          return;
        }
        if (prompt.includes('Fact-check the researcher report')) {
          yield 'Fact-check verdict: supported\n\nClaims are supported.';
          return;
        }

        yield prompt.includes('Research the topic')
          ? 'Detailed evidence-backed answer with sources'
          : 'Short answer';
      }

      cancel() {}
    }

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runHeadlessV2(
      {
        prompt: 'Research this task',
        outputDir,
        verbose: true,
        compareAgents: ['researcher'],
        semanticJudge: true,
      },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          generateAgentSummary: false,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(true);
    expect(result.routerRationale?.selectedAgents[0]).toEqual({
      agent: 'researcher',
      reason: 'Evidence synthesis helps the answer',
    });
    expect(result.agentComparisons).toEqual([
      expect.objectContaining({
        disabledAgent: 'researcher',
        baselineSuccess: true,
        variantSuccess: true,
        recommendation: expect.stringContaining('Keep'),
      }),
    ]);
    expect(result.semanticJudge).toMatchObject({ enabled: true, method: 'deterministic-output-similarity' });
    expect(routerPrompts.some((prompt) => !prompt.includes('**researcher**'))).toBe(true);
    await expect(fs.readFile(path.join(outputDir, '.map', 'agent-performance.json'), 'utf8'))
      .resolves.toContain('"researcher"');

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('runs an LLM judge panel and steers a weak DAG outcome into an improved rerun', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-judge-panel-'));
    const judgePrompts: string[] = [];
    const adapterConfigs: AdapterConfig[] = [];
    const agentOutputs: string[] = [];

    class FakeAdapter implements AgentAdapter {
      readonly model: string | undefined;

      constructor(readonly type: AdapterConfig['type'], model?: string) {
        this.model = model;
      }

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a MAP outcome judge')) {
          judgePrompts.push(prompt);
          const improved = prompt.includes('Improved answer with concrete verification evidence');
          yield JSON.stringify(improved
            ? {
                verdict: 'accept',
                confidence: 0.91,
                improvements: [],
                rationale: 'The revised answer satisfies the requested improvements.',
                shouldSteer: false,
              }
            : {
                verdict: 'revise',
                confidence: 0.82,
                improvements: ['Add concrete verification evidence', 'Clarify user-facing rerun guidance'],
                rationale: 'The answer is directionally useful but underspecified.',
                shouldSteer: true,
              });
          return;
        }
        if (prompt.includes('You are a task router')) {
          const task = prompt.includes('MAP Judge Panel Steering Feedback')
            ? 'Draft answer with MAP Judge Panel Steering Feedback'
            : 'Draft answer';
          yield JSON.stringify({ kind: 'plan', plan: [{ id: 'step-1', agent: 'docs-maintainer', task, dependsOn: [] }] });
          return;
        }

        const output = prompt.includes('MAP Judge Panel Steering Feedback')
          ? 'Improved answer with concrete verification evidence and rerun guidance'
          : 'Weak answer';
        agentOutputs.push(output);
        yield output;
      }

      cancel() {}
    }

    const result = await runHeadlessV2(
      {
        prompt: 'Explain the feature',
        outputDir,
        judgePanelModels: ['judge-a', 'judge-b', 'judge-c'],
        judgePanelRoles: ['evidence-skeptic', 'recency-auditor', 'contradiction-finder'],
        judgePanelSteer: true,
        judgePanelMaxSteeringRounds: 2,
      },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          generateAgentSummary: false,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => {
          adapterConfigs.push(config);
          return new FakeAdapter(config.type, config.model);
        },
      },
    );

    expect(result.success).toBe(true);
    expect(result.judgePanel).toMatchObject({
      enabled: true,
      verdict: 'accept',
      steeringApplied: true,
      voteCount: 3,
    });
    expect(result.judgePanel?.rounds).toHaveLength(2);
    expect(result.judgePanel?.rounds?.[0]?.verdict).toBe('revise');
    expect(result.judgePanel?.rounds?.[1]?.verdict).toBe('accept');
    expect(result.judgePanel?.votes.map((vote) => vote.model)).toEqual(['judge-a', 'judge-b', 'judge-c']);
    expect(result.judgePanel?.votes.map((vote) => vote.role)).toEqual(['evidence-skeptic', 'recency-auditor', 'contradiction-finder']);
    expect(result.steps.at(-1)?.output).toContain('Improved answer');
    expect(agentOutputs).toContain('Weak answer');
    expect(agentOutputs).toContain('Improved answer with concrete verification evidence and rerun guidance');
    expect(judgePrompts).toHaveLength(6);
    expect(judgePrompts[0]).toContain('Your adversarial judge role is: evidence-skeptic.');
    expect(judgePrompts[1]).toContain('Your adversarial judge role is: recency-auditor.');
    expect(adapterConfigs.filter((config) => config.model === 'judge-a')).toHaveLength(2);

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('allows judge panel entries to use different adapter providers', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-v2-mixed-judges-'));
    const judgeConfigs: AdapterConfig[] = [];

    class FakeAdapter implements AgentAdapter {
      readonly model: string | undefined;

      constructor(readonly type: AdapterConfig['type'], model?: string) {
        this.model = model;
      }

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string): AsyncGenerator<string, void, void> {
        if (prompt.includes('You are a MAP outcome judge')) {
          yield '{"verdict":"accept","confidence":0.9,"improvements":[],"rationale":"Looks good","shouldSteer":false}';
          return;
        }
        if (prompt.includes('You are a task router')) {
          yield '{"kind":"plan","plan":[{"id":"step-1","agent":"docs-maintainer","task":"Draft answer","dependsOn":[]}]}';
          return;
        }
        yield 'Good answer';
      }

      cancel() {}
    }

    const result = await runHeadlessV2(
      {
        prompt: 'Explain the feature',
        outputDir,
        judgePanelModels: ['ollama/judge-a', 'claude/sonnet', 'codex/gpt-5'],
      },
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
          generateAgentSummary: false,
          router: {
            adapter: 'ollama',
            model: 'gemma4',
            maxSteps: 10,
            timeoutMs: 30_000,
            stepTimeoutMs: 30_000,
            maxStepRetries: 0,
            retryDelayMs: 0,
          },
          agentOverrides: {},
          adapterDefaults: {},
          agentCreation: {
            adapter: 'ollama',
            model: 'gemma4',
          },
          security: {
            enabled: false,
            maxRemediationRetries: 0,
            adapter: 'ollama',
            model: 'gemma4',
            staticPatternsEnabled: false,
            llmReviewEnabled: false,
          },
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => {
          if (['judge-a', 'sonnet', 'gpt-5'].includes(config.model ?? '')) judgeConfigs.push(config);
          return new FakeAdapter(config.type, config.model);
        },
      },
    );

    expect(result.judgePanel?.votes.map((vote) => `${vote.provider}/${vote.model}`)).toEqual([
      'ollama/judge-a',
      'claude/sonnet',
      'codex/gpt-5',
    ]);
    expect(judgeConfigs).toEqual([
      expect.objectContaining({ type: 'ollama', model: 'judge-a' }),
      expect.objectContaining({ type: 'claude', model: 'sonnet' }),
      expect.objectContaining({ type: 'codex', model: 'gpt-5' }),
    ]);

    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('fails on inactivity timeout for a silent stage', async () => {
    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(_prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        await waitFor(120, options?.signal);
        yield 'too late';
      }

      cancel() {}
    }

    const result = await runHeadless(
      {
        prompt: 'Build something slow',
        inactivityTimeoutMs: 50,
        totalTimeoutMs: 500,
        pollIntervalMs: 10,
      },
      createPipelineActor,
      {
        loadConfigFn: async () => defaultConfigMock,
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Timed out: inactivity exceeded during spec');
  });

  it('fails on total timeout even when output keeps arriving', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'map-headless-total-timeout-'));

    class FakeAdapter implements AgentAdapter {
      readonly model = undefined;

      constructor(readonly type: AdapterConfig['type']) {}

      async detect() {
        return { installed: true };
      }

      async *run(prompt: string, options?: RunOptions): AsyncGenerator<string, void, void> {
        if (prompt.includes('strict Test-Driven Development')) {
          while (true) {
            await waitFor(15, options?.signal);
            yield '// [TEST:WRITE] still working\n';
          }
        }

        await waitFor(5, options?.signal);
        if (prompt.includes('QA_RESULT: pass|fail')) {
          yield 'QA_RESULT: pass\nSUMMARY: Looks good\n';
          return;
        }

        if (prompt.includes('reviewing a specification')) {
          yield '# Reviewed Spec\n\n## Goal\nKeep going\n\nSCORES: completeness=0.8 testability=0.8 specificity=0.8';
          return;
        }

        yield '# Spec\n\n## Goal\nKeep going\n';
      }

      cancel() {}
    }

    const result = await runHeadless(
      {
        prompt: 'Build something long-running',
        inactivityTimeoutMs: 70,
        totalTimeoutMs: 80,
        pollIntervalMs: 10,
      },
      createPipelineActor,
      {
        loadConfigFn: async () => ({
          ...defaultConfigMock,
          outputDir,
        }),
        detectAllAdaptersFn: async () => ({
          claude: { installed: true },
          codex: { installed: true },
          ollama: { installed: true, models: [] },
        }),
        createAdapterFn: (config) => new FakeAdapter(config.type),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Timed out: total runtime exceeded during execute');

    await fs.rm(outputDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// HeadlessResult type shape
// ---------------------------------------------------------------------------

describe('HeadlessResult shape', () => {
  it('includes all required fields with correct types', () => {
    const result: HeadlessResult = {
      version: 1,
      success: true,
      spec: '# My Spec',
      filesCreated: ['src/index.ts'],
      outputDir: './output',
      testsTotal: 2,
      testsPassing: 2,
      testsFailing: 0,
      duration: 500,
    };

    expect(result.version).toBe(1);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.spec).toBe('string');
    expect(Array.isArray(result.filesCreated)).toBe(true);
    expect(typeof result.outputDir).toBe('string');
    expect(typeof result.testsTotal).toBe('number');
    expect(typeof result.testsPassing).toBe('number');
    expect(typeof result.testsFailing).toBe('number');
    expect(typeof result.duration).toBe('number');
    expect(result.error).toBeUndefined();
  });

  it('allows optional error field', () => {
    const result: HeadlessResult = {
      version: 1,
      success: false,
      spec: '',
      filesCreated: [],
      outputDir: './output',
      testsTotal: 0,
      testsPassing: 0,
      testsFailing: 0,
      duration: 100,
      error: 'something went wrong',
    };

    expect(result.error).toBe('something went wrong');
  });
});

async function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new Error('aborted'));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
