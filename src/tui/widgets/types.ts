import type blessed from 'neo-blessed';

export interface WidgetController<T> {
  element: blessed.Widgets.BoxElement;
  update(data: T): void;
  destroy(): void;
}
