import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import { getTheme, fgTag } from '../theme.js';

export interface ChatInputData {
  placeholder?: string;
  prefix?: string;
}

export function createChatInput(
  parent: blessed.Widgets.Node,
  onSubmit: (value: string) => void,
): WidgetController<ChatInputData> {
  const container = blessed.box({
    parent,
    height: 1,
    shrink: true,
  }) as blessed.Widgets.BoxElement;

  const prefixBox = blessed.box({
    parent: container,
    tags: true,
    width: 'shrink',
    height: 1,
    left: 0,
    top: 0,
    content: `${fgTag(getTheme().colors.accent)}>{/} `,
  });

  const input = blessed.textbox({
    parent: container,
    height: 1,
    left: 2,
    top: 0,
    inputOnFocus: true,
    keys: true,
    mouse: false,
    style: {
      fg: getTheme().colors.inputFg,
      focus: {
        fg: getTheme().colors.inputFg,
      },
    },
  }) as blessed.Widgets.TextboxElement;

  // Submit on Enter only when focused
  input.key(['enter'], () => {
    const value = input.getValue().trim();
    if (value) {
      onSubmit(value);
    }
  });

  function update(data: ChatInputData): void {
    const theme = getTheme();
    container.style = {
      ...(container.style ?? {}),
      fg: theme.colors.panelFg,
      bg: theme.colors.panelBg,
    };
    prefixBox.setContent(`${fgTag(theme.colors.accent)}${data.prefix ?? '>'}{/} `);
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
    const prefix = data.prefix ?? '>';
    const prefixLen = prefix.length + 1;
    (input as blessed.Widgets.TextboxElement & { left: number }).left = prefixLen;

    if (data.placeholder) {
      // blessed textbox doesn't natively support placeholder; show it when empty
      const currentVal = input.getValue();
      if (!currentVal) {
        input.setContent(`{#555555-fg}${data.placeholder}{/}`);
      }
    }
    input.screen?.render();
  }

  return {
    element: container,
    update,
    destroy: () => container.destroy(),
  };
}
