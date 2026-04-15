import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';
import { normalizeTerminalText } from '../../utils/terminal-text.js';

export interface SpecViewerData {
  content: string;
}

function renderLine(line: string): string {
  // H1/H2/H3 headers
  if (/^#{1,3} /.test(line)) {
    const text = line.replace(/^#{1,3} /, '');
    return `{bold}${text}{/bold}`;
  }
  // Checkbox checked
  if (/^- \[x\] /i.test(line)) {
    const text = line.replace(/^- \[x\] /i, '');
    const theme = getTheme();
    return `{green-fg}☑{/} ${fgTag(theme.colors.muted)}${text}{/}`;
  }
  // Checkbox unchecked
  if (/^- \[ \] /.test(line)) {
    const text = line.replace(/^- \[ \] /, '');
    return `☐ ${text}`;
  }
  // Bullet list
  if (/^- /.test(line)) {
    const text = line.replace(/^- /, '');
    return `${fgTag(getTheme().colors.muted)}•{/} ${text}`;
  }
  return line;
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
    mouse: false,
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
    const rendered = normalizeTerminalText(data.content)
      .split('\n')
      .map(renderLine)
      .join('\n');
    element.setContent(rendered);
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
