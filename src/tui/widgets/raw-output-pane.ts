import blessed from 'neo-blessed';
import type { WidgetController } from './types.js';
import type { RawOutputStore, RawOutputEntry } from '../raw-output-store.js';
import { getTheme } from '../theme.js';
import { normalizeTerminalText } from '../../utils/terminal-text.js';

type ScrollableBox = blessed.Widgets.BoxElement & {
  getScrollHeight(): number;
  getScroll(): number;
  scrollTo(pos: number): void;
  scroll(offset: number): void;
  setScrollPerc(perc: number): void;
};

function isAtBottom(element: ScrollableBox): boolean {
  const innerHeight = Math.max(0, (element.height as number) - 2);
  const scrollHeight = element.getScrollHeight?.() ?? 0;
  const currentScroll = element.getScroll?.() ?? 0;
  return currentScroll + innerHeight >= scrollHeight - 1;
}

function renderEntry(element: ScrollableBox, entry: RawOutputEntry | null): void {
  if (!entry) {
    element.setContent('');
    element.setScroll(0);
    element.screen?.render();
    return;
  }

  const header = `Raw Output — ${entry.title}${entry.streaming ? ' (streaming)' : ''}`;
  const separator = '─'.repeat(Math.max(0, header.length));
  element.setContent(`${header}\n${separator}\n${normalizeTerminalText(entry.content)}`);

  if (entry.autoScroll) {
    element.setScroll(0);
  } else {
    element.scrollTo(Math.max(0, entry.scroll));
  }

  element.screen?.render();
}

export function createRawOutputPane(
  parent: blessed.Widgets.Node,
  store: RawOutputStore,
): WidgetController<void> {
  const element = blessed.box({
    parent,
    tags: false,
    border: 'line',
    label: ' Raw Output ',
    left: 0,
    right: 0,
    width: '100%',
    wrap: true,
    scrollable: true,
    alwaysScroll: true,
    mouse: true,
    keys: true,
    vi: true,
    style: {
      border: {
        fg: getTheme().colors.border,
      },
    },
    scrollbar: {
      ch: '│',
      style: { fg: getTheme().colors.accent },
      track: {
        bg: getTheme().colors.scrollbarTrack,
      },
    },
  }) as ScrollableBox;

  let unsubscribe = () => {};

  element.on('scroll', () => {
    const entry = store.getCurrent();
    if (!entry) return;
    store.setScroll(entry.key, element.getScroll?.() ?? 0, isAtBottom(element));
  });

  function update(): void {
    renderEntry(element, store.getCurrent());
  }

  unsubscribe = store.subscribe(update);
  update();

  return {
    element: element as blessed.Widgets.BoxElement,
    update,
    destroy: () => {
      unsubscribe();
      element.destroy();
    },
  };
}
