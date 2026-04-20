# Cross-Model Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autonomous cross-model review loops for high-impact MAP planning, release, security-sensitive, and file-changing software-delivery tasks while leaving routing protected by router consensus.

**Architecture:** Add a small typed cross-review surface, a gate planner, and a loop scheduler that reuses existing DAG mutation patterns. Cross-review creates visible peer-review, judge, and revision nodes, never asks the user to choose between model opinions, and records a decision ledger in step results plus final output metadata.

**Tech Stack:** TypeScript, Vitest, existing MAP DAG/orchestrator, existing adapter factory, existing judge-panel parsing patterns, existing graph/result-format renderers.

---

## File structure and responsibilities

- Create `src/orchestrator/cross-review.ts` — pure gate selection, helper-step construction, judge JSON parsing, ledger extraction, and downstream rewiring helpers.
- Modify `src/types/config.ts` — add `CrossReviewConfig` and related typed config surfaces.
- Modify `src/types/dag.ts` — add review/judge edge types and per-step cross-review ledger types.
- Modify `src/types/headless.ts` — expose final `crossReview` result summary and CLI option fields.
- Modify `src/config/defaults.ts` — add default-on high-impact cross-review config with 2 max rounds and 5 upper bound.
- Modify `src/config/schema.ts` — validate `crossReview` config.
- Modify `src/config/loader.ts` — merge nested `crossReview` config.
- Modify `src/cli-args.ts` and `src/cli-runner.ts` — add CLI flags for disabling, round count, and judge models.
- Modify `src/headless/runner.ts` — apply CLI overrides, pass config to the orchestrator, and include cross-review in result building.
- Modify `src/orchestrator/orchestrator.ts` — call the cross-review scheduler after high-impact completed steps and convert judge decisions into revision nodes.
- Modify `src/headless/result-builder.ts` — collect cross-review summaries from step ledgers.
- Modify `src/output/result-format.ts` — render cross-review summaries in Markdown, text, HTML, and compact output.
- Modify `src/dag/graph-renderer.ts` — render `review` and `judge` edge labels.
- Modify `src/utils/verbose-reporter.ts` — add cross-review progress events.
- Modify `README.md` and `AGENTS.md` — document behavior, config, CLI flags, and autonomy contract.
- Create `tests/orchestrator/cross-review.test.ts` — unit coverage for gate decisions, helper node creation, judge parsing, and ledger collection.
- Modify `tests/config/defaults.test.ts`, `tests/config/loader.test.ts`, `tests/cli-args.test.ts`, `tests/cli-runner.test.ts`, `tests/headless/result-builder.test.ts`, `tests/orchestrator/orchestrator.test.ts`, `tests/output/result-format.test.ts`, `tests/dag/graph-renderer.test.ts`, and `tests/utils/verbose-reporter.test.ts`.

## Task 1: Add typed config and DAG/result surfaces

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src/types/dag.ts`
- Modify: `src/types/headless.ts`
- Modify: `tests/config/defaults.test.ts`

- [ ] **Step 1: Write failing type/default assertions**

Add these expectations to `tests/config/defaults.test.ts` in the existing default-config test block or create a new `it('enables autonomous cross-review for high-impact gates by default', ...)` block:

```ts
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';

it('enables autonomous cross-review for high-impact gates by default', () => {
  expect(DEFAULT_CONFIG.crossReview.enabled).toBe(true);
  expect(DEFAULT_CONFIG.crossReview.defaultHighImpactOnly).toBe(true);
  expect(DEFAULT_CONFIG.crossReview.autonomy).toBe('nonblocking');
  expect(DEFAULT_CONFIG.crossReview.maxRounds).toBe(2);
  expect(DEFAULT_CONFIG.crossReview.maxRoundsUpperBound).toBe(5);
  expect(DEFAULT_CONFIG.crossReview.judge.preferSeparatePanel).toBe(true);
  expect(DEFAULT_CONFIG.crossReview.gates).toMatchObject({
    planning: true,
    routing: false,
    architecture: false,
    apiContract: false,
    fileOutputs: true,
    security: true,
    releaseReadiness: true,
    verificationFailure: false,
  });
});
```

- [ ] **Step 2: Run the targeted test and confirm the red state**

Run:

```bash
npx vitest run tests/config/defaults.test.ts
```

Expected: fail with TypeScript or runtime errors referencing missing `crossReview` on `PipelineConfig` or `DEFAULT_CONFIG`.

- [ ] **Step 3: Add config types**

In `src/types/config.ts`, add these exported types above `PipelineConfig`:

```ts
export type CrossReviewGateKey =
  | 'planning'
  | 'routing'
  | 'architecture'
  | 'apiContract'
  | 'fileOutputs'
  | 'security'
  | 'releaseReadiness'
  | 'verificationFailure';

export interface CrossReviewJudgeConfig {
  preferSeparatePanel: boolean;
  models: string[];
  roles: string[];
}

export interface CrossReviewRoleModelConfig {
  proposer?: string;
  reviewer?: string;
}

export interface CrossReviewConfig {
  enabled: boolean;
  defaultHighImpactOnly: boolean;
  maxRounds: number;
  maxRoundsUpperBound: number;
  autonomy: 'nonblocking';
  judge: CrossReviewJudgeConfig;
  gates: Record<CrossReviewGateKey, boolean>;
  roleModels: Record<string, CrossReviewRoleModelConfig>;
}
```

Then add this property to `PipelineConfig`:

```ts
  crossReview: CrossReviewConfig;
```

- [ ] **Step 4: Add DAG ledger and edge types**

In `src/types/dag.ts`, replace `DAGEdgeType` with:

```ts
export type DAGEdgeType = 'planned' | 'handoff' | 'recovery' | 'spawned' | 'feedback' | 'review' | 'judge';
```

Add these interfaces above `StepResult`:

```ts
export interface CrossReviewParticipant {
  role: 'proposer' | 'reviewer' | 'judge';
  agent?: string;
  provider?: string;
  model?: string;
}

export interface CrossReviewLedger {
  rootStepId: string;
  round: number;
  gate: string;
  status: 'pending' | 'accepted' | 'revision-requested' | 'revised' | 'budget-exhausted' | 'degraded';
  participants: CrossReviewParticipant[];
  critiqueSummary?: string;
  judgeDecision?: 'accept' | 'revise' | 'combine' | 'degraded';
  judgeRationale?: string;
  requestedRemediation?: string[];
  reviewStepId?: string;
  judgeStepId?: string;
  revisionStepId?: string;
  verificationSummary?: string;
  residualRisks: string[];
  budgetExhausted: boolean;
}
```

Add this property to `StepResult`:

```ts
  crossReview?: CrossReviewLedger;
```

Add this property to `DAGNode`:

```ts
  crossReview?: CrossReviewLedger;
```

In `buildDAGResult`, include the ledger in node construction:

```ts
      ...(result?.crossReview ? { crossReview: result.crossReview } : {}),
```

- [ ] **Step 5: Add headless result surface**

In `src/types/headless.ts`, import `CrossReviewLedger` from `./dag.js` and add:

```ts
export interface HeadlessCrossReviewSummary {
  enabled: boolean;
  totalReviewed: number;
  accepted: number;
  revised: number;
  degraded: number;
  budgetExhausted: number;
  ledgers: CrossReviewLedger[];
}
```

Add these fields to `HeadlessOptions`:

```ts
  crossReviewEnabled?: boolean;
  crossReviewMaxRounds?: number;
  crossReviewJudgeModels?: string[];
```

Add this field to `HeadlessResultV2`:

```ts
  crossReview?: HeadlessCrossReviewSummary;
```

- [ ] **Step 6: Run the targeted test again**

Run:

```bash
npx vitest run tests/config/defaults.test.ts
```

Expected: still fail because defaults are not implemented yet.

- [ ] **Step 7: Commit this red/typed surface only if project policy allows red commits**

Skip the commit when working on a branch that requires green commits. Otherwise:

```bash
git add src/types/config.ts src/types/dag.ts src/types/headless.ts tests/config/defaults.test.ts
git commit -m "Expose cross-review config and ledger surfaces" \
  -m "Cross-model review needs typed runtime, DAG, and headless result surfaces before orchestration can be added."
```

## Task 2: Add defaults, validation, and config merging

**Files:**
- Modify: `src/config/defaults.ts`
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `tests/config/defaults.test.ts`
- Modify: `tests/config/loader.test.ts`

- [ ] **Step 1: Add config-loader tests first**

Add this test to `tests/config/loader.test.ts` near existing merge tests:

```ts
it('merges nested crossReview config without dropping default gates', async () => {
  const configPath = path.join(tmpDir, 'pipeline.yaml');
  await fs.writeFile(configPath, `
crossReview:
  enabled: false
  maxRounds: 4
  judge:
    models:
      - ollama/gemma4:26b
      - ollama/qwen3.6
  gates:
    security: false
`, 'utf-8');

  const config = await loadConfig(configPath);

  expect(config.crossReview.enabled).toBe(false);
  expect(config.crossReview.maxRounds).toBe(4);
  expect(config.crossReview.gates.security).toBe(false);
  expect(config.crossReview.gates.fileOutputs).toBe(true);
  expect(config.crossReview.judge.preferSeparatePanel).toBe(true);
  expect(config.crossReview.judge.models).toEqual(['ollama/gemma4:26b', 'ollama/qwen3.6']);
});
```

- [ ] **Step 2: Add schema validation tests**

Add these assertions to `tests/config/loader.test.ts`:

```ts
it('rejects invalid crossReview round counts', async () => {
  const configPath = path.join(tmpDir, 'pipeline.yaml');
  await fs.writeFile(configPath, `
crossReview:
  maxRounds: 9
`, 'utf-8');

  await expect(loadConfig(configPath)).rejects.toThrow('crossReview.maxRounds must be at most crossReview.maxRoundsUpperBound');
});

it('rejects unsupported crossReview autonomy modes', async () => {
  const configPath = path.join(tmpDir, 'pipeline.yaml');
  await fs.writeFile(configPath, `
crossReview:
  autonomy: blocking
`, 'utf-8');

  await expect(loadConfig(configPath)).rejects.toThrow('crossReview.autonomy must be "nonblocking"');
});
```

- [ ] **Step 3: Run tests and confirm red state**

Run:

```bash
npx vitest run tests/config/defaults.test.ts tests/config/loader.test.ts
```

Expected: fail because defaults and validation are not present.

- [ ] **Step 4: Add default config**

In `src/config/defaults.ts`, update the import to include `CrossReviewConfig` and add:

```ts
export const DEFAULT_CROSS_REVIEW_CONFIG: CrossReviewConfig = {
  enabled: true,
  defaultHighImpactOnly: true,
  maxRounds: 2,
  maxRoundsUpperBound: 5,
  autonomy: 'nonblocking',
  judge: {
    preferSeparatePanel: true,
    models: [],
    roles: [],
  },
  gates: {
    planning: true,
    routing: false,
    architecture: false,
    apiContract: false,
    fileOutputs: true,
    security: true,
    releaseReadiness: true,
    verificationFailure: false,
  },
  roleModels: {},
};
```

Add this property inside `DEFAULT_CONFIG`:

```ts
  crossReview: DEFAULT_CROSS_REVIEW_CONFIG,
```

- [ ] **Step 5: Add schema validation**

In `src/config/schema.ts`, import `DEFAULT_CROSS_REVIEW_CONFIG` and `CrossReviewConfig`. Add this constant near validation constants:

```ts
const VALID_CROSS_REVIEW_GATES = [
  'planning',
  'routing',
  'architecture',
  'apiContract',
  'fileOutputs',
  'security',
  'releaseReadiness',
  'verificationFailure',
] as const;
```

Add these functions near `validateAgentConsensusConfig`:

```ts
function validateCrossReviewConfig(value: unknown): CrossReviewConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('crossReview must be an object');
  }
  const obj = value as Record<string, unknown>;
  const config: CrossReviewConfig = {
    ...DEFAULT_CROSS_REVIEW_CONFIG,
    judge: { ...DEFAULT_CROSS_REVIEW_CONFIG.judge },
    gates: { ...DEFAULT_CROSS_REVIEW_CONFIG.gates },
    roleModels: { ...DEFAULT_CROSS_REVIEW_CONFIG.roleModels },
  };

  if (obj['enabled'] !== undefined) {
    if (typeof obj['enabled'] !== 'boolean') throw new Error('crossReview.enabled must be a boolean');
    config.enabled = obj['enabled'];
  }
  if (obj['defaultHighImpactOnly'] !== undefined) {
    if (typeof obj['defaultHighImpactOnly'] !== 'boolean') throw new Error('crossReview.defaultHighImpactOnly must be a boolean');
    config.defaultHighImpactOnly = obj['defaultHighImpactOnly'];
  }
  if (obj['maxRoundsUpperBound'] !== undefined) {
    config.maxRoundsUpperBound = validatePositiveInteger(obj['maxRoundsUpperBound'], 'crossReview.maxRoundsUpperBound');
    if (config.maxRoundsUpperBound > 5) throw new Error('crossReview.maxRoundsUpperBound must be at most 5');
  }
  if (obj['maxRounds'] !== undefined) {
    config.maxRounds = validatePositiveInteger(obj['maxRounds'], 'crossReview.maxRounds');
  }
  if (config.maxRounds > config.maxRoundsUpperBound) {
    throw new Error('crossReview.maxRounds must be at most crossReview.maxRoundsUpperBound');
  }
  if (obj['autonomy'] !== undefined) {
    if (obj['autonomy'] !== 'nonblocking') throw new Error('crossReview.autonomy must be "nonblocking"');
    config.autonomy = 'nonblocking';
  }
  if (obj['judge'] !== undefined) {
    config.judge = validateCrossReviewJudgeConfig(obj['judge']);
  }
  if (obj['gates'] !== undefined) {
    config.gates = validateCrossReviewGates(obj['gates']);
  }
  if (obj['roleModels'] !== undefined) {
    config.roleModels = validateCrossReviewRoleModels(obj['roleModels']);
  }
  return config;
}

function validateCrossReviewJudgeConfig(value: unknown): CrossReviewConfig['judge'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('crossReview.judge must be an object');
  }
  const obj = value as Record<string, unknown>;
  const judge = { ...DEFAULT_CROSS_REVIEW_CONFIG.judge };
  if (obj['preferSeparatePanel'] !== undefined) {
    if (typeof obj['preferSeparatePanel'] !== 'boolean') throw new Error('crossReview.judge.preferSeparatePanel must be a boolean');
    judge.preferSeparatePanel = obj['preferSeparatePanel'];
  }
  if (obj['models'] !== undefined) judge.models = validateStringArray(obj['models'], 'crossReview.judge.models');
  if (obj['roles'] !== undefined) judge.roles = validateStringArray(obj['roles'], 'crossReview.judge.roles');
  return judge;
}

function validateCrossReviewGates(value: unknown): CrossReviewConfig['gates'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('crossReview.gates must be an object');
  }
  const gates = { ...DEFAULT_CROSS_REVIEW_CONFIG.gates };
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(VALID_CROSS_REVIEW_GATES as readonly string[]).includes(key)) {
      throw new Error(`crossReview.gates.${key} is not supported`);
    }
    if (typeof entry !== 'boolean') throw new Error(`crossReview.gates.${key} must be a boolean`);
    gates[key as keyof CrossReviewConfig['gates']] = entry;
  }
  return gates;
}

function validateCrossReviewRoleModels(value: unknown): CrossReviewConfig['roleModels'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('crossReview.roleModels must be an object');
  }
  const result: CrossReviewConfig['roleModels'] = {};
  for (const [role, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`crossReview.roleModels.${role} must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const modelConfig: CrossReviewConfig['roleModels'][string] = {};
    if (obj['proposer'] !== undefined) modelConfig.proposer = validateNonEmptyString(obj['proposer'], `crossReview.roleModels.${role}.proposer`);
    if (obj['reviewer'] !== undefined) modelConfig.reviewer = validateNonEmptyString(obj['reviewer'], `crossReview.roleModels.${role}.reviewer`);
    result[role] = modelConfig;
  }
  return result;
}

function validateStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => validateNonEmptyString(entry, `${field}[${index}]`));
}

function validateNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}
```

In `validateConfig`, add:

```ts
  let crossReview: CrossReviewConfig | undefined;
  if (obj['crossReview'] !== undefined) {
    crossReview = validateCrossReviewConfig(obj['crossReview']);
  }
```

Add this property to the returned config object:

```ts
    ...(crossReview !== undefined ? { crossReview } : {}),
```

- [ ] **Step 6: Merge nested config**

In `src/config/loader.ts`, add this property to the object returned by `mergeConfig`:

```ts
    crossReview: {
      ...base.crossReview,
      ...override.crossReview,
      judge: {
        ...base.crossReview.judge,
        ...override.crossReview?.judge,
        models: [
          ...(override.crossReview?.judge?.models ?? base.crossReview.judge.models),
        ],
        roles: [
          ...(override.crossReview?.judge?.roles ?? base.crossReview.judge.roles),
        ],
      },
      gates: {
        ...base.crossReview.gates,
        ...override.crossReview?.gates,
      },
      roleModels: {
        ...base.crossReview.roleModels,
        ...override.crossReview?.roleModels,
      },
    },
```

- [ ] **Step 7: Run config tests**

Run:

```bash
npx vitest run tests/config/defaults.test.ts tests/config/loader.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit config support**

```bash
git add src/types/config.ts src/types/dag.ts src/types/headless.ts src/config/defaults.ts src/config/schema.ts src/config/loader.ts tests/config/defaults.test.ts tests/config/loader.test.ts
git commit -m "Enable configurable autonomous cross-review gates" \
  -m "Cross-review needs default high-impact gates, bounded remediation rounds, and merge-safe config before runtime orchestration can rely on it."
```

## Task 3: Add CLI and headless override plumbing

**Files:**
- Modify: `src/cli-args.ts`
- Modify: `src/cli-runner.ts`
- Modify: `src/headless/runner.ts`
- Modify: `tests/cli-args.test.ts`
- Modify: `tests/cli-runner.test.ts`

- [ ] **Step 1: Add CLI prompt-extraction test first**

Add this test to `tests/cli-args.test.ts`:

```ts
it('excludes cross-review flag values from the prompt', () => {
  expect(extractPrompt([
    '--headless',
    '--cross-review-max-rounds',
    '4',
    '--cross-review-judge-models',
    'ollama/gemma4:26b,ollama/qwen3.6',
    '--disable-cross-review',
    'Implement cross review',
  ])).toBe('Implement cross review');
});
```

- [ ] **Step 2: Add CLI runner test first**

Add this test to `tests/cli-runner.test.ts` near judge-panel option tests:

```ts
it('passes cross-review overrides to headless smart routing', async () => {
  await runCli([
    '--headless',
    '--disable-cross-review',
    '--cross-review-max-rounds',
    '4',
    '--cross-review-judge-models',
    'ollama/gemma4:26b,ollama/qwen3.6',
    'Implement autonomous cross review',
  ]);

  expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
    crossReviewEnabled: false,
    crossReviewMaxRounds: 4,
    crossReviewJudgeModels: ['ollama/gemma4:26b', 'ollama/qwen3.6'],
  }));
});
```

- [ ] **Step 3: Run tests and confirm red state**

Run:

```bash
npx vitest run tests/cli-args.test.ts tests/cli-runner.test.ts
```

Expected: fail because flags are not parsed or passed.

- [ ] **Step 4: Update flag classification**

In `src/cli-args.ts`, add these entries to `flagsWithValues`:

```ts
  '--cross-review-max-rounds',
  '--cross-review-judge-models',
```

Add this entry to `booleanFlags`:

```ts
  '--disable-cross-review',
```

- [ ] **Step 5: Update help text**

In `src/cli-runner.ts`, add this help block after judge-panel flags:

```text
  --disable-cross-review
                         Disable autonomous cross-model review for this run
  --cross-review-max-rounds <n>
                         Max cross-review remediation rounds before best-effort reporting (default: 2)
  --cross-review-judge-models <csv>
                         Override hybrid cross-review judges, e.g. ollama/gemma4:26b,ollama/qwen3.6
```

- [ ] **Step 6: Parse and pass headless flags**

In both headless branches in `src/cli-runner.ts`, add parsing near judge-panel parsing:

```ts
    const crossReviewEnabled = hasFlag(args, '--disable-cross-review') ? false : undefined;
    const crossReviewMaxRounds = parsePositiveIntegerFlag(
      extractFlag(args, '--cross-review-max-rounds'),
      '--cross-review-max-rounds',
    );
    const crossReviewJudgeModels = parseCsvFlag(args, '--cross-review-judge-models');
```

Add these properties to each `runHeadlessV2` call:

```ts
        crossReviewEnabled,
        crossReviewMaxRounds,
        crossReviewJudgeModels,
```

- [ ] **Step 7: Apply headless overrides**

In `src/headless/runner.ts`, add this function near `applyHeadlessRouterOverrides`:

```ts
function applyHeadlessCrossReviewOverrides(config: PipelineConfig, options: HeadlessOptions): void {
  if (
    options.crossReviewEnabled === undefined &&
    options.crossReviewMaxRounds === undefined &&
    options.crossReviewJudgeModels === undefined
  ) {
    return;
  }
  const next = {
    ...config.crossReview,
    judge: { ...config.crossReview.judge },
  };
  if (options.crossReviewEnabled !== undefined) next.enabled = options.crossReviewEnabled;
  if (options.crossReviewMaxRounds !== undefined) {
    if (options.crossReviewMaxRounds > next.maxRoundsUpperBound) {
      throw new Error(`--cross-review-max-rounds must be at most ${next.maxRoundsUpperBound}`);
    }
    next.maxRounds = options.crossReviewMaxRounds;
  }
  if (options.crossReviewJudgeModels !== undefined) {
    next.judge.models = [...options.crossReviewJudgeModels];
  }
  config.crossReview = next;
}
```

Call it after router/disabled-agent overrides:

```ts
    applyHeadlessCrossReviewOverrides(config, options);
```

Update `buildRerunHints` to preserve cross-review flags:

```ts
  if (options.crossReviewEnabled === false) args.push('--disable-cross-review');
  if (options.crossReviewMaxRounds !== undefined) args.push('--cross-review-max-rounds', String(options.crossReviewMaxRounds));
  if (options.crossReviewJudgeModels && options.crossReviewJudgeModels.length > 0) {
    args.push('--cross-review-judge-models', quoteShellArg(options.crossReviewJudgeModels.join(',')));
  }
```

- [ ] **Step 8: Run CLI tests**

Run:

```bash
npx vitest run tests/cli-args.test.ts tests/cli-runner.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit CLI plumbing**

```bash
git add src/cli-args.ts src/cli-runner.ts src/headless/runner.ts tests/cli-args.test.ts tests/cli-runner.test.ts
git commit -m "Expose cross-review runtime overrides" \
  -m "Users need autonomous cross-review defaults with explicit escape hatches and bounded-run controls for heavyweight local-model runs."
```

## Task 4: Add cross-review gate planner and helper-node builders

**Files:**
- Create: `src/orchestrator/cross-review.ts`
- Create: `tests/orchestrator/cross-review.test.ts`
- Modify: `src/types/dag.ts`

- [ ] **Step 1: Write gate planner tests first**

Create `tests/orchestrator/cross-review.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CROSS_REVIEW_CONFIG } from '../../src/config/defaults.js';
import {
  buildCrossReviewJudgeStep,
  buildCrossReviewReviewStep,
  buildCrossReviewRevisionStep,
  parseCrossReviewJudgeDecision,
  shouldCrossReviewStep,
} from '../../src/orchestrator/cross-review.js';
import type { AgentDefinition } from '../../src/types/agent-definition.js';
import type { DAGStep, StepResult } from '../../src/types/dag.js';

function agent(name: string, outputType: AgentDefinition['output']['type']): AgentDefinition {
  return {
    name,
    description: name,
    adapter: 'ollama',
    model: name === 'implementation-coder' ? 'qwen3.6' : 'gemma4:26b',
    prompt: 'prompt.md',
    pipeline: [],
    handles: name,
    output: { type: outputType },
    tools: [],
  };
}

const step: DAGStep = {
  id: 'step-1',
  agent: 'implementation-coder',
  task: 'Implement feature',
  dependsOn: [],
};

const result: StepResult = {
  id: 'step-1',
  agent: 'implementation-coder',
  task: 'Implement feature',
  status: 'completed',
  outputType: 'files',
  output: 'Changed src/example.ts and ran npm test.',
};

describe('cross-review orchestration helpers', () => {
  it('selects file-output steps for high-impact cross-review', () => {
    expect(shouldCrossReviewStep({
      config: DEFAULT_CROSS_REVIEW_CONFIG,
      step,
      result,
      agent: agent('implementation-coder', 'files'),
      round: 1,
    })).toMatchObject({ shouldReview: true, gate: 'fileOutputs' });
  });

  it('does not select generated cross-review helper steps', () => {
    expect(shouldCrossReviewStep({
      config: DEFAULT_CROSS_REVIEW_CONFIG,
      step: { ...step, id: 'step-1-peer-review-1', agent: 'code-qa-analyst' },
      result: { ...result, id: 'step-1-peer-review-1', agent: 'code-qa-analyst', outputType: 'answer' },
      agent: agent('code-qa-analyst', 'answer'),
      round: 1,
    }).shouldReview).toBe(false);
  });

  it('builds visible review and judge helper nodes', () => {
    const review = buildCrossReviewReviewStep({ step, result, reviewerAgent: 'code-qa-analyst', round: 1, gate: 'fileOutputs' });
    const judge = buildCrossReviewJudgeStep({ step, result, reviewStepId: review.id, judgeAgent: 'release-readiness-reviewer', round: 1, gate: 'fileOutputs' });

    expect(review).toMatchObject({ id: 'step-1-peer-review-1', agent: 'code-qa-analyst', dependsOn: ['step-1'], parentStepId: 'step-1' });
    expect(judge).toMatchObject({ id: 'step-1-judge-1', agent: 'release-readiness-reviewer', dependsOn: ['step-1', 'step-1-peer-review-1'], parentStepId: 'step-1' });
    expect(review.task).toContain('Return a concise structured cross-review critique');
    expect(judge.task).toContain('Return ONLY JSON');
  });

  it('parses judge decisions with nonblocking fallback', () => {
    expect(parseCrossReviewJudgeDecision('{"decision":"revise","rationale":"tests missing","remediation":["add regression test"],"residualRisks":["coverage gap"]}')).toEqual({
      decision: 'revise',
      rationale: 'tests missing',
      remediation: ['add regression test'],
      residualRisks: ['coverage gap'],
    });
    expect(parseCrossReviewJudgeDecision('not json').decision).toBe('degraded');
  });

  it('builds revision nodes from judge remediation', () => {
    const revision = buildCrossReviewRevisionStep({
      step,
      judgeStepId: 'step-1-judge-1',
      round: 1,
      remediation: ['add regression test', 'rerun npm test'],
    });

    expect(revision).toMatchObject({
      id: 'step-1-revision-1',
      agent: 'implementation-coder',
      dependsOn: ['step-1-judge-1'],
      parentStepId: 'step-1',
    });
    expect(revision.task).toContain('add regression test');
  });
});
```

- [ ] **Step 2: Run tests and confirm red state**

Run:

```bash
npx vitest run tests/orchestrator/cross-review.test.ts
```

Expected: fail because `src/orchestrator/cross-review.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/orchestrator/cross-review.ts` with:

```ts
import type { AgentDefinition } from '../types/agent-definition.js';
import type { CrossReviewConfig } from '../types/config.js';
import type { CrossReviewLedger, DAGPlan, DAGStep, StepResult } from '../types/dag.js';

export interface CrossReviewDecision {
  shouldReview: boolean;
  gate: keyof CrossReviewConfig['gates'] | 'disabled' | 'helper' | 'empty-output' | 'budget-exhausted';
  reason: string;
}

export interface CrossReviewJudgeDecision {
  decision: 'accept' | 'revise' | 'combine' | 'degraded';
  rationale: string;
  remediation: string[];
  residualRisks: string[];
}

export function shouldCrossReviewStep(options: {
  config: CrossReviewConfig;
  step: DAGStep;
  result: StepResult;
  agent: AgentDefinition;
  round: number;
}): CrossReviewDecision {
  if (!options.config.enabled) return { shouldReview: false, gate: 'disabled', reason: 'cross-review disabled' };
  if (options.round > options.config.maxRounds) return { shouldReview: false, gate: 'budget-exhausted', reason: 'cross-review round budget exhausted' };
  if (isCrossReviewHelperStep(options.step)) return { shouldReview: false, gate: 'helper', reason: 'step is a cross-review helper' };
  if (!options.result.output?.trim() && options.result.outputType !== 'files') {
    return { shouldReview: false, gate: 'empty-output', reason: 'step has no reviewable output' };
  }

  const agentName = options.step.agent;
  if (options.agent.output.type === 'files' && options.config.gates.fileOutputs) {
    return { shouldReview: true, gate: 'fileOutputs', reason: 'file-output step changes the workspace' };
  }
  if ((agentName === 'adviser' || agentName === 'spec-writer' || agentName === 'spec-qa-reviewer') && options.config.gates.planning) {
    return { shouldReview: true, gate: 'planning', reason: `${agentName} affects planning or spec decisions` };
  }
  if (agentName === 'release-readiness-reviewer' && options.config.gates.releaseReadiness) {
    return { shouldReview: true, gate: 'releaseReadiness', reason: 'release readiness is a high-impact gate' };
  }
  if (agentName.includes('security') && options.config.gates.security) {
    return { shouldReview: true, gate: 'security', reason: 'security-sensitive agent output' };
  }
  return { shouldReview: false, gate: 'disabled', reason: 'step is not configured as a high-impact cross-review gate' };
}

export function isCrossReviewHelperStep(step: Pick<DAGStep, 'id'>): boolean {
  return /-(peer-review|judge|revision)-\d+$/.test(step.id);
}

export function buildCrossReviewReviewStep(options: {
  step: DAGStep;
  result: StepResult;
  reviewerAgent: string;
  round: number;
  gate: string;
}): DAGStep {
  return {
    id: `${options.step.id}-peer-review-${options.round}`,
    agent: options.reviewerAgent,
    dependsOn: [options.step.id],
    parentStepId: options.step.id,
    task: [
      'Return a concise structured cross-review critique for the completed MAP step below.',
      'Focus on correctness, missing tests, maintainability, spec conformance, security, evidence, and release risk.',
      'Do not ask the user to choose between models. Findings must include concrete remediation when action is needed.',
      `Cross-review gate: ${options.gate}`,
      `Source step: ${options.step.id}`,
      `Source agent: ${options.step.agent}`,
      `Source task: ${options.step.task}`,
      '',
      'Source output:',
      options.result.output ?? '(file-output step; inspect workspace and prior logs)',
    ].join('\n'),
  };
}

export function buildCrossReviewJudgeStep(options: {
  step: DAGStep;
  result: StepResult;
  reviewStepId: string;
  judgeAgent: string;
  round: number;
  gate: string;
}): DAGStep {
  return {
    id: `${options.step.id}-judge-${options.round}`,
    agent: options.judgeAgent,
    dependsOn: [options.step.id, options.reviewStepId],
    parentStepId: options.step.id,
    task: [
      'You are the hybrid cross-review judge for MAP.',
      'Synthesize the source output and peer critique into the next autonomous action.',
      'Never ask the user to choose between models. Prefer a concrete remediation path when risks are actionable.',
      'Return ONLY JSON with this shape:',
      '{"decision":"accept|revise|combine","rationale":"brief reason","remediation":["specific action"],"residualRisks":["risk"]}',
      `Cross-review gate: ${options.gate}`,
      `Round: ${options.round}`,
      `Source step: ${options.step.id}`,
      `Source agent: ${options.step.agent}`,
      `Source task: ${options.step.task}`,
    ].join('\n'),
  };
}

export function buildCrossReviewRevisionStep(options: {
  step: DAGStep;
  judgeStepId: string;
  round: number;
  remediation: string[];
}): DAGStep {
  return {
    id: `${options.step.id}-revision-${options.round}`,
    agent: options.step.agent,
    dependsOn: [options.judgeStepId],
    parentStepId: options.step.id,
    task: [
      options.step.task,
      '',
      'Cross-review judge requested an autonomous revision. Apply the remediation below and preserve the original goal.',
      ...options.remediation.map((entry) => `- ${entry}`),
    ].join('\n'),
  };
}

export function parseCrossReviewJudgeDecision(output: string): CrossReviewJudgeDecision {
  const parsed = parseFirstJsonObject(output);
  const rawDecision = parsed?.['decision'];
  const decision = rawDecision === 'accept' || rawDecision === 'revise' || rawDecision === 'combine'
    ? rawDecision
    : 'degraded';
  return {
    decision,
    rationale: typeof parsed?.['rationale'] === 'string' ? parsed['rationale'].trim() : 'Judge output could not be parsed; continuing with degraded diagnostics.',
    remediation: asStringArray(parsed?.['remediation']),
    residualRisks: asStringArray(parsed?.['residualRisks']),
  };
}

export function collectCrossReviewLedgers(steps: StepResult[]): CrossReviewLedger[] {
  return steps
    .map((step) => step.crossReview)
    .filter((ledger): ledger is CrossReviewLedger => ledger !== undefined);
}

export function summarizeCrossReviewLedgers(ledgers: CrossReviewLedger[]) {
  return {
    enabled: true,
    totalReviewed: ledgers.length,
    accepted: ledgers.filter((ledger) => ledger.status === 'accepted').length,
    revised: ledgers.filter((ledger) => ledger.status === 'revised' || ledger.status === 'revision-requested').length,
    degraded: ledgers.filter((ledger) => ledger.status === 'degraded').length,
    budgetExhausted: ledgers.filter((ledger) => ledger.budgetExhausted).length,
    ledgers,
  };
}

function parseFirstJsonObject(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{');
  if (start === -1) return null;
  for (let end = output.length; end > start; end -= 1) {
    const candidate = output.slice(start, end).trim();
    if (!candidate.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      continue;
    }
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
```

- [ ] **Step 4: Run cross-review unit tests**

Run:

```bash
npx vitest run tests/orchestrator/cross-review.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit helper module**

```bash
git add src/orchestrator/cross-review.ts tests/orchestrator/cross-review.test.ts src/types/dag.ts
git commit -m "Plan cross-review helper DAG nodes" \
  -m "The orchestration layer needs pure helper builders before runtime scheduling mutates the DAG."
```

## Task 5: Schedule review and judge nodes in the orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/orchestrator/cross-review.ts`
- Modify: `tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write orchestrator regression test first**

Add a test to `tests/orchestrator/orchestrator.test.ts` using the existing mock adapter style. The test should build a plan with one `implementation-coder` step and one downstream `release-readiness-reviewer` step, enable `crossReview`, and assert inserted review/judge/revision nodes:

```ts
it('turns file-output disagreement into review, judge, and revision nodes without user blocking', async () => {
  const plan = {
    plan: [
      { id: 'step-1', agent: 'implementation-coder', task: 'Implement feature', dependsOn: [] },
      { id: 'step-2', agent: 'release-readiness-reviewer', task: 'Assess readiness', dependsOn: ['step-1'] },
    ],
  };
  const agents = new Map([
    ['implementation-coder', makeAgent('implementation-coder', 'files')],
    ['code-qa-analyst', makeAgent('code-qa-analyst', 'answer')],
    ['release-readiness-reviewer', makeAgent('release-readiness-reviewer', 'answer')],
  ]);
  const outputs = [
    'Implemented feature and ran npm test.',
    'Finding: missing regression assertion. Remediation: add a regression test.',
    '{"decision":"revise","rationale":"missing regression assertion","remediation":["add regression test"],"residualRisks":[]}',
    'Implemented feature with regression test and ran npm test.',
    '{"decision":"accept","rationale":"revision addressed critique","remediation":[],"residualRisks":[]}',
    'Ready with verification evidence.',
  ];
  const createAdapter = createQueueAdapter(outputs);

  const result = await executeDAG(plan, agents, createAdapter, undefined, undefined, undefined, undefined, {
    crossReview: {
      ...DEFAULT_CROSS_REVIEW_CONFIG,
      maxRounds: 2,
    },
    localModelConcurrency: 1,
  });

  expect(result.success).toBe(true);
  expect(result.plan.plan.map((step) => step.id)).toContain('step-1-peer-review-1');
  expect(result.plan.plan.map((step) => step.id)).toContain('step-1-judge-1');
  expect(result.plan.plan.map((step) => step.id)).toContain('step-1-revision-1');
  const original = result.steps.find((step) => step.id === 'step-1');
  expect(original?.crossReview).toMatchObject({
    status: 'revision-requested',
    judgeDecision: 'revise',
    revisionStepId: 'step-1-revision-1',
  });
  const readiness = result.plan.plan.find((step) => step.id === 'step-2');
  expect(readiness?.dependsOn).toContain('step-1-revision-1');
});
```

`tests/orchestrator/orchestrator.test.ts` already has `makeAgent`. Add this helper below `mockAdapter`:

```ts
function createQueueAdapter(outputs: string[]) {
  return vi.fn((): AgentAdapter => ({
    type: 'ollama',
    model: 'test-model',
    detect: vi.fn(),
    cancel: vi.fn(),
    async *run() {
      yield outputs.shift() ?? '';
    },
  }));
}
```

- [ ] **Step 2: Run the targeted test and confirm red state**

Run:

```bash
npx vitest run tests/orchestrator/orchestrator.test.ts -t "turns file-output disagreement"
```

Expected: fail because `DAGRetryOptions` does not accept cross-review and no review nodes are scheduled.

- [ ] **Step 3: Add cross-review retry option**

In `src/orchestrator/orchestrator.ts`, import `CrossReviewConfig` and helper functions:

```ts
import type { AdapterDefaultsMap, AgentConsensusConfig, CrossReviewConfig, EvidenceConfig } from '../types/config.js';
import {
  buildCrossReviewJudgeStep,
  buildCrossReviewReviewStep,
  buildCrossReviewRevisionStep,
  parseCrossReviewJudgeDecision,
  shouldCrossReviewStep,
} from './cross-review.js';
```

Add to `DAGRetryOptions`:

```ts
  crossReview?: CrossReviewConfig;
```

Add inside `executeDAG` near `agentConsensus`:

```ts
  const crossReview = retry?.crossReview;
  const crossReviewRounds = new Map<string, number>();
```

- [ ] **Step 4: Add reviewer/judge selection helpers**

In `src/orchestrator/cross-review.ts`, export:

```ts
export function selectCrossReviewReviewer(stepAgent: string, agents: Map<string, AgentDefinition>): string | null {
  const preferences = stepAgent === 'code-qa-analyst'
    ? ['release-readiness-reviewer', 'spec-qa-reviewer']
    : ['code-qa-analyst', 'release-readiness-reviewer', 'spec-qa-reviewer'];
  return preferences.find((name) => name !== stepAgent && agents.has(name)) ?? null;
}

export function selectCrossReviewJudge(stepAgent: string, agents: Map<string, AgentDefinition>): string | null {
  const preferences = ['release-readiness-reviewer', 'adviser', 'code-qa-analyst', 'spec-qa-reviewer'];
  return preferences.find((name) => name !== stepAgent && agents.has(name)) ?? selectCrossReviewReviewer(stepAgent, agents);
}
```

Import these helpers in `src/orchestrator/orchestrator.ts`.

- [ ] **Step 5: Schedule review and judge nodes after successful source steps**

In `src/orchestrator/orchestrator.ts`, after the existing `maybeScheduleGrammarReview(...)` call, add:

```ts
            maybeScheduleCrossReview({
              step,
              result,
              plan: mutablePlan,
              allIds,
              agents,
              results,
              settled,
              rounds: crossReviewRounds,
              config: crossReview,
              reporter,
            });
```

Add this helper near recovery scheduling helpers:

```ts
function maybeScheduleCrossReview(options: {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  agents: Map<string, AgentDefinition>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  rounds: Map<string, number>;
  config?: CrossReviewConfig;
  reporter?: VerboseReporter;
}): void {
  if (!options.config) return;
  const rootId = options.step.parentStepId ?? options.step.id;
  const round = (options.rounds.get(rootId) ?? 0) + 1;
  const agent = options.agents.get(options.step.agent);
  if (!agent) return;
  const decision = shouldCrossReviewStep({ config: options.config, step: options.step, result: options.result, agent, round });
  if (!decision.shouldReview) return;
  const reviewerAgent = selectCrossReviewReviewer(options.step.agent, options.agents);
  const judgeAgent = selectCrossReviewJudge(options.step.agent, options.agents);
  if (!reviewerAgent || !judgeAgent) {
    options.result.crossReview = {
      rootStepId: rootId,
      round,
      gate: decision.gate,
      status: 'degraded',
      participants: [{ role: 'proposer', agent: options.step.agent, provider: options.result.provider, model: options.result.model }],
      judgeDecision: 'degraded',
      judgeRationale: 'No enabled peer-review or judge agent was available.',
      residualRisks: ['Cross-review could not run because reviewer or judge agent was unavailable.'],
      budgetExhausted: false,
    };
    return;
  }

  options.rounds.set(rootId, round);
  const reviewStep = buildCrossReviewReviewStep({ step: options.step, result: options.result, reviewerAgent, round, gate: decision.gate });
  const judgeStep = buildCrossReviewJudgeStep({ step: options.step, result: options.result, reviewStepId: reviewStep.id, judgeAgent, round, gate: decision.gate });
  insertAfter(options.plan, options.step.id, [reviewStep, judgeStep]);
  options.allIds.add(reviewStep.id);
  options.allIds.add(judgeStep.id);
  rewireDownstream(options.plan, options.step.id, judgeStep.id, new Set([reviewStep.id, judgeStep.id]), options.settled);
  options.results.set(reviewStep.id, {
    id: reviewStep.id,
    agent: reviewerAgent,
    task: reviewStep.task,
    dependsOn: [...reviewStep.dependsOn],
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'review',
    spawnedByAgent: options.step.agent,
  });
  options.results.set(judgeStep.id, {
    id: judgeStep.id,
    agent: judgeAgent,
    task: judgeStep.task,
    dependsOn: [...judgeStep.dependsOn],
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'judge',
    spawnedByAgent: options.step.agent,
  });
  options.result.crossReview = {
    rootStepId: rootId,
    round,
    gate: decision.gate,
    status: 'pending',
    participants: [
      { role: 'proposer', agent: options.step.agent, provider: options.result.provider, model: options.result.model },
      { role: 'reviewer', agent: reviewerAgent },
      { role: 'judge', agent: judgeAgent },
    ],
    reviewStepId: reviewStep.id,
    judgeStepId: judgeStep.id,
    residualRisks: [],
    budgetExhausted: false,
  };
  options.reporter?.agentDecision?.({ by: `${options.step.id} [${options.step.agent}]`, agent: reviewerAgent, decision: 'added', stepId: reviewStep.id, reason: decision.reason });
  options.reporter?.agentDecision?.({ by: reviewStep.id, agent: judgeAgent, decision: 'added', stepId: judgeStep.id, reason: 'hybrid cross-review arbitration' });
}
```

Add utility helpers below it:

```ts
function insertAfter(plan: DAGPlan, sourceId: string, steps: DAGPlan['plan']): void {
  const index = plan.plan.findIndex((candidate) => candidate.id === sourceId);
  if (index === -1) {
    plan.plan.push(...steps);
    return;
  }
  plan.plan.splice(index + 1, 0, ...steps);
}

function rewireDownstream(plan: DAGPlan, fromId: string, toId: string, excludeIds: Set<string>, settled: Set<string>): void {
  for (const candidate of plan.plan) {
    if (candidate.id === fromId || candidate.id === toId || excludeIds.has(candidate.id) || settled.has(candidate.id)) continue;
    candidate.dependsOn = candidate.dependsOn.map((dep) => dep === fromId ? toId : dep);
  }
}
```

- [ ] **Step 6: Convert judge outputs into revisions**

After a result is constructed and before generic scheduling, add a call:

```ts
            maybeScheduleCrossReviewRevision({
              step,
              result,
              plan: mutablePlan,
              allIds,
              results,
              settled,
              rounds: crossReviewRounds,
              config: crossReview,
              reporter,
            });
```

Add helper:

```ts
function maybeScheduleCrossReviewRevision(options: {
  step: DAGPlan['plan'][number];
  result: StepResult;
  plan: DAGPlan;
  allIds: Set<string>;
  results: Map<string, StepResult>;
  settled: Set<string>;
  rounds: Map<string, number>;
  config?: CrossReviewConfig;
  reporter?: VerboseReporter;
}): void {
  if (!options.config || !/-judge-\d+$/.test(options.step.id)) return;
  const rootId = options.step.parentStepId;
  if (!rootId) return;
  const sourceStep = options.plan.plan.find((candidate) => candidate.id === rootId);
  const sourceResult = options.results.get(rootId);
  if (!sourceStep || !sourceResult?.crossReview) return;
  const judge = parseCrossReviewJudgeDecision(options.result.output ?? '');
  sourceResult.crossReview = {
    ...sourceResult.crossReview,
    status: judge.decision === 'accept' ? 'accepted' : judge.decision === 'degraded' ? 'degraded' : 'revision-requested',
    judgeDecision: judge.decision,
    judgeRationale: judge.rationale,
    requestedRemediation: judge.remediation,
    residualRisks: judge.residualRisks,
  };
  if (judge.decision === 'accept' || judge.decision === 'degraded') return;
  const nextRound = (options.rounds.get(rootId) ?? 1) + 1;
  const exhausted = nextRound > options.config.maxRounds;
  if (exhausted) {
    sourceResult.crossReview = {
      ...sourceResult.crossReview,
      status: 'budget-exhausted',
      budgetExhausted: true,
      residualRisks: judge.residualRisks.length > 0 ? judge.residualRisks : ['Cross-review remediation budget exhausted.'],
    };
    return;
  }
  const revisionStep = buildCrossReviewRevisionStep({ step: sourceStep, judgeStepId: options.step.id, round: sourceResult.crossReview.round, remediation: judge.remediation });
  insertAfter(options.plan, options.step.id, [revisionStep]);
  options.allIds.add(revisionStep.id);
  rewireDownstream(options.plan, options.step.id, revisionStep.id, new Set([revisionStep.id]), options.settled);
  options.results.set(revisionStep.id, {
    id: revisionStep.id,
    agent: revisionStep.agent,
    task: revisionStep.task,
    dependsOn: [...revisionStep.dependsOn],
    status: 'pending',
    parentStepId: rootId,
    edgeType: 'feedback',
    spawnedByAgent: options.step.agent,
  });
  sourceResult.crossReview = {
    ...sourceResult.crossReview,
    revisionStepId: revisionStep.id,
  };
  options.reporter?.agentDecision?.({ by: options.step.id, agent: revisionStep.agent, decision: 'added', stepId: revisionStep.id, reason: 'cross-review judge requested autonomous remediation' });
}
```

- [ ] **Step 7: Pass config from headless runner**

In `src/headless/runner.ts`, add this field to the `executeDAG` retry options:

```ts
      crossReview: config.crossReview,
```

- [ ] **Step 8: Run orchestrator tests**

Run:

```bash
npx vitest run tests/orchestrator/orchestrator.test.ts tests/orchestrator/cross-review.test.ts
```

Expected: pass with the cross-review helper imports resolved and the local `createQueueAdapter` helper in place.

- [ ] **Step 9: Commit scheduling**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/cross-review.ts src/headless/runner.ts tests/orchestrator/orchestrator.test.ts tests/orchestrator/cross-review.test.ts
git commit -m "Route high-impact steps through cross-review" \
  -m "High-impact MAP steps now get visible peer review, judge arbitration, and bounded autonomous revision instead of blocking on model disagreement."
```

## Task 6: Add cross-review summaries to headless results and formatters

**Files:**
- Modify: `src/headless/result-builder.ts`
- Modify: `src/output/result-format.ts`
- Modify: `src/dag/graph-renderer.ts`
- Modify: `tests/headless/result-builder.test.ts`
- Modify: `tests/output/result-format.test.ts`
- Modify: `tests/dag/graph-renderer.test.ts`

- [ ] **Step 1: Write result-builder test first**

Add this test to `tests/headless/result-builder.test.ts`:

```ts
it('summarizes cross-review ledgers in headless results', () => {
  const result = buildHeadlessResultV2(
    { plan: [{ id: 'step-1', agent: 'implementation-coder', task: 'Implement', dependsOn: [] }] },
    [{
      id: 'step-1',
      agent: 'implementation-coder',
      task: 'Implement',
      status: 'completed',
      crossReview: {
        rootStepId: 'step-1',
        round: 1,
        gate: 'fileOutputs',
        status: 'revision-requested',
        participants: [{ role: 'proposer', agent: 'implementation-coder', model: 'qwen3.6' }],
        judgeDecision: 'revise',
        requestedRemediation: ['add regression test'],
        residualRisks: [],
        budgetExhausted: false,
      },
    }],
    123,
  );

  expect(result.crossReview).toMatchObject({
    enabled: true,
    totalReviewed: 1,
    revised: 1,
    budgetExhausted: 0,
  });
});
```

- [ ] **Step 2: Write formatter test first**

Add this test to `tests/output/result-format.test.ts`:

```ts
it('renders cross-review summaries in markdown output', () => {
  const output = formatMapOutput({
    version: 2,
    success: true,
    outcome: 'success',
    dag: { nodes: [], edges: [] },
    steps: [],
    outputDir: '/tmp/out',
    markdownFiles: [],
    duration: 1,
    crossReview: {
      enabled: true,
      totalReviewed: 1,
      accepted: 0,
      revised: 1,
      degraded: 0,
      budgetExhausted: 0,
      ledgers: [{
        rootStepId: 'step-1',
        round: 1,
        gate: 'fileOutputs',
        status: 'revision-requested',
        participants: [{ role: 'judge', agent: 'release-readiness-reviewer', model: 'gemma4:26b' }],
        judgeDecision: 'revise',
        judgeRationale: 'missing regression test',
        requestedRemediation: ['add regression test'],
        residualRisks: [],
        budgetExhausted: false,
      }],
    },
  }, 'markdown');

  expect(output).toContain('## Cross-Model Review');
  expect(output).toContain('step-1');
  expect(output).toContain('missing regression test');
});
```

- [ ] **Step 3: Write graph edge test first**

Add assertions to `tests/dag/graph-renderer.test.ts`:

```ts
it('renders review and judge edge labels', () => {
  const rendered = renderSimplifiedGraph({
    nodes: [
      { id: 'step-1', agent: 'implementation-coder', status: 'completed', duration: 1 },
      { id: 'step-1-peer-review-1', agent: 'code-qa-analyst', status: 'completed', duration: 1 },
      { id: 'step-1-judge-1', agent: 'release-readiness-reviewer', status: 'completed', duration: 1 },
    ],
    edges: [
      { from: 'step-1', to: 'step-1-peer-review-1', type: 'review' },
      { from: 'step-1-peer-review-1', to: 'step-1-judge-1', type: 'judge' },
    ],
  }).join('\n');

  expect(rendered).toContain('--review-->');
  expect(rendered).toContain('--judge-->');
});
```

- [ ] **Step 4: Run tests and confirm red state**

Run:

```bash
npx vitest run tests/headless/result-builder.test.ts tests/output/result-format.test.ts tests/dag/graph-renderer.test.ts
```

Expected: fail because summaries and labels are not rendered.

- [ ] **Step 5: Build headless cross-review summary**

In `src/headless/result-builder.ts`, import helpers:

```ts
import { collectCrossReviewLedgers, summarizeCrossReviewLedgers } from '../orchestrator/cross-review.js';
```

Inside `buildHeadlessResultV2`, compute after `agentContributions`:

```ts
  const crossReviewLedgers = collectCrossReviewLedgers(steps);
  const crossReview = crossReviewLedgers.length > 0 ? summarizeCrossReviewLedgers(crossReviewLedgers) : undefined;
```

Add this property to the returned object:

```ts
    ...(crossReview ? { crossReview } : {}),
```

- [ ] **Step 6: Add graph labels**

In `src/dag/graph-renderer.ts`, add to `EDGE_LABELS`:

```ts
  review: '--review-->',
  judge: '--judge-->',
```

- [ ] **Step 7: Render result formatter summaries**

In `src/output/result-format.ts`, add `appendCrossReview` calls after `appendJudgePanel` in `formatMarkdownResult`, `formatTextResult`, and HTML rendering. Add these helpers near judge-panel helpers:

```ts
function appendCrossReview(lines: string[], data: Record<string, unknown>): void {
  const summary = isRecord(data['crossReview']) ? data['crossReview'] : null;
  if (!summary) return;
  lines.push('', '## Cross-Model Review', '');
  lines.push(`- Reviewed steps: ${String(summary['totalReviewed'] ?? 0)}`);
  lines.push(`- Accepted: ${String(summary['accepted'] ?? 0)}`);
  lines.push(`- Revised: ${String(summary['revised'] ?? 0)}`);
  lines.push(`- Degraded: ${String(summary['degraded'] ?? 0)}`);
  lines.push(`- Budget exhausted: ${String(summary['budgetExhausted'] ?? 0)}`);
  const ledgers = Array.isArray(summary['ledgers']) ? summary['ledgers'].filter(isRecord) : [];
  for (const ledger of ledgers) {
    lines.push(`- ${String(ledger['rootStepId'] ?? 'step')} ${String(ledger['status'] ?? '')}: ${String(ledger['judgeRationale'] ?? ledger['gate'] ?? '')}`);
  }
}

function appendPlainCrossReview(lines: string[], data: Record<string, unknown>): void {
  const summary = isRecord(data['crossReview']) ? data['crossReview'] : null;
  if (!summary) return;
  lines.push('Cross-Model Review', '------------------');
  lines.push(`Reviewed: ${String(summary['totalReviewed'] ?? 0)} | accepted: ${String(summary['accepted'] ?? 0)} | revised: ${String(summary['revised'] ?? 0)} | degraded: ${String(summary['degraded'] ?? 0)} | budget exhausted: ${String(summary['budgetExhausted'] ?? 0)}`);
  lines.push('');
}

function renderHtmlCrossReview(data: Record<string, unknown>): string {
  const summary = isRecord(data['crossReview']) ? data['crossReview'] : null;
  if (!summary) return '';
  const ledgers = Array.isArray(summary['ledgers']) ? summary['ledgers'].filter(isRecord) : [];
  const rows = ledgers.map((ledger) => `<tr><td>${escapeHtml(String(ledger['rootStepId'] ?? ''))}</td><td>${escapeHtml(String(ledger['gate'] ?? ''))}</td><td>${escapeHtml(String(ledger['status'] ?? ''))}</td><td>${escapeHtml(String(ledger['judgeDecision'] ?? ''))}</td><td>${escapeHtml(String(ledger['judgeRationale'] ?? ''))}</td></tr>`).join('');
  return [
    '<h2>Cross-Model Review</h2>',
    `<p>Reviewed ${escapeHtml(String(summary['totalReviewed'] ?? 0))} step(s); accepted ${escapeHtml(String(summary['accepted'] ?? 0))}, revised ${escapeHtml(String(summary['revised'] ?? 0))}, degraded ${escapeHtml(String(summary['degraded'] ?? 0))}, budget exhausted ${escapeHtml(String(summary['budgetExhausted'] ?? 0))}.</p>`,
    rows ? `<table><thead><tr><th>Step</th><th>Gate</th><th>Status</th><th>Judge</th><th>Rationale</th></tr></thead><tbody>${rows}</tbody></table>` : '',
  ].join('\n');
}
```

Place `renderHtmlCrossReview(data)` after `renderHtmlJudgePanel(data)` in `buildHtmlDocument`.

- [ ] **Step 8: Run formatting tests**

Run:

```bash
npx vitest run tests/headless/result-builder.test.ts tests/output/result-format.test.ts tests/dag/graph-renderer.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit reporting**

```bash
git add src/headless/result-builder.ts src/output/result-format.ts src/dag/graph-renderer.ts tests/headless/result-builder.test.ts tests/output/result-format.test.ts tests/dag/graph-renderer.test.ts
git commit -m "Report cross-model review decisions" \
  -m "Autonomous review loops need visible ledgers in human and machine-readable outputs so users can audit model disagreements without refereeing them mid-run."
```

## Task 7: Add verbose progress and final integration tests

**Files:**
- Modify: `src/utils/verbose-reporter.ts`
- Modify: `tests/utils/verbose-reporter.test.ts`
- Modify: `tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write reporter test first**

Add this test to `tests/utils/verbose-reporter.test.ts`:

```ts
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
```

- [ ] **Step 2: Run reporter test and confirm red state**

Run:

```bash
npx vitest run tests/utils/verbose-reporter.test.ts -t "logs cross-review decisions"
```

Expected: fail because `crossReviewDecision` is missing.

- [ ] **Step 3: Add reporter method**

In `src/utils/verbose-reporter.ts`, add this method near DAG events:

```ts
  crossReviewDecision(event: {
    stepId: string;
    gate: string;
    decision: string;
    round: number;
    reason: string;
  }): void {
    const label = this.color('Cross-review', 'cyan');
    this.log('◈', `${label} — ${event.stepId} gate=${event.gate} round=${event.round} decision=${event.decision}. Why: ${event.reason}`);
  }
```

In orchestrator helpers from Task 5, add calls when judge decisions are parsed:

```ts
  options.reporter?.crossReviewDecision?.({
    stepId: rootId,
    gate: sourceResult.crossReview.gate,
    decision: judge.decision,
    round: sourceResult.crossReview.round,
    reason: judge.rationale,
  });
```

- [ ] **Step 4: Run reporter and orchestrator tests**

Run:

```bash
npx vitest run tests/utils/verbose-reporter.test.ts tests/orchestrator/orchestrator.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit verbose progress**

```bash
git add src/utils/verbose-reporter.ts src/orchestrator/orchestrator.ts tests/utils/verbose-reporter.test.ts tests/orchestrator/orchestrator.test.ts
git commit -m "Surface cross-review progress in verbose runs" \
  -m "Autonomous remediation should be observable while it runs, especially when judges ask MAP to revise instead of stopping."
```

## Task 8: Update docs and operating instructions

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add README configuration and behavior text**

In `README.md`, add this section near existing consensus and judge-panel documentation:

```markdown
### Autonomous cross-model review

MAP enables cross-model review for high-impact software-delivery gates by default. A proposing model can plan or change files, a different model critiques the result, and a hybrid judge chooses the next autonomous action. Disagreement does not ask the user to pick a model opinion; it creates bounded remediation work and records the decision in the run output.

Default runtime-enforced high-impact gates include planning/spec/adviser-style outputs, file-changing agents, security-sensitive outputs, and release-readiness review. Routing remains protected by router consensus; architecture, API-contract, and verification-failure cross-review gates are reserved for future expansion and default off. The default remediation budget is two judge-steered rounds, capped at five.

```yaml
crossReview:
  enabled: true
  defaultHighImpactOnly: true
  maxRounds: 2
  autonomy: nonblocking
  judge:
    preferSeparatePanel: true
    models: []
  gates:
    planning: true
    routing: false
    architecture: false
    apiContract: false
    fileOutputs: true
    security: true
    releaseReadiness: true
    verificationFailure: false
```

Use `--disable-cross-review` for a single run, `--cross-review-max-rounds <n>` to tune remediation depth, and `--cross-review-judge-models <csv>` to choose hybrid judges such as `ollama/gemma4:26b,ollama/qwen3.6`.
```

- [ ] **Step 2: Add CLI reference rows**

In the README CLI options table, add:

```markdown
| `--disable-cross-review` | run option | off | Disable high-impact autonomous cross-model review for this run |
| `--cross-review-max-rounds <n>` | `crossReview.maxRounds` | `2` | Maximum judge-steered remediation rounds before best-effort reporting |
| `--cross-review-judge-models <csv>` | `crossReview.judge.models` | config value | Override hybrid cross-review judges, e.g. `ollama/gemma4:26b,ollama/qwen3.6` |
```

- [ ] **Step 3: Update AGENTS.md operating notes**

Add this bullet under repeatability and anti-hallucination controls in `AGENTS.md`:

```markdown
7. **Autonomous cross-model review** runs on high-impact planning, release, security-sensitive, and file-changing software-delivery gates by default. Model disagreement must not ask the user to pick a winner; MAP should send critique through hybrid judge arbitration, create bounded remediation work, request verification through remediation when needed, and report residual risk when the budget is exhausted. Routing remains protected by router consensus unless cross-review routing is implemented.
```

Add this sentence near the documentation rule:

```markdown
Changes to cross-review gates, judge arbitration, remediation budgets, or cross-review reporting must update README, AGENTS.md, and tests in the same change.
```

- [ ] **Step 4: Commit docs**

```bash
git add README.md AGENTS.md
git commit -m "Document autonomous cross-model review" \
  -m "Users and future agents need the autonomy contract, config knobs, and reporting expectations documented before relying on model-diverse review loops."
```

## Task 9: Full verification and cleanup

**Files:**
- Review all modified files from Tasks 1-8.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npx vitest run \
  tests/config/defaults.test.ts \
  tests/config/loader.test.ts \
  tests/cli-args.test.ts \
  tests/cli-runner.test.ts \
  tests/orchestrator/cross-review.test.ts \
  tests/orchestrator/orchestrator.test.ts \
  tests/headless/result-builder.test.ts \
  tests/output/result-format.test.ts \
  tests/dag/graph-renderer.test.ts \
  tests/utils/verbose-reporter.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
npm run build
```

Expected: TypeScript build passes with no errors.

- [ ] **Step 3: Run core test suite**

Run:

```bash
npm run test:core
```

Expected: core suite passes. If the live cocaine report e2e fails because local Ollama models are unavailable, record the exact model/server error and run the focused non-live tests plus build before reporting the blocker.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD~8..HEAD
```

Expected: diff includes config/types, cross-review orchestration, tests, README, and AGENTS updates. It should not include `.superpowers/`, `.map/`, generated output, or unrelated local edits.

- [ ] **Step 5: Final commit if any verification-only fixes were needed**

If Step 1-3 required fixes after Task 8, commit them:

```bash
git add src tests README.md AGENTS.md
git commit -m "Stabilize autonomous cross-review verification" \
  -m "Focused tests and build exposed integration mismatches after cross-review wiring, so this commit keeps the feature green before handoff."
```

- [ ] **Step 6: Final report evidence**

Prepare the final implementation report with:

```markdown
Changed files:
- src/types/config.ts
- src/types/dag.ts
- src/types/headless.ts
- src/config/defaults.ts
- src/config/schema.ts
- src/config/loader.ts
- src/cli-args.ts
- src/cli-runner.ts
- src/headless/runner.ts
- src/headless/result-builder.ts
- src/orchestrator/cross-review.ts
- src/orchestrator/orchestrator.ts
- src/output/result-format.ts
- src/dag/graph-renderer.ts
- src/utils/verbose-reporter.ts
- README.md
- AGENTS.md
- related tests

Verification:
- npx vitest run focused cross-review/config/CLI/reporting tests
- npm run build
- npm run test:core

Remaining risks:
- Local Ollama runtime availability can affect live e2e behavior.
- V1 judge selection uses existing agents; configured model-specific judge agents can be refined after the core loop lands.
```
