import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTuiAppMock = vi.fn(() => ({
  run: vi.fn(async () => {}),
}));
const loadConfigMock = vi.fn(async () => ({
  outputDir: '',
  ollama: { host: 'http://localhost:11434' },
}));
const detectAllAdaptersMock = vi.fn(async () => ({ available: [] }));
const mkdirMock = vi.fn(async () => {});
const readFileMock = vi.fn(async () => '# Loaded Spec\n\nBuild the thing from this spec.');
const runHeadlessMock = vi.fn(async () => ({ version: 1, success: true }));
const runHeadlessV2Mock = vi.fn(async () => ({ version: 2, success: true }));

vi.mock('../src/tui/tui-app.js', () => ({
  createTuiApp: createTuiAppMock,
}));

vi.mock('../src/headless/runner.js', () => ({
  runHeadless: runHeadlessMock,
  runHeadlessV2: runHeadlessV2Mock,
}));

vi.mock('../src/config/loader.js', () => ({
  loadConfig: loadConfigMock,
}));

vi.mock('../src/adapters/detect.js', () => ({
  detectAllAdapters: detectAllAdaptersMock,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: mkdirMock,
    readFile: readFileMock,
  };
});

describe('runCli', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('launches the TUI with no initial prompt when no args are provided', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await runCli([]);

    expect(loadConfigMock).toHaveBeenCalled();
    expect(detectAllAdaptersMock).toHaveBeenCalledWith('http://localhost:11434');
    expect(createTuiAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompt: undefined,
        initialGithubIssueUrl: undefined,
        initialSpec: undefined,
        useV2: true,
      }),
    );
  });

  it('launches the TUI in classic mode when --classic is provided', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await runCli(['--classic', 'Build a tested Node CLI with docs and error handling']);

    expect(createTuiAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        useV2: false,
        initialPrompt: 'Build a tested Node CLI with docs and error handling',
      }),
    );
  });

  it('runs headless smart routing by default', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Build a tested Node CLI with docs and error handling',
      }),
    );
    expect(runHeadlessMock).not.toHaveBeenCalled();
  });

  it('runs headless classic mode when --classic is provided', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--classic', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Build a tested Node CLI with docs and error handling',
      }),
    );
    expect(runHeadlessV2Mock).not.toHaveBeenCalled();
  });

  it('rejects conflicting --classic and --v2 flags', async () => {
    const { runCli } = await import('../src/cli-runner.js');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runCli(['--headless', '--classic', '--v2', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:1');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot combine --classic and --v2'));
    expect(runHeadlessMock).not.toHaveBeenCalled();
    expect(runHeadlessV2Mock).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it('routes --spec-file through v2 by default using an envelope', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--spec-file', 'docs/spec.md', 'Use this for the next implementation pass']),
    ).rejects.toThrow('process.exit:0');

    expect(readFileMock).toHaveBeenCalled();
    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('# Loaded Spec'),
        initialSpec: '# Loaded Spec\n\nBuild the thing from this spec.',
        specFilePath: expect.stringContaining('docs/spec.md'),
      }),
    );
    expect(runHeadlessV2Mock.mock.calls[0]?.[0].prompt).toContain('Use this for the next implementation pass');
    expect(runHeadlessMock).not.toHaveBeenCalled();
  });
});
