import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface KeyboardHelpData {
  shortcuts: Array<{ key: string; label: string }>;
}

export function createKeyboardHelp(parent: blessed.Widgets.Node): WidgetController<KeyboardHelpData> {
  const element = blessed.box({
    parent,
    tags: true,
    height: 1,
    shrink: true,
  });

  function update(data: KeyboardHelpData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const parts = data.shortcuts.map(
      (s) => `{bold}{inverse} ${s.key} {/inverse}{/bold} ${fgTag(theme.colors.muted)}${s.label}{/}`,
    );
    element.setContent(parts.join('  '));
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
