import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { createLogo } from '../widgets/logo.js';
import { validatePrompt } from '../../utils/prompt-validation.js';

export interface WelcomeScreenData {
  availableBackends: string[];
  initialGithubIssueUrl?: string;
  githubIssueError?: string;
}

export class WelcomeScreen extends BaseScreen {
  private data: WelcomeScreenData;
  private onStart: (prompt: string, githubIssueUrl?: string) => void;

  constructor(
    parent: blessed.Widgets.BoxElement,
    data: WelcomeScreenData,
    onStart: (prompt: string, githubIssueUrl?: string) => void,
  ) {
    super(parent);
    this.data = data;
    this.onStart = onStart;
  }

  updateData(data: Partial<WelcomeScreenData>): void {
    this.data = { ...this.data, ...data };
  }

  activate(): void {
    // Logo
    const logo = createLogo(this.parent);
    this.widgets.push(logo);

    // ── Available Backends Panel ─────────────────────────────
    const backends = this.data.availableBackends;
    const backendsContent = backends.length > 0
      ? backends.map((b) => `  {#d75f00-fg}●{/#d75f00-fg} ${b}`).join('\n')
      : '  {#585858-fg}No backends detected — install Claude, Codex, Ollama, or Hermes{/#585858-fg}';

    const backendsPanel = blessed.box({
      parent: this.parent,
      top: 9,
      left: 1,
      right: 1,
      height: backends.length + 3,
      border: { type: 'line' },
      tags: true,
      label: ' {#d75f00-fg}{bold}Available Backends{/bold}{/#d75f00-fg} ',
      style: { border: { fg: '#d75f00' } },
      content: `{#585858-fg}Agents will be selected dynamically based on what you want to do:{/#585858-fg}\n${backendsContent}`,
    });
    this.widgets.push({ destroy: () => backendsPanel.destroy() });

    // ── Task Prompt Panel ───────────────────────────────────
    const promptPanelTop = 9 + backends.length + 3 + 1;
    const hasError = Boolean(this.data.githubIssueError);
    const promptPanelHeight = hasError ? 11 : 10;

    const promptPanel = blessed.box({
      parent: this.parent,
      top: promptPanelTop,
      left: 1,
      right: 1,
      height: promptPanelHeight,
      border: { type: 'line' },
      tags: true,
      label: ' {#d75f00-fg}{bold}Start Here{/bold}{/#d75f00-fg} ',
      style: { border: { fg: '#d75f00' } },
    });
    this.widgets.push({ destroy: () => promptPanel.destroy() });

    // Prompt label
    blessed.box({
      parent: promptPanel,
      top: 0,
      left: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: '{bold}What would you like to do?{/bold}',
    });

    // Prompt input row
    const promptRow = blessed.box({
      parent: promptPanel,
      top: 1,
      left: 1,
      height: 1,
      width: '100%-4',
    });

    blessed.box({
      parent: promptRow,
      tags: true,
      width: 2,
      height: 1,
      left: 0,
      content: '{#d75f00-fg}>{/} ',
    });

    const promptInput = blessed.textbox({
      parent: promptRow,
      left: 2,
      height: 1,
      width: '100%-2',
      inputOnFocus: true,
      keys: true,
      mouse: false,
      style: { fg: 'white', focus: { fg: 'white' } },
    }) as blessed.Widgets.TextboxElement;

    // GitHub URL label
    blessed.box({
      parent: promptPanel,
      top: 3,
      left: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: '{#585858-fg}GitHub issue URL (optional){/#585858-fg}',
    });

    // GitHub URL input row
    const urlRow = blessed.box({
      parent: promptPanel,
      top: 4,
      left: 1,
      height: 1,
      width: '100%-4',
    });

    blessed.box({
      parent: urlRow,
      tags: true,
      width: 8,
      height: 1,
      left: 0,
      content: '{#d75f00-fg}issue>{/} ',
    });

    const urlInput = blessed.textbox({
      parent: urlRow,
      left: 8,
      height: 1,
      width: '100%-8',
      inputOnFocus: true,
      keys: true,
      mouse: false,
      value: this.data.initialGithubIssueUrl ?? '',
      style: { fg: 'white', focus: { fg: 'white' } },
    }) as blessed.Widgets.TextboxElement;

    if (hasError) {
      blessed.box({
        parent: promptPanel,
        top: 5,
        left: 1,
        tags: true,
        height: 1,
        shrink: true,
        content: `{red-fg}${this.data.githubIssueError}{/red-fg}`,
      });
    }

    // Keyboard hints
    const hintsTop = hasError ? 7 : 6;
    blessed.box({
      parent: promptPanel,
      top: hintsTop,
      left: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: '{#585858-fg}i: focus input  Esc: blur  Tab: cycle  Enter: continue{/#585858-fg}',
    });

    // Validation error box — hidden until needed
    const validationError = blessed.box({
      parent: promptPanel,
      top: hintsTop + 1,
      left: 1,
      right: 1,
      tags: true,
      height: 2,
      content: '',
    });
    this.widgets.push({ destroy: () => validationError.destroy() });

    // Tab cycles focus between prompt and URL inputs
    const focusOrder: Array<blessed.Widgets.BlessedElement> = [promptInput, urlInput];
    let focusIdx = 0;

    const screen = this.parent.screen;
    if (screen) {
      screen.key(['tab'], () => {
        focusIdx = (focusIdx + 1) % focusOrder.length;
        focusOrder[focusIdx]?.focus();
      });
      this.widgets.push({
        destroy: () => { screen.key(['tab'], () => { /* unregistered */ }); },
      });
    }

    // Submit on Enter in prompt — validate first
    promptInput.key(['enter'], () => {
      const promptVal = promptInput.getValue().trim();
      const urlVal = urlInput.getValue().trim();
      if (!promptVal && !urlVal) return;

      const validation = validatePrompt(promptVal, urlVal);
      if (!validation.valid) {
        validationError.setContent(`{red-fg}${validation.error}{/red-fg}`);
        this.parent.screen?.render();
        return;
      }

      validationError.setContent('');
      promptInput.clearValue();
      this.parent.screen?.render();
      this.onStart(promptVal, urlVal || undefined);
    });

    // Also submit on Enter from URL input
    urlInput.key(['enter'], () => {
      const promptVal = promptInput.getValue().trim();
      const urlVal = urlInput.getValue().trim();
      if (!promptVal && !urlVal) return;

      const validation = validatePrompt(promptVal, urlVal);
      if (!validation.valid) {
        validationError.setContent(`{red-fg}${validation.error}{/red-fg}`);
        this.parent.screen?.render();
        return;
      }

      validationError.setContent('');
      promptInput.clearValue();
      this.parent.screen?.render();
      this.onStart(promptVal, urlVal || undefined);
    });

    // Start with focus on prompt input
    promptInput.focus();
    this.parent.screen?.render();
  }
}
