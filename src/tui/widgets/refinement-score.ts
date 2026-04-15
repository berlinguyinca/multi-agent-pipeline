import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface RefinementScoreData {
  scores: Array<{ iteration: number; score: number }>;
}

const BAR_WIDTH = 20;
const FILLED = '█';
const EMPTY = '░';

function normalizeScore(score: number): number {
  const n = score > 1 ? score / 100 : score;
  return Math.min(Math.max(n, 0), 1);
}

function renderBar(score: number): string {
  const normalized = normalizeScore(score);
  const filled = Math.round(normalized * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return FILLED.repeat(filled) + EMPTY.repeat(empty);
}

export function createRefinementScore(parent: blessed.Widgets.Node): WidgetController<RefinementScoreData> {
  const element = blessed.box({
    parent,
    tags: true,
    shrink: true,
  });

  function update(data: RefinementScoreData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    if (data.scores.length === 0) {
      element.setContent(`${fgTag(theme.colors.muted)}No scores yet{/}`);
      element.screen?.render();
      return;
    }

    const lastIdx = data.scores.length - 1;
    const lines = data.scores.map((entry, i) => {
      const isLast = i === lastIdx;
      const bar = renderBar(entry.score);
      const pct = Math.round(normalizeScore(entry.score) * 100);
      const arrow = isLast ? ' {#ff8700-fg}◄{/}' : '';
      const barTag = isLast ? `{#d75f00-fg}${bar}{/}` : `${fgTag(theme.colors.muted)}${bar}{/}`;
      return `${fgTag(theme.colors.muted)}#${entry.iteration}{/} ${barTag} {bold}${pct}%{/bold}${arrow}`;
    });

    element.setContent(lines.join('\n'));
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
