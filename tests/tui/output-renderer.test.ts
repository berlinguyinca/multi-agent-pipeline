import { describe, expect, it } from 'vitest';
import blessed from 'neo-blessed';
import { createTestScreen, createParentBox, getBoxContent } from './helpers/blessed-harness.js';
import { renderModelOutput } from '../../src/tui/output-renderer.js';

describe('renderModelOutput', () => {
  it('pretty prints json responses', () => {
    const screen = createTestScreen();
    const parent = createParentBox(screen);
    const box = blessed.box({ parent, tags: true, wrap: true }) as blessed.Widgets.BoxElement;

    box.setContent(renderModelOutput('{"name":"demo","items":[1,2]}'));

    const content = getBoxContent(box);
    expect(content).toContain('"name": "demo"');
    expect(content).toContain('\n');
    expect(content).not.toContain('{"name":"demo","items":[1,2]}');

    screen.destroy();
  });

  it('renders markdown headings without raw hash prefixes', () => {
    const screen = createTestScreen();
    const parent = createParentBox(screen);
    const box = blessed.box({ parent, tags: true, wrap: true }) as blessed.Widgets.BoxElement;

    box.setContent(renderModelOutput('# My Feature\n\n- bullet item\n\n```ts\nconst x = 1;\n```'));

    const content = getBoxContent(box);
    expect(content).toContain('My Feature');
    expect(content).toContain('bullet item');
    expect(content).toContain('const x = 1;');
    expect(content).not.toContain('# My Feature');

    screen.destroy();
  });

  it('escapes literal tag-like text from the model', () => {
    const screen = createTestScreen();
    const parent = createParentBox(screen);
    const box = blessed.box({ parent, tags: true, wrap: true }) as blessed.Widgets.BoxElement;

    box.setContent(renderModelOutput('Use {bold}literal tags{/bold} in text.'));

    expect(getBoxContent(box)).toContain('{bold}literal tags{/bold}');

    screen.destroy();
  });
});
