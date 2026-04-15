import blessed from 'neo-blessed';

export function createTestScreen(): blessed.Widgets.Screen {
  const screen = blessed.screen({
    smartCSR: true,
    input: process.stdin,
    output: process.stdout,
    fullUnicode: true,
    warnings: false,
  });
  screen.program.cols = 80;
  screen.program.rows = 24;
  return screen;
}

export function simulateKey(
  screen: blessed.Widgets.Screen,
  key: string,
  opts?: { ctrl?: boolean; shift?: boolean },
): void {
  const ctrl = opts?.ctrl ?? false;
  const shift = opts?.shift ?? false;
  const name =
    key === 'C-c' ? 'c'
    : key === 'C-e' ? 'e'
    : key === 'C-y' ? 'y'
    : key;
  const sequence = ctrl ? String.fromCharCode(name.charCodeAt(0) - 96) : key;
  const full = ctrl ? `C-${name}` : shift ? `S-${name}` : key;
  screen.program.emit('keypress', ctrl ? sequence : key, {
    name,
    ctrl,
    meta: false,
    shift,
    sequence,
    full,
  });
}

export function getBoxContent(element: blessed.Widgets.BoxElement): string {
  return element.getContent();
}

export function createParentBox(screen: blessed.Widgets.Screen): blessed.Widgets.BoxElement {
  return blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    tags: true,
  }) as blessed.Widgets.BoxElement;
}
