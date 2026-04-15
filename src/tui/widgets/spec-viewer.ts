import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme } from '../theme.js';
import { renderModelOutput } from '../output-renderer.js';

export interface SpecViewerData {
  content: string;
}

export function createSpecViewer(parent: blessed.Widgets.Node): WidgetController<SpecViewerData> {
  const element = blessed.box({
    parent,
    tags: true,
    left: 0,
    right: 0,
    width: '100%',
    wrap: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: '│',
      style: { fg: getTheme().colors.accent },
      track: { bg: getTheme().colors.scrollbarTrack },
    },
    style: {
      fg: getTheme().colors.panelFg,
      bg: getTheme().colors.panelBg,
    },
  });

  function update(data: SpecViewerData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const rendered = renderModelOutput(data.content);
    element.setContent(rendered);
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
