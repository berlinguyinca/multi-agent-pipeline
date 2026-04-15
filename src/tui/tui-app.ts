import * as path from 'node:path';
import blessed from 'neo-blessed';
import type { PipelineConfig, AgentAssignment, StageName } from '../types/config.js';
import type { AgentAdapter, AdapterConfig, DetectionResult } from '../types/adapter.js';
import type { PipelineContext } from '../types/pipeline.js';
import type { AgentDefinition } from '../types/agent-definition.js';
import type { DAGPlan, StepResult } from '../types/dag.js';
import type { GitHubReportResult } from '../types/github.js';
import { KeyboardManager } from './keyboard-manager.js';
import { StatusLine } from './status-line.js';
import { ScreenRouter } from './screen-router.js';
import { VimMode } from './vim-mode.js';
import { getTheme, toggleTheme } from './theme.js';
import { PipelineRunner, resolveAgentStage } from './pipeline-runner.js';
import { loadAgentRegistry, getEnabledAgents, mergeWithOverrides } from '../agents/registry.js';
import { routeTask } from '../router/router.js';
import { executeDAG } from '../orchestrator/orchestrator.js';
import { createAdapter } from '../adapters/adapter-factory.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/types.js';
import { resolveGitHubToken } from '../github/token.js';
import {
  buildGitHubIssuePrompt,
  fetchGitHubIssueContext,
  parseGitHubIssueUrl,
} from '../github/issues.js';
import type { TestProgressItem } from './runtime.js';
import type { BaseScreen } from './screens/base-screen.js';
import { WelcomeScreen } from './screens/welcome-screen.js';
import { PipelineScreen } from './screens/pipeline-screen.js';
import { FeedbackScreen } from './screens/feedback-screen.js';
import { ExecuteScreen } from './screens/execute-screen.js';
import { CompleteScreen } from './screens/complete-screen.js';
import { RouterPlanScreen } from './screens/router-plan-screen.js';
import { DAGExecutionScreen } from './screens/dag-execution-screen.js';
import type { PipelineBarData } from './widgets/pipeline-bar.js';
import type { TestStatus } from './widgets/test-progress.js';
import { createRawOutputPane } from './widgets/raw-output-pane.js';
import { createRawOutputStore } from './raw-output-store.js';
import { copyToClipboard } from './clipboard.js';
import { openFile } from './file-opener.js';
import {
  persistRawOutputLog,
  persistRawOutputLogSync,
  formatRawOutputForStorage,
} from './raw-output-log.js';
import {
  loadPromptHistory,
  recordPromptHistory,
  type PromptHistoryEntry,
} from './prompt-history.js';
import { shouldUseResearchFlow } from '../utils/prompt-intent.js';

export interface TuiAppOptions {
  config: PipelineConfig;
  detection: DetectionResult;
  initialPrompt?: string;
  initialGithubIssueUrl?: string;
  useV2?: boolean;
}

export interface TuiApp {
  run(): Promise<void>;
  destroy(): void;
}

const RENDER_DEBOUNCE_MS = 16;
const RAW_OUTPUT_HEIGHT = 10;

const STAGE_NAMES: StageName[] = ['spec', 'review', 'qa', 'execute', 'docs'];

const ACTIVE_STATES = new Set([
  'specifying',
  'reviewing',
  'specAssessing',
  'executing',
  'codeAssessing',
  'fixing',
  'documenting',
]);

const PIPELINE_SCREEN_STATES = new Set([
  'specifying',
  'reviewing',
  'specAssessing',
  'codeAssessing',
  'documenting',
]);

const EXECUTE_SCREEN_STATES = new Set(['executing', 'fixing']);

const STATE_LABELS: Record<string, string> = {
  specifying: 'Generating Spec',
  reviewing: 'Reviewing Spec',
  specAssessing: 'QA Assessment',
  executing: 'Executing',
  fixing: 'Fixing',
  codeAssessing: 'Code QA',
  documenting: 'Documenting',
};

function computeBarStages(
  stateValue: string,
  agents: Record<StageName, AgentAssignment>,
): PipelineBarData['stages'] {
  const progressMap: Record<string, number> = {
    idle: 0,
    specifying: 0,
    reviewing: 1,
    specAssessing: 2,
    feedback: 3,
    executing: 3,
    fixing: 3,
    codeAssessing: 3,
    documenting: 4,
    complete: 5,
    failed: 5,
    cancelled: 5,
  };

  const activeSet = new Set<StageName>();
  if (stateValue === 'specifying') activeSet.add('spec');
  if (stateValue === 'reviewing') activeSet.add('review');
  if (stateValue === 'specAssessing') activeSet.add('qa');
  if (EXECUTE_SCREEN_STATES.has(stateValue) || stateValue === 'codeAssessing') activeSet.add('execute');
  if (stateValue === 'documenting') activeSet.add('docs');

  const progress = progressMap[stateValue] ?? 0;

  return STAGE_NAMES.map((name, i) => {
    let status: 'waiting' | 'active' | 'complete';
    if (activeSet.has(name)) {
      status = 'active';
    } else if (i < progress) {
      status = 'complete';
    } else {
      status = 'waiting';
    }
    return { name, status, agent: agents[name].adapter };
  });
}

function computeV2BarStages(
  phase: 'routing' | 'plan' | 'executing' | 'complete' | 'failed',
): PipelineBarData['stages'] {
  const activeIndex =
    phase === 'routing' ? 0 : phase === 'plan' ? 1 : phase === 'executing' ? 2 : -1;
  const completedIndex =
    phase === 'routing' ? -1 : phase === 'plan' ? 0 : phase === 'executing' ? 1 : 2;

  return [
    {
      name: 'Route',
      status: completedIndex >= 0 ? 'complete' : activeIndex === 0 ? 'active' : 'waiting',
      agent: 'router',
    },
    {
      name: 'Plan',
      status: completedIndex >= 1 ? 'complete' : activeIndex === 1 ? 'active' : 'waiting',
      agent: 'router',
    },
    {
      name: 'Execute',
      status: completedIndex >= 2 ? 'complete' : activeIndex === 2 ? 'active' : 'waiting',
      agent: 'dag',
    },
  ];
}

function formatRouterNoMatchMessage(decision: {
  reason: string;
  suggestedAgent?: { name: string; description: string };
}): string {
  const lines = [
    'No suitable agent is currently registered for this request.',
    '',
    `Reason: ${decision.reason}`,
  ];

  if (decision.suggestedAgent) {
    lines.push('');
    lines.push(`Suggested agent: ${decision.suggestedAgent.name}`);
    lines.push(decision.suggestedAgent.description);
  }

  lines.push('');
  lines.push('Create it with: map agent create');
  return lines.join('\n');
}

function getV1RawOutputKey(stateValue: string, iteration: number): string | null {
  switch (stateValue) {
    case 'specifying':
      return `spec:${iteration}`;
    case 'reviewing':
      return `review:${iteration}`;
    case 'specAssessing':
      return `qa:${iteration}`;
    case 'executing':
      return `execute:${iteration}`;
    case 'fixing':
      return `fixing:${iteration}`;
    case 'documenting':
      return `docs:${iteration}`;
    default:
      return null;
  }
}

function getV1RawOutputLabel(stateValue: string): string {
  switch (stateValue) {
    case 'specifying':
      return 'Specification';
    case 'reviewing':
      return 'Review';
    case 'specAssessing':
      return 'QA Assessment';
    case 'executing':
      return 'Execution';
    case 'fixing':
      return 'Fixing';
    case 'documenting':
      return 'Documentation';
    default:
      return stateValue;
  }
}

function isFocusedOnInput(screen: blessed.Widgets.Screen | null): boolean {
  const focused = screen?.focused;
  return Boolean(focused && (focused as blessed.Widgets.TextboxElement).readInput);
}

function mapTestStatus(item: TestProgressItem): { name: string; status: TestStatus } {
  const statusMap: Record<string, TestStatus> = {
    writing: 'running',
    passing: 'pass',
    failing: 'fail',
  };
  return { name: item.name, status: statusMap[item.status] ?? 'pending' };
}

export function createTuiApp(options: TuiAppOptions): TuiApp {
  const { config, detection, initialPrompt, initialGithubIssueUrl, useV2 = false } = options;

  let screen: blessed.Widgets.Screen | null = null;
  let headerBar: blessed.Widgets.BoxElement | null = null;
  let contentBox: blessed.Widgets.BoxElement | null = null;
  let statusLine: StatusLine | null = null;
  let keyboardManager: KeyboardManager | null = null;
  let rawOutputPane: ReturnType<typeof createRawOutputPane> | null = null;
  let rawOutputFullscreenPane: ReturnType<typeof createRawOutputPane> | null = null;
  let rawOutputBottomContainer: blessed.Widgets.BoxElement | null = null;
  let rawOutputFullscreenContainer: blessed.Widgets.BoxElement | null = null;
  let rawOutputToast: blessed.Widgets.BoxElement | null = null;
  let rawOutputToastTimer: ReturnType<typeof setTimeout> | null = null;
  let rawOutputStore = createRawOutputStore();
  let lastSessionLogPath: string | null = null;
  let sessionLogPrinted = false;
  let runner: PipelineRunner | null = null;
  let router: ScreenRouter | null = null;
  let v2AbortController: AbortController | null = null;
  let lastRenderAt = 0;
  let renderPending = false;
  let rawOutputFullscreen = false;

  function applyThemeToShell(): void {
    const theme = getTheme();
    if (headerBar) {
      headerBar.style = {
        ...(headerBar.style ?? {}),
        fg: theme.colors.inverseFg,
        bg: theme.colors.accent,
      };
    }
    if (contentBox) {
      contentBox.style = {
        ...(contentBox.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    if (rawOutputBottomContainer) {
      rawOutputBottomContainer.style = {
        ...(rawOutputBottomContainer.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
        border: { fg: theme.colors.border },
      };
    }
    if (rawOutputFullscreenContainer) {
      rawOutputFullscreenContainer.style = {
        ...(rawOutputFullscreenContainer.style ?? {}),
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
        border: { fg: theme.colors.border },
      };
    }
    if (rawOutputToast) {
      rawOutputToast.style = {
        ...(rawOutputToast.style ?? {}),
        fg: theme.colors.inverseFg,
        bg: theme.colors.accent,
        border: { fg: theme.colors.accentSoft },
      };
    }
    statusLine?.applyTheme();
    rawOutputPane?.destroy();
    rawOutputPane = rawOutputBottomContainer ? createRawOutputPane(rawOutputBottomContainer, rawOutputStore) : null;
    rawOutputFullscreenPane?.destroy();
    rawOutputFullscreenPane = rawOutputFullscreenContainer
      ? createRawOutputPane(rawOutputFullscreenContainer, rawOutputStore)
      : null;
    router?.current()?.refreshTheme();
    screen?.render();
  }

  function scheduleRender(): void {
    if (!screen) return;
    const now = Date.now();
    if (now - lastRenderAt >= RENDER_DEBOUNCE_MS) {
      lastRenderAt = now;
      screen.render();
    } else if (!renderPending) {
      renderPending = true;
      setTimeout(() => {
        renderPending = false;
        lastRenderAt = Date.now();
        screen?.render();
      }, RENDER_DEBOUNCE_MS - (now - lastRenderAt));
    }
  }

  function destroy(): void {
    v2AbortController?.abort();
    v2AbortController = null;
    runner?.destroy();
    runner = null;
    rawOutputPane?.destroy();
    rawOutputPane = null;
    rawOutputFullscreenPane?.destroy();
    rawOutputFullscreenPane = null;
    if (rawOutputToastTimer) {
      clearTimeout(rawOutputToastTimer);
      rawOutputToastTimer = null;
    }
    rawOutputToast?.destroy();
    rawOutputToast = null;
    statusLine?.destroy();
    ensureSessionLogFile();
    printSessionLogLocation();
    if (screen) {
      screen.destroy();
      screen = null;
    }
  }

  function ensureSessionLogFile(): void {
    const currentPath = rawOutputStore.getCurrent()?.logPath;
    if (currentPath) {
      lastSessionLogPath = currentPath;
      return;
    }

    if (lastSessionLogPath) return;

    const current = rawOutputStore.getCurrent();
    const content = current?.content ?? '';
    const title = current?.title ?? 'session';
    const key = current?.key ?? 'session';
    lastSessionLogPath = persistRawOutputLogSync(process.cwd(), key, title, content);
  }

  function printSessionLogLocation(): void {
    if (sessionLogPrinted) return;
    sessionLogPrinted = true;

    const location = rawOutputStore.getCurrent()?.logPath ?? lastSessionLogPath;
    if (!location) return;
    process.stderr.write(`Session log saved to: ${location}\n`);
  }

  async function run(): Promise<void> {
    const promptHistory: PromptHistoryEntry[] = await loadPromptHistory(process.cwd());

    return new Promise<void>((resolve) => {
      const theme = getTheme();
      screen = blessed.screen({
        smartCSR: true,
        title: 'MAP Pipeline',
        fullUnicode: true,
        warnings: false,
      });

      headerBar = blessed.box({
        parent: screen,
        top: 0,
        left: 0,
        height: 1,
        width: '100%',
        content: ' MAP Pipeline',
        tags: false,
        style: {
          fg: theme.colors.inverseFg,
          bg: theme.colors.accent,
          bold: true,
        },
      });

      contentBox = blessed.box({
        parent: screen,
        top: 1,
        left: 0,
        right: 0,
        bottom: 1,
        width: '100%',
        tags: false,
        style: {
          fg: theme.colors.panelFg,
          bg: theme.colors.panelBg,
        },
      });

      rawOutputBottomContainer = blessed.box({
        parent: screen,
        bottom: 1,
        height: RAW_OUTPUT_HEIGHT,
        left: 0,
        right: 0,
        width: '100%',
        tags: false,
        style: {
          fg: theme.colors.panelFg,
          bg: theme.colors.panelBg,
          border: {
            fg: theme.colors.border,
          },
        },
        hidden: false,
      });
      rawOutputPane = createRawOutputPane(rawOutputBottomContainer, rawOutputStore);

      rawOutputFullscreenContainer = blessed.box({
        parent: screen,
        top: 1,
        bottom: 1,
        left: 0,
        right: 0,
        width: '100%',
        tags: false,
        hidden: true,
        style: {
          fg: theme.colors.panelFg,
          bg: theme.colors.panelBg,
          border: {
            fg: theme.colors.border,
          },
        },
      });
      rawOutputFullscreenPane = createRawOutputPane(
        rawOutputFullscreenContainer,
        rawOutputStore,
      );

      statusLine = new StatusLine(screen);
      statusLine.applyTheme();
      statusLine.update('idle');
      statusLine.setHints('i:insert  Esc:normal  j/k:scroll  f:fullscreen  q:quit  ^C:abort');

      const vim = new VimMode();
      vim.onModeChange((mode) => {
        statusLine?.setVimMode(mode);
      });

      keyboardManager = new KeyboardManager(screen, vim);
      keyboardManager.register('C-t', () => {
        if (isFocusedOnInput(screen)) {
          return;
        }
        toggleTheme();
        applyThemeToShell();
      });

      function findFirstTextbox(node: blessed.Widgets.Node): blessed.Widgets.TextboxElement | null {
        if ((node as blessed.Widgets.TextboxElement).readInput) {
          return node as blessed.Widgets.TextboxElement;
        }
        for (const child of node.children ?? []) {
          const found = findFirstTextbox(child);
          if (found) return found;
        }
        return null;
      }

      (screen as unknown as import('events').EventEmitter).on('vim:insert', () => {
        const tb = findFirstTextbox(contentBox!);
        if (tb) {
          vim.toInsert();
          tb.focus();
          screen?.render();
        }
      });

      (screen as unknown as import('events').EventEmitter).on('vim:blur', () => {
        vim.toNormal();
        contentBox?.focus();
        screen?.render();
      });

      screen.on('element focus', (el: blessed.Widgets.BlessedElement) => {
        if ((el as blessed.Widgets.TextboxElement).readInput) {
          vim.toInsert();
        } else {
          vim.toNormal();
        }
      });

      keyboardManager.register('f', () => {
        if (isFocusedOnInput(screen)) {
          return;
        }
        toggleRawOutputFullscreen();
      });

      keyboardManager.pushScope({
        escape: () => {
          if (isFocusedOnInput(screen)) {
            vim.toNormal();
            (screen as unknown as import('events').EventEmitter).emit('vim:blur');
            return;
          }
          if (rawOutputFullscreen) {
            hideRawOutputFullscreen();
            return;
          }
          (screen as unknown as import('events').EventEmitter).emit('back');
        },
        j: () => {
          if (rawOutputFullscreen) {
            rawOutputFullscreenPane?.element.scroll(1);
          }
        },
        k: () => {
          if (rawOutputFullscreen) {
            rawOutputFullscreenPane?.element.scroll(-1);
          }
        },
        y: () => {
          if (!rawOutputFullscreen) return;
          const current = rawOutputStore.getCurrent();
          if (!current) return;
          void persistCurrentRawOutputLog(current.key, current.title, current.content);
          showRawOutputToast(copyToClipboard(formatRawOutputForStorage(current.content)) ? 'Copied log text' : 'Copy failed');
        },
        'C-y': () => {
          if (!rawOutputFullscreen) return;
          const current = rawOutputStore.getCurrent();
          if (!current) return;
          void persistCurrentRawOutputLog(current.key, current.title, current.content);
          showRawOutputToast(copyToClipboard(formatRawOutputForStorage(current.content)) ? 'Copied log text' : 'Copy failed');
        },
        o: () => {
          if (!rawOutputFullscreen) return;
          const current = rawOutputStore.getCurrent();
          if (!current) return;
          void openCurrentRawOutputLog(current.key, current.title, current.content, current.logPath);
        },
      });

      const agents: Record<StageName, AgentAssignment> = {
        spec: config.agents.spec,
        review: config.agents.review,
        qa: config.agents.qa,
        execute: config.agents.execute,
        docs: config.agents.docs,
      };

      let stageOutput = '';
      let currentTests: TestProgressItem[] = [];
      let currentGithubReport: GitHubReportResult | undefined;
      let autoStarted = false;
      let previousReviewedSpec = '';
      let currentV1RawOutputKey: string | null = null;
      let v2Plan: DAGPlan | null = null;
      let v2Agents: Map<string, AgentDefinition> | null = null;
      let v2MessageVisible = false;

      const securityConfig = {
        ...DEFAULT_SECURITY_CONFIG,
        ...(config.security ?? {}),
      };

      const createV2Adapter = (adapterConfig: AdapterConfig): AgentAdapter =>
        createAdapter({
          ...adapterConfig,
          ...(adapterConfig.type === 'ollama' && adapterConfig.host === undefined
            ? { host: config.ollama.host }
            : {}),
        });

      function setRawOutput(key: string, title: string, content: string, streaming: boolean): void {
        rawOutputStore.setCurrent(key, title, content, streaming);
      }

      function appendRawOutput(key: string, title: string, chunk: string): void {
        rawOutputStore.append(key, title, chunk);
      }

      function markRawOutputComplete(key: string, title: string): void {
        const entry = rawOutputStore.get(key);
        const content = entry?.content ?? '';
        void persistCurrentRawOutputLog(key, title, content).then((logPath) => {
          if (logPath) {
            lastSessionLogPath = logPath;
          }
          rawOutputStore.complete(key, title, logPath ?? undefined);
        });
      }

      async function persistCurrentRawOutputLog(
        key: string,
        title: string,
        content: string,
      ): Promise<string | null> {
        try {
          const logPath = await persistRawOutputLog(process.cwd(), key, title, content);
          lastSessionLogPath = logPath;
          return logPath;
        } catch {
          // Keep logging best-effort; avoid turning a clipboard action into UI noise.
          return null;
        }
      }

      async function openCurrentRawOutputLog(
        key: string,
        title: string,
        content: string,
        logPath?: string,
      ): Promise<void> {
        const resolvedPath =
          logPath ?? (await persistCurrentRawOutputLog(key, title, content));

        if (!resolvedPath) {
          showRawOutputToast('Open failed');
          return;
        }

        showRawOutputToast(openFile(resolvedPath) ? 'Opened log file' : 'Open failed');
      }

      function showRawOutputFullscreen(): void {
        if (rawOutputFullscreen) return;
        rawOutputFullscreen = true;
        rawOutputBottomContainer?.hide();
        rawOutputFullscreenContainer?.show();
        rawOutputFullscreenPane?.element.focus();
        statusLine?.setHints('Esc:close raw output  f:toggle  j/k:scroll  y/C-y:copy  o:open log');
        screen?.render();
      }

      function hideRawOutputFullscreen(): void {
        if (!rawOutputFullscreen) return;
        rawOutputFullscreen = false;
        rawOutputFullscreenContainer?.hide();
        rawOutputBottomContainer?.show();
        contentBox?.focus();
        statusLine?.setHints('f:fullscreen  q:quit');
        screen?.render();
      }

      function toggleRawOutputFullscreen(): void {
        if (rawOutputFullscreen) {
          hideRawOutputFullscreen();
        } else {
          showRawOutputFullscreen();
        }
      }

      function showRawOutputToast(message: string): void {
        if (rawOutputToastTimer) {
          clearTimeout(rawOutputToastTimer);
          rawOutputToastTimer = null;
        }

        if (!rawOutputToast && rawOutputFullscreenContainer) {
          rawOutputToast = blessed.box({
            parent: rawOutputFullscreenContainer,
            top: 2,
            left: 'center',
            width: 'shrink',
            height: 3,
            tags: false,
            hidden: true,
            padding: {
              left: 2,
              right: 2,
            },
            border: 'line',
            style: {
              fg: getTheme().colors.inverseFg,
              bg: getTheme().colors.accent,
              border: {
                fg: getTheme().colors.accentSoft,
              },
            },
          });
        }

        if (!rawOutputToast) return;

        rawOutputToast.setContent(message);
        rawOutputToast.show();
        screen?.render();

        rawOutputToastTimer = setTimeout(() => {
          rawOutputToast?.hide();
          screen?.render();
          rawOutputToastTimer = null;
        }, 1400);
      }

      const availableBackends: string[] = [];
      if (detection.claude.installed) availableBackends.push('claude');
      if (detection.codex.installed) availableBackends.push('codex');
      if (detection.ollama.installed) availableBackends.push('ollama');
      if (detection.hermes.installed) availableBackends.push('hermes');
      async function startPipeline(prompt: string, githubIssueUrl?: string): Promise<void> {
        try {
          await recordPromptHistory(process.cwd(), {
            prompt,
            githubIssueUrl,
          });
        } catch {
          // Prompt history is best-effort only.
        }

        if (useV2 || shouldUseResearchFlow(prompt, githubIssueUrl)) {
          void startV2Flow(prompt, githubIssueUrl);
          return;
        }

        runner?.start(prompt, githubIssueUrl);
      }

      const welcomeScreen = new WelcomeScreen(
        contentBox,
        {
          availableBackends,
          initialGithubIssueUrl,
          recentPrompts: promptHistory,
        },
        (prompt, githubIssueUrl) => {
          void startPipeline(prompt, githubIssueUrl);
        },
      );

      const pipelineScreen = new PipelineScreen(contentBox, {
        stages: computeBarStages('idle', agents),
        iteration: 1,
        output: '',
        streaming: false,
        stageName: '',
        agentName: '',
      });

      const feedbackScreen = new FeedbackScreen(contentBox, {
        stages: computeBarStages('feedback', agents),
        iteration: 1,
        scores: [],
        specContent: '',
        onApprove: () => runner?.approve(),
        onFeedback: (text) => runner?.sendFeedback(text),
      });

      const executeScreen = new ExecuteScreen(contentBox, {
        stages: computeBarStages('executing', agents),
        iteration: 1,
        output: '',
        streaming: false,
        tests: [],
      });

      const completeScreen = new CompleteScreen(contentBox, {
        iterations: 0,
        testsTotal: 0,
        testsPassing: 0,
        filesCreated: [],
        duration: 0,
        outputDir: config.outputDir,
        onNewPipeline: () => {
          destroy();
        },
      });

      const routerPlanScreen = new RouterPlanScreen(contentBox, {
        plan: { plan: [] },
        onApprove: () => { /* set on demand */ },
        onCancel: () => { /* set on demand */ },
      });

      const dagExecutionScreen = new DAGExecutionScreen(contentBox, {
        steps: [],
      });

      const screenMap = new Map<string, BaseScreen>();
      screenMap.set('idle', welcomeScreen);
      screenMap.set('specifying', pipelineScreen);
      screenMap.set('reviewing', pipelineScreen);
      screenMap.set('specAssessing', pipelineScreen);
      screenMap.set('feedback', feedbackScreen);
      screenMap.set('executing', executeScreen);
      screenMap.set('fixing', executeScreen);
      screenMap.set('codeAssessing', pipelineScreen);
      screenMap.set('documenting', pipelineScreen);
      screenMap.set('complete', completeScreen);
      screenMap.set('v2-routing', pipelineScreen);
      screenMap.set('v2-message', pipelineScreen);
      screenMap.set('router-plan', routerPlanScreen);
      screenMap.set('dag-executing', dagExecutionScreen);

      router = new ScreenRouter(contentBox, screenMap);

      function resetToWelcome(): void {
        v2AbortController?.abort();
        v2AbortController = null;
        v2Plan = null;
        v2Agents = null;
        v2MessageVisible = false;
        stageOutput = '';
        statusLine?.stopTimer();
        statusLine?.update('idle');
        statusLine?.setHints('i:insert  Esc:normal  j/k:scroll  f:fullscreen  q:quit  ^C:abort');
        router?.transition('idle');
      }

      function showV2Message(
        title: string,
        message: string,
        phase: 'complete' | 'failed' = 'failed',
      ): void {
        v2MessageVisible = true;
        pipelineScreen.updateData({
          stages: computeV2BarStages(phase),
          iteration: 1,
          output: message,
          streaming: false,
          stageName: title,
          agentName: 'router',
        });
        statusLine?.stopTimer();
        statusLine?.update(phase === 'complete' ? 'complete' : 'error', 'router');
        statusLine?.setHints('Esc:back  f:fullscreen  q:quit');
        router?.transition('v2-message');
      }

      async function startV2Execution(): Promise<void> {
        if (!v2Plan || !v2Agents) {
          return;
        }

        const initialSteps: StepResult[] = v2Plan.plan.map((step) => ({
          id: step.id,
          agent: step.agent,
          task: step.task,
          status: 'pending',
        }));
        const stepMap = new Map(initialSteps.map((step) => [step.id, step]));

        const renderSteps = () => {
          dagExecutionScreen.updateData({
            steps:
              v2Plan?.plan.map(
                (step) =>
                  stepMap.get(step.id) ?? {
                    id: step.id,
                    agent: step.agent,
                    task: step.task,
                    status: 'pending',
                  },
              ) ?? [],
          });
        };

        const updateStep = (stepId: string, update: Partial<StepResult>) => {
          const current = stepMap.get(stepId);
          if (!current) return;
          stepMap.set(stepId, { ...current, ...update });
          renderSteps();
        };

        renderSteps();
        statusLine?.update('executing', 'dag');
        statusLine?.setHints('q:quit  ^C:abort  f:fullscreen');
        router?.transition('dag-executing');

        v2AbortController?.abort();
        v2AbortController = new AbortController();

        const reporter = {
          onChunk(_bytes: number) {},
          dagStepStart(stepId: string, agent: string) {
            setRawOutput(stepId, `Step ${stepId} [${agent}]`, '', true);
            updateStep(stepId, { status: 'running', error: undefined, reason: undefined });
          },
          dagStepComplete(stepId: string, _agent: string, duration: number) {
            markRawOutputComplete(stepId, `Step ${stepId}`);
            updateStep(stepId, { status: 'completed', duration });
          },
          dagStepFailed(stepId: string, _agent: string, error: string) {
            markRawOutputComplete(stepId, `Step ${stepId}`);
            updateStep(stepId, { status: 'failed', error });
          },
          dagStepSkipped(stepId: string, reason: string) {
            markRawOutputComplete(stepId, `Step ${stepId}`);
            updateStep(stepId, { status: 'skipped', reason });
          },
          dagStepRetry(stepId: string, _agent: string, attempt: number, error: string) {
            updateStep(stepId, { status: 'running', error: `Retry ${attempt}: ${error}` });
          },
          securityGateStart(_stepId: string, _agent: string) {},
          securityGatePassed(_stepId: string, _duration: number) {},
          securityGateFailed(_stepId: string, _findingCount: number) {},
        };

          const result = await executeDAG(
            v2Plan,
            v2Agents,
            createV2Adapter,
            reporter as any,
          {
            config: securityConfig,
            createReviewAdapter: () =>
              createV2Adapter({
                type: securityConfig.adapter,
                model: securityConfig.model,
              }),
            },
            v2AbortController.signal,
            (stepId, chunk) => {
              appendRawOutput(stepId, `Step ${stepId}`, chunk);
            },
            {
              stepTimeoutMs: config.router.stepTimeoutMs,
              maxStepRetries: config.router.maxStepRetries,
              retryDelayMs: config.router.retryDelayMs,
              adapterDefaults: config.adapterDefaults,
            },
          );

        dagExecutionScreen.updateData({ steps: result.steps });
        statusLine?.stopTimer();
        statusLine?.update(result.success ? 'complete' : 'failed', 'dag');
        statusLine?.setHints('q:quit  f:fullscreen');
      }

      async function startV2Flow(prompt: string, githubIssueUrl?: string): Promise<void> {
        try {
          v2AbortController?.abort();
          v2AbortController = new AbortController();
          v2Plan = null;
          v2Agents = null;
          v2MessageVisible = false;
          stageOutput = '';
          currentGithubReport = undefined;

          const routerRawKey = 'router';
          setRawOutput(routerRawKey, 'Router', '', true);

          statusLine?.update('routing', config.router.adapter);
          statusLine?.setHints('q:quit  ^C:abort  f:fullscreen');
          statusLine?.startTimer();
          pipelineScreen.updateData({
            stages: computeV2BarStages('routing'),
            iteration: 1,
            output: '',
            streaming: true,
            stageName: 'Routing Task',
            agentName: `${config.router.adapter}/${config.router.model}`,
          });
          router?.transition('v2-routing');

          let resolvedPrompt = prompt;
          if (githubIssueUrl?.trim()) {
            const token = await resolveGitHubToken(config);
            if (!token) {
              showV2Message(
                'GitHub Setup Required',
                'GitHub token not found. Set GITHUB_TOKEN, add github.token to pipeline.yaml, or run "gh auth login".',
              );
              return;
            }

            const issueContext = await fetchGitHubIssueContext(
              parseGitHubIssueUrl(githubIssueUrl),
              token,
            );
            resolvedPrompt = buildGitHubIssuePrompt(issueContext, prompt);
          }

          const agentsDir = path.join(process.cwd(), 'agents');
          const rawAgents = await loadAgentRegistry(agentsDir);

          for (const [name, overrides] of Object.entries(config.agentOverrides)) {
            const base = rawAgents.get(name);
            if (base) {
              rawAgents.set(name, mergeWithOverrides(base, overrides));
            }
          }

          const enabledAgents = getEnabledAgents(rawAgents);
          if (enabledAgents.size === 0) {
            showV2Message(
              'No Agents Available',
              'No agents available. Create one with: map agent create',
            );
            return;
          }

          v2Agents = enabledAgents;

          const decision = await routeTask(
            resolvedPrompt,
            enabledAgents,
            createV2Adapter({
              type: config.router.adapter,
              model: config.router.model,
            }),
            config.router,
            v2AbortController.signal,
            (chunk) => appendRawOutput(routerRawKey, 'Router', chunk),
          );

          markRawOutputComplete(routerRawKey, 'Router');

          if (decision.kind === 'no-match') {
            showV2Message('No Matching Agent', formatRouterNoMatchMessage(decision));
            return;
          }

          v2Plan = decision.plan;
          routerPlanScreen.updateData({
            plan: v2Plan,
            onApprove: () => {
              void startV2Execution();
            },
            onCancel: () => {
              resetToWelcome();
            },
          });
          statusLine?.update('router-plan', config.router.adapter);
          statusLine?.setHints('Enter: execute  Esc: cancel  f:fullscreen  q:quit');
          router?.transition('router-plan');
        } catch (err: unknown) {
          markRawOutputComplete('router', 'Router');
          const message = err instanceof Error ? err.message : String(err);
          showV2Message('Routing Failed', message);
        }
      }

      if (!useV2) {
        runner = new PipelineRunner(config, detection, agents, {
          onStateChange(state: string, context: PipelineContext) {
            const isActive = ACTIVE_STATES.has(state);

            if (isActive) {
              stageOutput = '';
              const rawKey = getV1RawOutputKey(state, context.iteration);
              if (rawKey && rawKey !== currentV1RawOutputKey) {
                setRawOutput(rawKey, getV1RawOutputLabel(state), '', true);
                currentV1RawOutputKey = rawKey;
              }
            } else {
              currentV1RawOutputKey = null;
            }

            vim.toNormal();

            const stage = isActive ? resolveAgentStage(state) : undefined;
            const agentName = stage ? agents[stage].adapter : undefined;
            statusLine?.update(state, agentName);

            if (isActive) {
              statusLine?.startTimer();
            } else {
              statusLine?.stopTimer();
            }

            const barStages = computeBarStages(state, agents);

            if (PIPELINE_SCREEN_STATES.has(state)) {
              pipelineScreen.updateData({
                stages: barStages,
                iteration: context.iteration,
                output: stageOutput,
                streaming: true,
                stageName: STATE_LABELS[state] ?? state,
                agentName: agentName ?? '',
              });
            }

            if (EXECUTE_SCREEN_STATES.has(state)) {
              executeScreen.updateData({
                stages: barStages,
                iteration: context.iteration,
                output: stageOutput,
                streaming: true,
                tests: currentTests.map(mapTestStatus),
              });
            }

            if (state === 'feedback') {
              const scores = context.refinementScores.map((s) => ({
                iteration: s.iteration,
                score: s.score,
              }));
              feedbackScreen.updateData({
                stages: barStages,
                iteration: context.iteration,
                scores,
                specContent: context.reviewedSpec?.content ?? context.spec?.content ?? '',
                previousSpecContent: previousReviewedSpec || undefined,
                onApprove: () => runner?.approve(),
                onFeedback: (text) => runner?.sendFeedback(text),
              });
              previousReviewedSpec = context.reviewedSpec?.content ?? '';
            }

            if (state === 'complete') {
              const result = context.executionResult;
              completeScreen.updateData({
                iterations: context.iteration,
                testsTotal: result?.testsTotal ?? 0,
                testsPassing: result?.testsPassing ?? 0,
                filesCreated: result?.filesCreated ?? [],
                duration: Date.now() - context.startedAt.getTime(),
                outputDir: result?.outputDir ?? config.outputDir,
                securitySummary: securityConfig.enabled
                  ? 'enabled for all eligible outputs'
                  : 'disabled',
                qaAssessments: context.qaAssessments,
                documentationResult: context.documentationResult,
                githubReport: currentGithubReport,
              });
            }

            router?.transition(state);
            screen?.render();
          },

          onStreamChunk(chunk: string) {
            stageOutput += chunk;

            const current = router?.current();
            if (current === pipelineScreen) {
              pipelineScreen.updateData({ output: stageOutput });
            } else if (current === executeScreen) {
              executeScreen.updateData({ output: stageOutput });
            }

            const rawKey = rawOutputStore.getCurrent()?.key ?? null;
            if (rawKey) {
              const title = rawOutputStore.get(rawKey)?.title ?? 'Output';
              appendRawOutput(rawKey, title, chunk);
            }

            scheduleRender();
          },

          onTestProgress(tests: TestProgressItem[]) {
            currentTests = tests;
            executeScreen.updateData({ tests: currentTests.map(mapTestStatus) });
            scheduleRender();
          },

          onGithubReport(report: GitHubReportResult) {
            currentGithubReport = report;
            screen?.render();
          },

          onError(error: string) {
            statusLine?.update('error');
            statusLine?.setHints(`ERROR: ${error.slice(0, 60)}  f:fullscreen`);
            screen?.render();
          },
        });
      }

      screen.on('back', () => {
        if (useV2 && v2MessageVisible) {
          resetToWelcome();
        }
      });

      screen.on('abort', () => {
        if (useV2) {
          v2AbortController?.abort();
          destroy();
          return;
        }
        runner?.cancel();
      });

      screen.on('resize', () => {
        router?.current()?.resize();
        screen?.render();
      });

      screen.on('destroy', () => {
        v2AbortController?.abort();
        v2AbortController = null;
        runner?.destroy();
        runner = null;
        rawOutputPane?.destroy();
        rawOutputPane = null;
        statusLine?.destroy();
        resolve();
      });

      process.on('exit', () => {
        destroy();
      });

      void keyboardManager;

      router.transition('idle');
      screen.render();

      if (initialPrompt && initialPrompt.trim() !== '' && !autoStarted) {
        autoStarted = true;
        void startPipeline(initialPrompt.trim(), initialGithubIssueUrl);
      }
    });
  }

  return { run, destroy };
}
