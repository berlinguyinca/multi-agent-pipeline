import blessed from 'neo-blessed';
import type { BaseScreen } from './screens/base-screen.js';

export class ScreenRouter {
  private parent: blessed.Widgets.BoxElement;
  private screens: Map<string, BaseScreen>;
  private currentStateValue: string | null = null;
  private currentScreen: BaseScreen | null = null;

  constructor(parent: blessed.Widgets.BoxElement, screens: Map<string, BaseScreen>) {
    this.parent = parent;
    this.screens = screens;
  }

  transition(stateValue: string): void {
    if (stateValue === this.currentStateValue) return;

    if (this.currentScreen) {
      this.currentScreen.deactivate();
    }

    const next = this.screens.get(stateValue);
    if (next) {
      this.currentStateValue = stateValue;
      this.currentScreen = next;
      next.activate();
      this.parent.screen?.render();
    }
  }

  current(): BaseScreen | null {
    return this.currentScreen;
  }
}
