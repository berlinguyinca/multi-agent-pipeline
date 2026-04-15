import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';
import { normalizeTerminalText } from '../../utils/terminal-text.js';

export interface StreamOutputData {
  content: string;
  streaming: boolean;
}

export function createStreamOutput(parent: blessed.Widgets.Node): WidgetController<StreamOutputData> {
  const element = blessed.box({
    parent,
    tags: true,
    left: 0,
    right: 0,
    width: '100%',
    wrap: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: false,
    keys: true,
    vi: true,
    scrollbar: {
      ch: '│',
      style: { fg: getTheme().colors.accent },
      track: {
        bg: getTheme().colors.scrollbarTrack,
      },
    },
    style: {
      scrollbar: {
        fg: getTheme().colors.accent,
      },
      fg: getTheme().colors.panelFg,
      bg: getTheme().colors.panelBg,
    },
  }) as blessed.Widgets.BoxElement & {
    getScrollHeight(): number;
    getScroll(): number;
    scrollTo(pos: number): void;
    scroll(offset: number): void;
  };

  let autoScroll = true;

  // Detect manual scroll up — disengage auto-scroll
  element.on('scroll', () => {
    const scrollHeight = (element as ReturnType<typeof createStreamOutput>['element'] & { getScrollHeight(): number; getScroll(): number }).getScrollHeight?.() ?? 0;
    const currentScroll = (element as ReturnType<typeof createStreamOutput>['element'] & { getScrollHeight(): number; getScroll(): number }).getScroll?.() ?? 0;
    const innerHeight = (element.height as number) - 2;
    const atBottom = currentScroll + innerHeight >= scrollHeight - 1;
    autoScroll = atBottom;
  });

  function update(data: StreamOutputData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const suffix = data.streaming ? `\n${fgTag(theme.colors.accent)}▊{/} ${fgTag(theme.colors.muted)}streaming...{/}` : '';
    element.setContent(`${normalizeTerminalText(data.content)}${suffix}`);

    if (autoScroll) {
      element.setScrollPerc(100);
    }

    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
