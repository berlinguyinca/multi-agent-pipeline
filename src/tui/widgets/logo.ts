import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

const ASCII_ART = [
  ' ███╗   ███╗ █████╗ ██████╗',
  ' ████╗ ████║██╔══██╗██╔══██╗',
  ' ██╔████╔██║███████║██████╔╝',
  ' ██║╚██╔╝██║██╔══██║██╔═══╝',
  ' ██║ ╚═╝ ██║██║  ██║██║',
  ' ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝',
].join('\n');

const TAGLINE = 'Multi-Agent Pipeline — iterative spec-refinement for one-shot TDD';

export function createLogo(parent: blessed.Widgets.Node): WidgetController<void> {
  const element = blessed.box({
    parent,
    tags: true,
    content: '',
    align: 'center',
    height: 8,
    shrink: true,
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
      `${fgTag(theme.colors.accent)}${ASCII_ART}{/}\n${fgTag(theme.colors.muted)}${TAGLINE}{/}`,
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
