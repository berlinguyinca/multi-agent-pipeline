import blessed from 'neo-blessed';
import type { VimModeValue } from './vim-mode.js';
import { getTheme, getThemeLabel, type Theme } from './theme.js';
import { truncateText } from '../utils/terminal-text.js';

export interface StatusLineData {
  state: string;
  agent?: string;
  hints?: string;
}

export class StatusLine {
  private box: blessed.Widgets.BoxElement;
  private screen: blessed.Widgets.Screen;
  private data: StatusLineData;
  private vimMode: VimModeValue = 'NORMAL';
  private startedAt: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private theme: Theme = getTheme();

  constructor(screen: blessed.Widgets.Screen) {
    this.screen = screen;
    this.data = { state: 'idle' };

    this.box = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      height: 1,
      width: '100%',
      tags: false,
      style: {
        fg: this.theme.colors.inverseFg,
        bg: this.theme.colors.inverseBg,
      },
    });
  }

  applyTheme(): void {
    this.theme = getTheme();
    this.box.style = {
      ...this.box.style,
      fg: this.theme.colors.inverseFg,
      bg: this.theme.colors.inverseBg,
    };
    this._render();
  }

  update(state: string, agent?: string): void {
    this.data = { ...this.data, state, agent };
    this._render();
  }

  setHints(hints: string): void {
    this.data = { ...this.data, hints };
    this._render();
  }

  setVimMode(mode: VimModeValue): void {
    this.vimMode = mode;
    this._render();
    this.screen.render();
  }

  startTimer(): void {
    this.startedAt = Date.now();
    this.intervalId = setInterval(() => {
      this._render();
      this.screen.render();
    }, 1000);
  }

  stopTimer(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  destroy(): void {
    this.stopTimer();
  }

  private _elapsed(): string {
    if (this.startedAt === null) return '0m 0s';
    const totalSecs = Math.floor((Date.now() - this.startedAt) / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m}m ${s}s`;
  }

  private _render(): void {
    const { state, agent, hints } = this.data;
    const modeTag = this.vimMode === 'INSERT' ? '-- INSERT --' : '-- NORMAL --';
    const leftRaw = ` ${modeTag} [${state}] | elapsed: ${this._elapsed()}${agent ? ` | agent: ${agent}` : ''}`;
    const themeSuffix = `^T:theme(${getThemeLabel()})`;
    const right = hints ? ` ${hints}  ${themeSuffix} ` : ` ${themeSuffix} `;

    const totalWidth = (this.screen.width as number) || 80;
    const left = truncateText(leftRaw, Math.max(0, totalWidth - right.length));
    const gap = Math.max(0, totalWidth - left.length - right.length);
    this.box.setContent(left + ' '.repeat(gap) + right);
  }
}
