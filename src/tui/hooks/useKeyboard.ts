import { useInput } from 'ink';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  handler: () => void;
}

export function useKeyboard(shortcuts: Shortcut[]) {
  useInput((input, key) => {
    for (const shortcut of shortcuts) {
      if (shortcut.ctrl && key.ctrl && input === shortcut.key) {
        shortcut.handler();
        return;
      }
      if (!shortcut.ctrl && !shortcut.shift && input === shortcut.key) {
        shortcut.handler();
        return;
      }
    }
  });
}
