import blessed from 'neo-blessed';
import { BaseScreen } from './base-screen.js';
import { createLogo } from '../widgets/logo.js';
import { validatePrompt } from '../../utils/prompt-validation.js';
import { getTheme, fgTag } from '../theme.js';
import { normalizeTerminalText, truncateText } from '../../utils/terminal-text.js';
import type { PromptHistoryEntry } from '../prompt-history.js';

export interface WelcomeScreenData {
  availableBackends: string[];
  initialPrompt?: string;
  initialGithubIssueUrl?: string;
  githubIssueError?: string;
  recentPrompts?: PromptHistoryEntry[];
}

function createCompactLogo(parent: blessed.Widgets.Node): ReturnType<typeof createLogo> {
  const element = blessed.box({
    parent,
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    tags: true,
    align: 'center',
    style: {
      fg: getTheme().colors.panelFg,
      bg: getTheme().colors.panelBg,
    },
  });

  function update(): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    element.setContent(
      `${fgTag(theme.colors.accent)}{bold}MAP Pipeline{/bold}{/}\n${fgTag(theme.colors.muted)}Multi-agent delivery workspace{/}`,
    );
    element.screen?.render();
  }

  update();

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}

export class WelcomeScreen extends BaseScreen {
  private data: WelcomeScreenData;
  private onStart: (prompt: string, githubIssueUrl?: string) => void;
  private logoWidget: ReturnType<typeof createLogo> | null = null;
  private backendsPanel: blessed.Widgets.BoxElement | null = null;
  private promptPanel: blessed.Widgets.BoxElement | null = null;
  private promptInput: blessed.Widgets.TextboxElement | null = null;
  private urlInput: blessed.Widgets.TextboxElement | null = null;
  private validationError: blessed.Widgets.BoxElement | null = null;
  private historyPanel: blessed.Widgets.BoxElement | null = null;
  private historyList: blessed.Widgets.ListElement | null = null;
  private historyVisible = false;
  private inlineHistoryIndex = -1;

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
    if (this.historyList && this.data.recentPrompts) {
      this.historyList.setItems(
        this.data.recentPrompts.map((entry, index) => this.formatHistoryLabel(entry, index)) as unknown as string[],
      );
    }
  }

  private formatHistoryLabel(entry: PromptHistoryEntry, index: number): string {
    const url = entry.githubIssueUrl ? ` — ${entry.githubIssueUrl}` : '';
    const prompt = normalizeTerminalText(entry.prompt).replace(/\s+/g, ' ').trim() || '(GitHub issue only)';
    const width = Math.max(48, Number(this.parent.screen?.width ?? 100) - 14);
    return `${index + 1}. ${truncateText(`${prompt}${url}`, width)}`;
  }

  private hideHistoryPicker(): void {
    this.historyVisible = false;
    this.historyPanel?.hide();
    this.promptInput?.focus();
    this.parent.screen?.render();
  }

  private showHistoryPicker(): void {
    if (!this.historyPanel || !this.historyList) return;
    if ((this.data.recentPrompts ?? []).length === 0) return;

    this.historyVisible = true;
    (this.promptInput as blessed.Widgets.TextboxElement & { blur?: () => void })?.blur?.();
    (this.urlInput as blessed.Widgets.TextboxElement & { blur?: () => void })?.blur?.();
    this.historyPanel.show();
    this.historyList.select(0);
    this.historyList.focus();
    const first = (this.data.recentPrompts ?? [])[0];
    if (first) {
      this.promptInput?.setValue(first.prompt);
      this.urlInput?.setValue(first.githubIssueUrl ?? '');
      this.validationError?.setContent('');
    }
    this.parent.screen?.render();
  }

  private applyHistoryEntry(entry: PromptHistoryEntry): void {
    this.promptInput?.setValue(entry.prompt);
    this.urlInput?.setValue(entry.githubIssueUrl ?? '');
    this.validationError?.setContent('');
    this.inlineHistoryIndex = (this.data.recentPrompts ?? []).findIndex(
      (candidate) =>
        candidate.prompt === entry.prompt && candidate.githubIssueUrl === entry.githubIssueUrl,
    );
    this.hideHistoryPicker();
  }

  private cycleInlineHistory(direction: 1 | -1): void {
    const history = this.data.recentPrompts ?? [];
    if (history.length === 0 || this.historyVisible) return;

    if (direction > 0) {
      this.inlineHistoryIndex =
        this.inlineHistoryIndex <= 0 ? history.length - 1 : this.inlineHistoryIndex - 1;
    } else {
      this.inlineHistoryIndex =
        this.inlineHistoryIndex >= history.length - 1 ? 0 : this.inlineHistoryIndex + 1;
    }

    const entry = history[this.inlineHistoryIndex];
    if (!entry) return;
    this.promptInput?.setValue(entry.prompt);
    this.urlInput?.setValue(entry.githubIssueUrl ?? '');
    this.validationError?.setContent('');
    this.parent.screen?.render();
  }

  refreshTheme(): void {
    const theme = getTheme();
    this.logoWidget?.update();
    if (this.backendsPanel) {
      this.backendsPanel.style = {
        ...(this.backendsPanel.style ?? {}),
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    if (this.promptPanel) {
      this.promptPanel.style = {
        ...(this.promptPanel.style ?? {}),
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    if (this.historyPanel) {
      this.historyPanel.style = {
        ...(this.historyPanel.style ?? {}),
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    if (this.historyList) {
      this.historyList.style = {
        ...(this.historyList.style ?? {}),
        selected: { fg: theme.colors.accent, bold: true },
        item: { fg: theme.colors.panelFg },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      };
    }
    for (const input of [this.promptInput, this.urlInput]) {
      if (!input) continue;
      input.style = {
        ...(input.style ?? {}),
        fg: theme.colors.inputFg,
        bg: theme.colors.inputBg,
        focus: {
          ...(input.style?.focus ?? {}),
          fg: theme.colors.inputFg,
          bg: theme.colors.selectionBg,
        },
      };
    }
    this.validationError?.screen?.render();
    this.parent.screen?.render();
  }

  activate(): void {
    const terminalHeight = Number(
      this.parent.screen?.height ?? this.parent.screen?.program.rows ?? 24,
    );
    const compact = terminalHeight <= 26;
    const theme = getTheme();

    // Logo
    const logo = compact
      ? createCompactLogo(this.parent)
      : createLogo(this.parent);
    this.logoWidget = logo;
    this.widgets.push(logo);

    // ── Available Backends Panel ─────────────────────────────
    const backends = this.data.availableBackends;
    const backendsContent = backends.length > 0
      ? backends.map((b) => `  ${fgTag(getTheme().colors.accent)}●{/} ${b}`).join('\n')
      : `  ${fgTag(getTheme().colors.muted)}No backends detected — install Claude, Codex, Ollama, or Hermes{/}`;

    const backendsPanelTop = compact ? 2 : 9;
    const backendsPanelHeight = backends.length + 3;
    const backendsPanel = blessed.box({
      parent: this.parent,
      top: backendsPanelTop,
      left: 1,
      right: 1,
      height: backendsPanelHeight,
      border: { type: 'line' },
      tags: true,
      label: ` ${fgTag(theme.colors.accent)}{bold}Available Backends{/bold}{/} `,
      style: {
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      },
      content: `${fgTag(theme.colors.muted)}Agents will be selected dynamically based on what you want to do:{/}\n${backendsContent}`,
    });
    this.backendsPanel = backendsPanel;
    this.widgets.push({ destroy: () => backendsPanel.destroy() });

    // ── Task Prompt Panel ───────────────────────────────────
    const promptPanelTop = backendsPanelTop + backendsPanelHeight + 1;
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
      label: ` ${fgTag(theme.colors.accent)}{bold}Start Here{/bold}{/} `,
      style: {
        border: { fg: theme.colors.border },
        fg: theme.colors.panelFg,
        bg: theme.colors.panelBg,
      },
    });
    this.promptPanel = promptPanel;
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
      content: `${fgTag(theme.colors.accent)}>{/} `,
    });

    const promptInput = blessed.textbox({
      parent: promptRow,
      left: 2,
      height: 1,
      width: '100%-2',
      inputOnFocus: true,
      keys: true,
      mouse: false,
      style: {
        fg: theme.colors.inputFg,
        bg: theme.colors.inputBg,
        focus: { fg: theme.colors.inputFg, bg: theme.colors.selectionBg },
      },
    }) as blessed.Widgets.TextboxElement;
    this.promptInput = promptInput;

    // GitHub URL label
    blessed.box({
      parent: promptPanel,
      top: 3,
      left: 1,
      tags: true,
      height: 1,
      shrink: true,
      content: `${fgTag(theme.colors.muted)}GitHub issue URL (optional){/}`,
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
      content: `${fgTag(theme.colors.accent)}issue>{/} `,
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
      style: {
        fg: theme.colors.inputFg,
        bg: theme.colors.inputBg,
        focus: { fg: theme.colors.inputFg, bg: theme.colors.selectionBg },
      },
    }) as blessed.Widgets.TextboxElement;
    this.urlInput = urlInput;

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
      content: `${fgTag(theme.colors.muted)}i: focus input  Esc: blur  Tab: cycle  Enter: continue  Ctrl+H: history  a: agents{/}`,
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
    this.validationError = validationError;
    this.widgets.push({ destroy: () => validationError.destroy() });

    const recentPrompts = this.data.recentPrompts ?? [];
    if (recentPrompts.length > 0) {
      const historyPanel = blessed.box({
        parent: this.parent,
        top: promptPanelTop + promptPanelHeight + 1,
        left: 1,
        right: 1,
        bottom: 2,
        border: { type: 'line' },
        hidden: true,
        tags: true,
        label: ` ${fgTag(theme.colors.accent)}{bold}Prompt History{/bold}{/} `,
        style: {
          border: { fg: theme.colors.border },
          fg: theme.colors.panelFg,
          bg: theme.colors.panelBg,
        },
      });
      this.historyPanel = historyPanel;
      this.widgets.push({ destroy: () => historyPanel.destroy() });

      const historyList = blessed.list({
        parent: historyPanel,
        top: 1,
        left: 1,
        right: 1,
        bottom: 2,
        keys: true,
        vi: true,
        mouse: false,
        tags: true,
        items: recentPrompts.map((entry, index) => this.formatHistoryLabel(entry, index)),
        style: {
          selected: { fg: theme.colors.accent, bold: true },
          item: { fg: theme.colors.panelFg },
        },
      }) as blessed.Widgets.ListElement;
      this.historyList = historyList;
      this.widgets.push({ destroy: () => historyList.destroy() });

      historyList.key('enter', () => {
        const idx = (historyList as blessed.Widgets.ListElement & { selected: number }).selected;
        const selected = recentPrompts[idx] ?? recentPrompts[0];
        if (selected) {
          this.applyHistoryEntry(selected);
        }
      });

      const first = recentPrompts[0];
      if (first) {
        promptInput.setValue(first.prompt);
        urlInput.setValue(first.githubIssueUrl ?? '');
      }

      blessed.box({
        parent: historyPanel,
        bottom: 0,
        left: 1,
        right: 1,
        height: 1,
        tags: true,
        content: `${fgTag(theme.colors.muted)}Ctrl+H: close  Enter: use selected prompt{/}`,
      });

    }

    if (this.data.initialPrompt) {
      promptInput.setValue(this.data.initialPrompt);
    }

    // Tab cycles focus between prompt and URL inputs
    const focusOrder: Array<blessed.Widgets.BlessedElement> = [promptInput, urlInput];
    let focusIdx = 0;
    promptInput.focus();

    const screen = this.parent.screen;
    const submit = () => {
      if (this.historyVisible) {
        return;
      }

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
      this.parent.screen?.render();
      this.onStart(promptVal, urlVal || undefined);
    };
    if (screen) {
      const tabHandler = () => {
        focusIdx = (focusIdx + 1) % focusOrder.length;
        focusOrder[focusIdx]?.focus();
      };
      const historyHandler = () => {
        if (this.historyVisible) {
          this.hideHistoryPicker();
        } else {
          this.showHistoryPicker();
        }
      };
      screen.key('tab', tabHandler);
      screen.key('C-h', historyHandler);
      screen.key('backspace', historyHandler);
      const upHandler = () => this.cycleInlineHistory(-1);
      const downHandler = () => this.cycleInlineHistory(1);
      promptInput.key('up', upHandler);
      promptInput.key('down', downHandler);

      const globalEnterHandler = (_ch: string, key: { name?: string }) => {
        if (key.name !== 'enter') {
          return;
        }

        if (this.historyVisible) {
          return;
        }

        submit();
      };

      screen.program.on('keypress', globalEnterHandler);
      this.widgets.push({
        destroy: () => {
          screen.unkey('tab', tabHandler);
          screen.unkey('C-h', historyHandler);
          screen.unkey('backspace', historyHandler);
          promptInput.unkey('up', upHandler);
          promptInput.unkey('down', downHandler);
          screen.program.off('keypress', globalEnterHandler);
        },
      });
    }

    this.parent.screen?.render();
  }
}
