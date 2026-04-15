export type ThemeName = 'light' | 'dark';

export interface ThemeColors {
  screenBg: string;
  screenFg: string;
  panelBg: string;
  panelFg: string;
  border: string;
  accent: string;
  accentSoft: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
  mutedSoft: string;
  selectionBg: string;
  selectionFg: string;
  scrollbarTrack: string;
  inputBg: string;
  inputFg: string;
  inverseBg: string;
  inverseFg: string;
}

export interface Theme {
  name: ThemeName;
  label: string;
  colors: ThemeColors;
}

const THEMES: Record<ThemeName, Theme> = {
  light: {
    name: 'light',
    label: 'Light',
    colors: {
      screenBg: '#fbfaf7',
      screenFg: '#1f1f1f',
      panelBg: '#fffdf9',
      panelFg: '#1f1f1f',
      border: '#d8d1c7',
      accent: '#b85b10',
      accentSoft: '#d68a47',
      success: '#2f855a',
      warning: '#a16207',
      danger: '#c53030',
      muted: '#6b6258',
      mutedSoft: '#8b8277',
      selectionBg: '#eadfce',
      selectionFg: '#1f1f1f',
      scrollbarTrack: '#ece4d8',
      inputBg: '#fffaf0',
      inputFg: '#1f1f1f',
      inverseBg: '#1f1f1f',
      inverseFg: '#fbfaf7',
    },
  },
  dark: {
    name: 'dark',
    label: 'Dark',
    colors: {
      screenBg: '#111111',
      screenFg: '#f3f3f3',
      panelBg: '#1a1a1a',
      panelFg: '#f3f3f3',
      border: '#333333',
      accent: '#d75f00',
      accentSoft: '#ffb347',
      success: '#3fb950',
      warning: '#ff8700',
      danger: '#ff6b6b',
      muted: '#888888',
      mutedSoft: '#a0a0a0',
      selectionBg: '#2a2a2a',
      selectionFg: '#f3f3f3',
      scrollbarTrack: '#1a1a1a',
      inputBg: '#161616',
      inputFg: '#f3f3f3',
      inverseBg: '#f3f3f3',
      inverseFg: '#111111',
    },
  },
};

function parseThemeName(value: string | undefined): ThemeName | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'light' || normalized === 'dark') {
    return normalized;
  }
  return null;
}

function detectInitialTheme(): ThemeName {
  return parseThemeName(process.env.MAP_THEME) ?? 'light';
}

let currentThemeName: ThemeName = detectInitialTheme();

export function getTheme(): Theme {
  return THEMES[currentThemeName];
}

export function getThemeName(): ThemeName {
  return currentThemeName;
}

export function setTheme(name: ThemeName): Theme {
  currentThemeName = name;
  return getTheme();
}

export function toggleTheme(): Theme {
  currentThemeName = currentThemeName === 'light' ? 'dark' : 'light';
  return getTheme();
}

export function isThemeName(value: string): value is ThemeName {
  return value === 'light' || value === 'dark';
}

export function getThemeLabel(): string {
  return getTheme().label;
}

export function fgTag(color: string): string {
  return `{${color}-fg}`;
}

