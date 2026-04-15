import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme } from '../theme.js';

export type BadgeStatus = 'waiting' | 'active' | 'complete' | 'failed';

export interface StatusBadgeData {
  status: BadgeStatus;
  label?: string;
}

const ICONS: Record<BadgeStatus, string> = {
  waiting: '○',
  active: '●',
  complete: '✓',
  failed: '✗',
};

const COLORS: Record<BadgeStatus, string> = {
  waiting: '{#888888-fg}',
  active: '{#ff8700-fg}',
  complete: '{green-fg}',
  failed: '{red-fg}',
};

const CLOSE = '{/}';

export function createStatusBadge(parent: blessed.Widgets.Node): WidgetController<StatusBadgeData> {
  const element = blessed.box({
    parent,
    tags: true,
    shrink: true,
    height: 1,
  });

  function update(data: StatusBadgeData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const color = COLORS[data.status];
    const icon = ICONS[data.status];
    const label = data.label ? ` ${data.label}` : '';
    element.setContent(`${color}${icon}${label}${CLOSE}`);
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
