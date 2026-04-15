import blessed from 'neo-blessed';
import { diffLines } from 'diff';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface SpecDiffData {
  oldContent: string;
  newContent: string;
}

export function createSpecDiff(parent: blessed.Widgets.Node): WidgetController<SpecDiffData> {
  const element = blessed.box({
    parent,
    tags: true,
    left: 0,
    right: 0,
    width: '100%',
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

  function update(data: SpecDiffData): void {
    const theme = getTheme();
    element.style = {
      ...(element.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    const changes = diffLines(data.oldContent, data.newContent);
    const lines: string[] = [];

    for (const change of changes) {
      const rawLines = change.value.split('\n');
      // Remove trailing empty string from split
      if (rawLines[rawLines.length - 1] === '') rawLines.pop();

      if (change.added) {
        for (const line of rawLines) {
          lines.push(`{green-fg}+ ${line}{/}`);
        }
      } else if (change.removed) {
        for (const line of rawLines) {
          lines.push(`{red-fg}- ${line}{/}`);
        }
      } else {
        for (const line of rawLines) {
          if (line.startsWith('@@')) {
            lines.push(`${fgTag(theme.colors.accent)}${line}{/}`);
          } else {
            lines.push(`${fgTag(theme.colors.muted)}  ${line}{/}`);
          }
        }
      }
    }

    element.setContent(lines.join('\n'));
    element.screen?.render();
  }

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => element.destroy(),
  };
}
