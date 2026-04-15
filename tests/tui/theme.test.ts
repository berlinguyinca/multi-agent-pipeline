import { afterEach, describe, expect, it } from 'vitest';
import { fgTag, getTheme, getThemeName, setTheme, toggleTheme } from '../../src/tui/theme.js';

afterEach(() => {
  setTheme('light');
});

describe('theme', () => {
  it('defaults to a known theme', () => {
    expect(getThemeName()).toMatch(/^(light|dark)$/);
    expect(getTheme()).toHaveProperty('colors');
  });

  it('toggles between light and dark', () => {
    setTheme('light');
    expect(getThemeName()).toBe('light');
    toggleTheme();
    expect(getThemeName()).toBe('dark');
    toggleTheme();
    expect(getThemeName()).toBe('light');
  });

  it('formats foreground tags', () => {
    expect(fgTag('#123456')).toBe('{#123456-fg}');
  });
});
