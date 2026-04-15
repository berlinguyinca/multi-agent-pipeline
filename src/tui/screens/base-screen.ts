import blessed from 'neo-blessed';

export abstract class BaseScreen {
  protected parent: blessed.Widgets.BoxElement;
  protected widgets: Array<{ destroy(): void }> = [];

  constructor(parent: blessed.Widgets.BoxElement) {
    this.parent = parent;
  }

  abstract activate(): void;

  refresh(): void {
    this.deactivate();
    this.activate();
  }

  refreshTheme(): void {
    this.parent.screen?.render();
  }

  deactivate(): void {
    for (const w of this.widgets) {
      w.destroy();
    }
    this.widgets = [];
  }

  resize(): void {
    this.parent.screen?.render();
  }
}
