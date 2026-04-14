import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import CompleteScreen from '../../../src/tui/screens/CompleteScreen.js';

describe('CompleteScreen', () => {
  it('renders without errors', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={3}
        testsTotal={10}
        testsPassing={10}
        filesCreated={['src/foo.ts', 'src/bar.ts']}
        duration={12500}
        outputDir="./output"
        onNewPipeline={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });

  it('shows iterations count', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={3}
        testsTotal={10}
        testsPassing={10}
        filesCreated={[]}
        duration={5000}
        outputDir="./output"
        onNewPipeline={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3');
  });

  it('shows test counts', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={1}
        testsTotal={20}
        testsPassing={18}
        filesCreated={[]}
        duration={3000}
        outputDir="./output"
        onNewPipeline={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('18');
    expect(frame).toContain('20');
  });

  it('shows output directory', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={1}
        testsTotal={5}
        testsPassing={5}
        filesCreated={[]}
        duration={1000}
        outputDir="./my-project"
        onNewPipeline={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('./my-project');
  });

  it('shows files created', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={1}
        testsTotal={5}
        testsPassing={5}
        filesCreated={['src/feature.ts', 'tests/feature.test.ts']}
        duration={1000}
        outputDir="./output"
        onNewPipeline={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('src/feature.ts');
  });

  it('shows documentation updates', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={1}
        testsTotal={5}
        testsPassing={5}
        filesCreated={[]}
        duration={1000}
        outputDir="./output"
        documentationResult={{
          filesUpdated: ['README.md', 'docs/usage.md'],
          outputDir: './output',
          duration: 300,
          rawOutput: 'updated docs',
        }}
        onNewPipeline={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Documentation updated');
    expect(frame).toContain('README.md');
  });

  it('renders with zero tests', () => {
    const { lastFrame } = render(
      <CompleteScreen
        iterations={1}
        testsTotal={0}
        testsPassing={0}
        filesCreated={[]}
        duration={500}
        outputDir="./output"
        onNewPipeline={vi.fn()}
      />
    );
    expect(lastFrame()).toBeTruthy();
  });
});
