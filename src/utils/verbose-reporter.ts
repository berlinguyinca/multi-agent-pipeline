import type { StageName } from '../types/config.js';
import type { SecurityFinding } from '../security/types.js';
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
const AGENT_COLOR_CODES = ['38;5;75', '38;5;170', '38;5;76', '38;5;214', '38;5;141', '38;5;39', '38;5;203', '38;5;111'];
const STEP_COLOR_CODES = ['38;5;33', '38;5;37', '38;5;63', '38;5;99', '38;5;136', '38;5;30', '38;5;161', '38;5;67'];

export interface VerboseWriter {
  supportsColor?: boolean;
  write(text: string): void;
  clearLine(): void;
}

const stderrWriter: VerboseWriter = {
  supportsColor: shouldUseVerboseColor(),
  write(text: string) {
    process.stderr.write(text);
  },
  clearLine() {
    if (process.stderr.isTTY) {
      process.stderr.write('\r\x1b[K');
    }
  },
};

function shouldUseVerboseColor(): boolean {
  if (process.env['NO_COLOR'] || process.env['MAP_NO_COLOR']) return false;
  if (process.env['TERM'] === 'dumb') return false;
  if (process.env['FORCE_COLOR'] && process.env['FORCE_COLOR'] !== '0') return true;
  if (process.env['MAP_FORCE_COLOR'] && process.env['MAP_FORCE_COLOR'] !== '0') return true;
  if (process.env['npm_config_color'] === 'true' || process.env['npm_config_color'] === 'always') return true;
  if (process.stderr.isTTY) return true;
  // npm scripts and some wrapped terminals can make stderr look non-TTY even
  // though the user is reading an ANSI-capable terminal. Verbose mode is
  // human-facing, so keep colors on by default unless explicitly disabled.
  if (!process.env['CI']) return true;
  return false;
}

function stableColorCode(value: string, palette: string[]): string {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return palette[Math.abs(hash) % palette.length]!;
}

function firstReasonLine(reason: string): string {
  return normalizeTerminalText(reason)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? 'unknown';
}

function formatSecurityFinding(finding: SecurityFinding): string {
  const parts = [
    `[${finding.severity}]`,
    finding.rule,
    finding.message,
    finding.line !== undefined ? `(line ${finding.line})` : '',
  ].filter(Boolean);
  const snippet = finding.snippet?.trim()
    ? ` — ${truncateText(normalizeTerminalText(finding.snippet).replace(/\s+/g, ' ').trim(), 120)}`
    : '';
  return `${parts.join(' ')}${snippet}`;
}

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

  private color(text: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' | 'blue' | 'bold' | 'dim'): string {
    const supportsColor = this.writer.supportsColor ?? process.stderr.isTTY;
    if (!supportsColor) return text;
    const codes: Record<typeof color, string> = {
      cyan: '\x1b[36m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      magenta: '\x1b[35m',
      blue: '\x1b[34m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
    };
    return `${codes[color]}${text}\x1b[0m`;
  }

  private colorCode(text: string, code: string): string {
    const supportsColor = this.writer.supportsColor ?? process.stderr.isTTY;
    if (!supportsColor) return text;
    return `\x1b[${code}m${text}\x1b[0m`;
  }

  private decisionColor(decision: string): 'green' | 'yellow' | 'red' | 'cyan' | 'dim' {
    if (decision === 'selected' || decision === 'added' || decision === 'accept') return 'green';
    if (decision === 'skipped' || decision === 'not-needed' || decision === 'revise') return 'yellow';
    if (decision === 'degraded' || decision === 'reject' || decision === 'failed') return 'red';
    if (decision === 'combine') return 'cyan';
    return 'dim';
  }

  private agentLabel(agent: string): string {
    return this.colorCode(agent, stableColorCode(agent, AGENT_COLOR_CODES));
  }

  private stepLabel(stepId: string): string {
    return this.colorCode(stepId, stableColorCode(stepId, STEP_COLOR_CODES));
  }

  private log(icon: string, message: string, options: { preserveAnsi?: boolean } = {}): void {
    this.stopSpinner();
    this.writer.clearLine();
    const prefix = `[${this.elapsed()}] ${icon} `;
    const width = process.stderr.isTTY ? process.stderr.columns ?? 80 : 80;
    const line = options.preserveAnsi
      ? `${prefix}${message}`
      : wrapWithPrefix(prefix, normalizeTerminalText(message), width);
    this.writer.write(`${line}\n`);
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
    this.log(
      this.color('✘', 'red'),
      [
        `${this.color(label, 'cyan')} ${this.color('failed', 'red')}`,
        `  ${this.color('↳ Why:', 'yellow')} ${this.color(firstReasonLine(error), 'red')}`,
      ].join('\n'),
      { preserveAnsi: true },
    );
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
    const coloredAgent = this.agentLabel(event.agent);
    const coloredBy = this.color(event.by, 'blue');
    const coloredDecision = this.color(event.decision, this.decisionColor(event.decision));
    const action =
      event.decision === 'not-needed'
        ? `did not add ${coloredAgent}`
        : `${coloredDecision} ${coloredAgent}`;
    const step = event.stepId ? ` as ${this.stepLabel(event.stepId)}` : '';
    this.log('◊', `${this.color('Agent decision', 'cyan')} — ${coloredBy} ${action}${step}. ${this.color('Why:', 'yellow')} ${normalizeTerminalText(event.reason)}`, { preserveAnsi: true });
  }

  crossReviewDecision(event: {
    stepId: string;
    gate: string;
    decision: string;
    round: number;
    reason: string;
  }): void {
    const label = this.color('Cross-review', 'cyan');
    const decision = this.color(event.decision, this.decisionColor(event.decision));
    this.log(
      '◈',
      `${label} — ${this.stepLabel(event.stepId)} gate=${event.gate} round=${event.round} decision=${decision}. ${this.color('Why:', 'yellow')} ${normalizeTerminalText(event.reason)}`,
      { preserveAnsi: true },
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
    this.log(
      this.color('✘', 'red'),
      [
        `${this.color('Could not prepare Ollama model', 'red')} "${model}"`,
        `  ${this.color('↳ Why:', 'yellow')} ${this.color(firstReasonLine(error), 'red')}`,
      ].join('\n'),
      { preserveAnsi: true },
    );
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
    this.log('▶', `${this.color('Step', 'cyan')} ${this.stepLabel(stepId)} [${this.agentLabel(agent)}] — ${truncated}`, { preserveAnsi: true });
    this.startSpinner(`Step ${stepId} [${agent}]`);
  }

  dagStepComplete(stepId: string, agent: string, duration: number): void {
    this.log('✔', `${this.color('Step', 'cyan')} ${this.stepLabel(stepId)} [${this.agentLabel(agent)}] ${this.color('complete', 'green')} (${formatElapsed(duration)})`, { preserveAnsi: true });
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
    this.log('☷', `${this.color('Output', 'cyan')} ${this.stepLabel(stepId)} [${this.agentLabel(agent)}] — ${truncated}`, { preserveAnsi: true });
  }

  dagStepFailed(stepId: string, agent: string, error: string): void {
    this.log(
      this.color('✘', 'red'),
      [
        `${this.color('Step', 'cyan')} ${this.stepLabel(stepId)} [${this.agentLabel(agent)}] ${this.color('failed', 'red')}`,
        `  ${this.color('↳ Why:', 'yellow')} ${this.color(firstReasonLine(error), 'red')}`,
      ].join('\n'),
      { preserveAnsi: true },
    );
  }

  dagStepRetry(stepId: string, agent: string, attempt: number, error: string): void {
    this.log('↻', `${this.color('Step', 'cyan')} ${this.stepLabel(stepId)} [${this.agentLabel(agent)}] ${this.color(`retry ${attempt}`, 'yellow')}. ${this.color('Why:', 'yellow')} ${normalizeTerminalText(error)}`, { preserveAnsi: true });
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
      this.color('✘', 'red'),
      [
        `${this.color('Cannot recover', 'red')} ${this.stepLabel(event.stepId)} automatically.`,
        `Failure type: ${event.failureKind ?? 'unknown'}.`,
        `\n  ${this.color('↳ Why:', 'yellow')} ${this.color(firstReasonLine(event.reason), 'red')}`,
      ].join(' '),
      { preserveAnsi: true },
    );
  }

  securityGateStart(stepId: string, agent: string): void {
    this.log('◊', `Security gate — reviewing ${agent} output for ${stepId}`);
  }

  securityGatePassed(stepId: string, duration: number): void {
    this.log('◊', `Security gate passed for ${stepId} (${formatElapsed(duration)})`);
  }

  securityGateFailed(stepId: string, findingCount: number, findings: SecurityFinding[] = []): void {
    const findingLines = findings.slice(0, 5).map((finding, index) =>
      `  ${this.color(`↳ Finding ${index + 1}:`, 'yellow')} ${this.color(formatSecurityFinding(finding), 'red')}`,
    );
    if (findings.length > 5) {
      findingLines.push(`  ${this.color('↳ More:', 'yellow')} ${this.color(`${findings.length - 5} additional finding${findings.length - 5 === 1 ? '' : 's'} hidden`, 'red')}`);
    }
    this.log(
      this.color('✘', 'red'),
      [
        `${this.color('Security gate failed', 'red')} for ${this.stepLabel(stepId)} (${findingCount} finding${findingCount === 1 ? '' : 's'})`,
        ...(findingLines.length === 0
          ? [`  ${this.color('↳ Why:', 'yellow')} ${this.color('No finding details were provided by the security gate.', 'red')}`]
          : []),
        ...findingLines,
      ].join('\n'),
      { preserveAnsi: true },
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
