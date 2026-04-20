import type { StageName } from '../types/config.js';
import { normalizeTerminalText, truncateText, wrapWithPrefix } from './terminal-text.js';

const STAGE_LABELS: Record<StageName, string> = {
  spec: 'Specification',
  review: 'Review',
  qa: 'QA Assessment',
  execute: 'Execution',
  docs: 'Documentation',
};

const STAGE_DESCRIPTIONS: Record<StageName, string> = {
  spec: 'Generating specification from prompt',
  review: 'Reviewing and refining specification',
  qa: 'Running quality assessment',
  execute: 'Executing implementation',
  docs: 'Generating documentation',
};

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface VerboseWriter {
  supportsColor?: boolean;
  write(text: string): void;
  clearLine(): void;
}

const stderrWriter: VerboseWriter = {
  write(text: string) {
    process.stderr.write(text);
  },
  clearLine() {
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  },
};

export class VerboseReporter {
  private startedAt: number;
  private stageStartedAt = 0;
  private stageBytes = 0;
  private spinnerIdx = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private currentStage: string | null = null;
  private writer: VerboseWriter;

  constructor(writer: VerboseWriter = stderrWriter) {
    this.startedAt = Date.now();
    this.writer = writer;
  }

  private elapsed(): string {
    return formatElapsed(Date.now() - this.startedAt);
  }

  private color(text: string, color: 'cyan'): string {
    const supportsColor = this.writer.supportsColor ?? process.stderr.isTTY;
    if (!supportsColor) return text;
    const codes: Record<typeof color, string> = {
      cyan: '\x1b[36m',
    };
    return `${codes[color]}${text}\x1b[0m`;
  }

  private log(icon: string, message: string): void {
    this.stopSpinner();
    this.writer.clearLine();
    const prefix = `[${this.elapsed()}] ${icon} `;
    const width = process.stderr.isTTY ? process.stderr.columns ?? 80 : 80;
    this.writer.write(`${wrapWithPrefix(prefix, normalizeTerminalText(message), width)}\n`);
  }

  private startSpinner(label: string): void {
    this.stopSpinner();
    this.currentStage = label;
    this.spinnerIdx = 0;

    // Only animate if TTY; otherwise just print a static line
    if (!process.stderr.isTTY) {
      return;
    }

    this.spinnerInterval = setInterval(() => {
      const frame = SPINNER_FRAMES[this.spinnerIdx % SPINNER_FRAMES.length];
      const elapsed = formatElapsed(Date.now() - this.stageStartedAt);
      const bytes = formatBytes(this.stageBytes);
      this.writer.clearLine();
      this.writer.write(`[${this.elapsed()}] ${frame} ${this.currentStage}  (${elapsed}, ${bytes} received)`);
      this.spinnerIdx += 1;
    }, 120);
  }

  private stopSpinner(): void {
    if (this.spinnerInterval !== null) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
  }

  // ── Pipeline lifecycle ───────────────────────────────────────────────

  pipelineStart(prompt: string): void {
    const width = process.stderr.isTTY ? process.stderr.columns ?? 80 : 80;
    const cleaned = normalizeTerminalText(prompt).replace(/\s+/g, ' ').trim();
    const truncated = truncateText(cleaned, Math.max(20, width - 28));
    this.log('▶', `Pipeline started: "${truncated}"`);
  }

  pipelineComplete(success: boolean, duration: number): void {
    this.stopSpinner();
    const icon = success ? '✔' : '✘';
    const label = success ? 'Task finished successfully' : 'Task finished with errors';
    this.log(icon, `${label} (${formatElapsed(duration)} total)`);
  }

  // ── Stage lifecycle ──────────────────────────────────────────────────

  stageStart(stage: StageName, iteration?: number): void {
    this.stageStartedAt = Date.now();
    this.stageBytes = 0;
    const label = STAGE_LABELS[stage] ?? stage;
    const desc = STAGE_DESCRIPTIONS[stage] ?? '';
    const iter = iteration !== undefined && iteration > 1 ? ` (iteration ${iteration})` : '';
    this.log('▶', `${label}${iter} — ${desc}`);
    this.startSpinner(label + iter);
  }

  stageComplete(stage: StageName, duration: number): void {
    const label = STAGE_LABELS[stage] ?? stage;
    const bytes = formatBytes(this.stageBytes);
    this.log('✔', `${label} complete (${formatElapsed(duration)}, ${bytes})`);
  }

  stageFailed(stage: StageName, error: string): void {
    const label = STAGE_LABELS[stage] ?? stage;
    this.log('✘', `${label} failed: ${error}`);
  }

  // ── Streaming activity ───────────────────────────────────────────────

  onChunk(bytes: number): void {
    this.stageBytes += bytes;
  }

  // ── QA / iteration events ────────────────────────────────────────────

  specQaResult(passed: boolean, iteration: number, maxIterations: number): void {
    const icon = passed ? '✔' : '↻';
    const msg = passed
      ? `Spec QA passed on iteration ${iteration}`
      : `Spec QA failed — retrying (${iteration}/${maxIterations})`;
    this.log(icon, msg);
  }

  codeQaResult(passed: boolean, iteration: number, maxIterations: number): void {
    const icon = passed ? '✔' : '↻';
    const msg = passed
      ? `Code QA passed on iteration ${iteration}`
      : `Code QA failed — retrying (${iteration}/${maxIterations})`;
    this.log(icon, msg);
  }

  adapterFailover(from: string, to: string): void {
    this.log('⚠', `Adapter ${from} quota exhausted, failing over to ${to}`);
  }

  // ── DAG v2 events ────────────────────────────────────────────────────

  dagRoutingStart(): void {
    this.stageStartedAt = Date.now();
    this.stageBytes = 0;
    this.log('▶', 'Router — Planning task execution DAG');
    this.startSpinner('Router');
  }

  dagRoutingComplete(stepCount: number, duration: number): void {
    this.log('✔', `Router complete — ${stepCount} step${stepCount === 1 ? '' : 's'} planned (${formatElapsed(duration)})`);
  }

  agentDecision(event: {
    by: string;
    agent: string;
    decision: 'selected' | 'skipped' | 'added' | 'not-needed';
    reason: string;
    stepId?: string;
  }): void {
    const action =
      event.decision === 'not-needed'
        ? `did not add ${event.agent}`
        : `${event.decision} ${event.agent}`;
    const step = event.stepId ? ` as ${event.stepId}` : '';
    this.log('◊', `Agent decision — ${event.by} ${action}${step}. Why: ${event.reason}`);
  }

  crossReviewDecision(event: {
    stepId: string;
    gate: string;
    decision: string;
    round: number;
    reason: string;
  }): void {
    const label = this.color('Cross-review', 'cyan');
    this.log(
      '◈',
      `${label} — ${event.stepId} gate=${event.gate} round=${event.round} decision=${event.decision}. Why: ${event.reason}`,
    );
  }

  routerRecoveryStart(event: {
    attempt: number;
    maxAttempts: number;
    suggestedAgent: string;
    reason: string;
  }): void {
    this.log(
      '↻',
      `Router recovery attempt ${event.attempt}/${event.maxAttempts}: no matching agent yet. Suggested agent "${event.suggestedAgent}". Why: ${event.reason}`,
    );
  }

  modelPreparationStart(model: string): void {
    this.log('↓', `Preparing Ollama model "${model}" for retry/recovery. If missing, MAP will run ollama pull before rerouting.`);
  }

  modelPreparationComplete(model: string): void {
    this.log('✔', `Ollama model "${model}" is available for retry/recovery.`);
  }

  modelPreparationFailed(model: string, error: string): void {
    this.log('✘', `Could not prepare Ollama model "${model}". Why MAP cannot recover automatically: ${error}`);
  }

  routerRecoveryComplete(event: { status: string; detail: string }): void {
    this.log('◊', `Router recovery ${event.status}: ${event.detail}`);
  }

  dagStepStart(stepId: string, agent: string, task: string): void {
    this.stageStartedAt = Date.now();
    this.stageBytes = 0;
    const width = process.stderr.isTTY ? process.stderr.columns ?? 80 : 80;
    const cleaned = normalizeTerminalText(task).replace(/\s+/g, ' ').trim();
    const truncated = truncateText(cleaned, Math.max(20, width - 34));
    this.log('▶', `Step ${stepId} [${agent}] — ${truncated}`);
    this.startSpinner(`Step ${stepId} [${agent}]`);
  }

  dagStepComplete(stepId: string, agent: string, duration: number): void {
    this.log('✔', `Step ${stepId} [${agent}] complete (${formatElapsed(duration)})`);
  }

  dagStepOutput(stepId: string, agent: string, output: string): void {
    const cleaned = normalizeTerminalText(output)
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return;
    const width = process.stderr.isTTY ? process.stderr.columns ?? 80 : 80;
    const truncated = truncateText(cleaned, Math.max(40, width * 2));
    this.log('☷', `Output ${stepId} [${agent}] — ${truncated}`);
  }

  dagStepFailed(stepId: string, agent: string, error: string): void {
    this.log('✘', `Step ${stepId} [${agent}] failed: ${error}`);
  }

  dagStepRetry(stepId: string, agent: string, attempt: number, error: string): void {
    this.log('↻', `Step ${stepId} [${agent}] retry ${attempt}. Why: ${error}`);
  }

  dagStepSkipped(stepId: string, reason: string): void {
    this.log('⊘', `Step ${stepId} skipped: ${reason}`);
  }

  dagRecoveryScheduled(event: {
    failedStepId: string;
    helperStepId: string;
    helperAgent: string;
    retryStepId: string;
    failureKind?: string;
    reason: string;
  }): void {
    this.log(
      '↻',
      [
        `Recovery loop scheduled for ${event.failedStepId}.`,
        `Why it failed: ${event.reason}`,
        `Recovery type: ${event.failureKind ?? 'unknown'}.`,
        `Next: ${event.helperStepId} [${event.helperAgent}] will gather/fix what is missing, then ${event.retryStepId} reruns the original step.`,
      ].join(' '),
    );
  }

  dagRecoveryUnavailable(event: {
    stepId: string;
    failureKind?: string;
    reason: string;
  }): void {
    this.log(
      '✘',
      [
        `Cannot recover ${event.stepId} automatically.`,
        `Failure type: ${event.failureKind ?? 'unknown'}.`,
        `Why: ${event.reason}`,
      ].join(' '),
    );
  }

  securityGateStart(stepId: string, agent: string): void {
    this.log('◊', `Security gate — reviewing ${agent} output for ${stepId}`);
  }

  securityGatePassed(stepId: string, duration: number): void {
    this.log('◊', `Security gate passed for ${stepId} (${formatElapsed(duration)})`);
  }

  securityGateFailed(stepId: string, findingCount: number): void {
    this.log(
      '✘',
      `Security gate failed for ${stepId} (${findingCount} finding${findingCount === 1 ? '' : 's'})`,
    );
  }

  dagComplete(success: boolean, duration: number): void {
    this.stopSpinner();
    const icon = success ? '✔' : '✘';
    const label = success ? 'Task finished successfully' : 'Task finished with errors';
    this.log(icon, `${label} (${formatElapsed(duration)} total)`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this.stopSpinner();
  }
}

/** A no-op reporter for when verbose mode is off. */
export class SilentReporter extends VerboseReporter {
  constructor() {
    super({ write() {}, clearLine() {} });
  }
  override pipelineStart(): void {}
  override pipelineComplete(): void {}
  override stageStart(): void {}
  override stageComplete(): void {}
  override stageFailed(): void {}
  override onChunk(): void {}
  override specQaResult(): void {}
  override codeQaResult(): void {}
  override adapterFailover(): void {}
  override dagRoutingStart(): void {}
  override dagRoutingComplete(): void {}
  override agentDecision(): void {}
  override crossReviewDecision(): void {}
  override routerRecoveryStart(): void {}
  override modelPreparationStart(): void {}
  override modelPreparationComplete(): void {}
  override modelPreparationFailed(): void {}
  override routerRecoveryComplete(): void {}
  override dagStepStart(): void {}
  override dagStepComplete(): void {}
  override dagStepOutput(): void {}
  override dagStepFailed(): void {}
  override dagStepRetry(): void {}
  override dagStepSkipped(): void {}
  override dagRecoveryScheduled(): void {}
  override dagRecoveryUnavailable(): void {}
  override securityGateStart(): void {}
  override securityGatePassed(): void {}
  override securityGateFailed(): void {}
  override dagComplete(): void {}
  override dispose(): void {}
}

export function createReporter(verbose: boolean): VerboseReporter {
  return verbose ? new VerboseReporter() : new SilentReporter();
}
