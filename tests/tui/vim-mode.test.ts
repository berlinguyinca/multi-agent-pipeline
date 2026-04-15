import { describe, it, expect, vi as vitest } from 'vitest';
import { VimMode } from '../../src/tui/vim-mode.js';

describe('VimMode', () => {
  it('starts in NORMAL mode', () => {
    const vm = new VimMode();
    expect(vm.get()).toBe('NORMAL');
    expect(vm.isNormal()).toBe(true);
    expect(vm.isInsert()).toBe(false);
  });

  it('switches to INSERT mode', () => {
    const vm = new VimMode();
    vm.toInsert();
    expect(vm.get()).toBe('INSERT');
    expect(vm.isInsert()).toBe(true);
    expect(vm.isNormal()).toBe(false);
  });

  it('switches back to NORMAL mode', () => {
    const vm = new VimMode();
    vm.toInsert();
    vm.toNormal();
    expect(vm.get()).toBe('NORMAL');
    expect(vm.isNormal()).toBe(true);
  });

  it('fires listener on mode change', () => {
    const vm = new VimMode();
    const listener = vitest.fn();
    vm.onModeChange(listener);
    vm.toInsert();
    expect(listener).toHaveBeenCalledWith('INSERT');
    vm.toNormal();
    expect(listener).toHaveBeenCalledWith('NORMAL');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not fire listener when mode is unchanged', () => {
    const vm = new VimMode();
    const listener = vitest.fn();
    vm.onModeChange(listener);
    vm.toNormal(); // already NORMAL
    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners', () => {
    const vm = new VimMode();
    const a = vitest.fn();
    const b = vitest.fn();
    vm.onModeChange(a);
    vm.onModeChange(b);
    vm.toInsert();
    expect(a).toHaveBeenCalledWith('INSERT');
    expect(b).toHaveBeenCalledWith('INSERT');
  });

  it('set() works the same as toInsert/toNormal', () => {
    const vm = new VimMode();
    vm.set('INSERT');
    expect(vm.get()).toBe('INSERT');
    vm.set('NORMAL');
    expect(vm.get()).toBe('NORMAL');
  });
});
