export type VimModeValue = 'NORMAL' | 'INSERT';

export class VimMode {
  private mode: VimModeValue = 'NORMAL';
  private listeners: Array<(mode: VimModeValue) => void> = [];

  get(): VimModeValue {
    return this.mode;
  }

  set(mode: VimModeValue): void {
    if (this.mode === mode) return;
    this.mode = mode;
    for (const fn of this.listeners) fn(mode);
  }

  onModeChange(fn: (mode: VimModeValue) => void): void {
    this.listeners.push(fn);
  }

  isNormal(): boolean {
    return this.mode === 'NORMAL';
  }

  isInsert(): boolean {
    return this.mode === 'INSERT';
  }

  toNormal(): void {
    this.set('NORMAL');
  }

  toInsert(): void {
    this.set('INSERT');
  }
}
