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
const runPRReviewMock = vi.fn(async () => ({ success: true, verdict: 'comment' }));
const writePdfArtifactMock = vi.fn(async () => ({
  pdfPath: '/tmp/map-result.pdf',
  htmlPath: '/tmp/map-result.html',
  renderer: 'chrome',
}));
const writeHtmlArtifactMock = vi.fn(async () => ({
  htmlPath: '/tmp/map-result.html',
}));
const openOutputArtifactMock = vi.fn(async () => {});

vi.mock('../src/tui/tui-app.js', () => ({
  createTuiApp: createTuiAppMock,
}));

vi.mock('../src/headless/runner.js', () => ({
  runHeadless: runHeadlessMock,
  runHeadlessV2: runHeadlessV2Mock,
}));

vi.mock('../src/headless/pr-review.js', () => ({
  runPRReview: runPRReviewMock,
}));

vi.mock('../src/output/pdf-artifact.js', () => ({
  openOutputArtifact: openOutputArtifactMock,
  writeHtmlArtifact: writeHtmlArtifactMock,
  writePdfArtifact: writePdfArtifactMock,
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

  it('pretty-prints default headless smart routing JSON to stdout', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith('{\n  "version": 2,\n  "success": true\n}\n');
  });

  it('prints headless smart routing output as Markdown when requested', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'markdown', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('# MAP Result\n'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('- Version: 2\n'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('- Success: true\n'));
  });

  it('prints headless smart routing output as YAML when requested', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'yaml', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('version: 2\n'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('success: true\n'));
  });



  it('prints html headless output when requested', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outcome: 'success',
      dag: { nodes: [], edges: [] },
      steps: [{ id: 'step-1', agent: 'writer', task: 'Write', status: 'completed', output: 'Final answer' }],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'html', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    const output = String(stdoutSpy.mock.calls.at(-1)?.[0] ?? '');
    expect(output).toContain('<!doctype html>');
    expect(output).toContain('<h2>Final Result</h2>');
  });

  it('writes a PDF artifact when requested', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'pdf', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writePdfArtifactMock).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/tmp/out' }), {
      compact: false,
      outputDir: '/tmp/out',
    });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PDF written to /tmp/map-result.pdf'));
  });

  it('opens generated PDF output when --open-output is provided', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'pdf', '--open-output', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(openOutputArtifactMock).toHaveBeenCalledWith('/tmp/map-result.pdf');
  });

  it('writes and opens generated HTML output when --open-output is provided', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'html', '--open-output', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writeHtmlArtifactMock).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/tmp/out' }), {
      compact: false,
      outputDir: '/tmp/out',
    });
    expect(openOutputArtifactMock).toHaveBeenCalledWith('/tmp/map-result.html');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('HTML report written to /tmp/map-result.html'));
  });

  it('prints compact json when --compact is combined with default output format', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outcome: 'success',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'writer', status: 'completed', duration: 1 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Raw research' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final answer' },
      ],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--compact', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    const parsed = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0] ?? '{}'));
    expect(parsed).toEqual({
      success: true,
      outcome: 'success',
      agentGraph: ['step-1 [researcher] -> step-2 [writer]'],
      finalResult: 'Final answer',
    });
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

  it('pretty-prints classic headless JSON to stdout', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--classic', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith('{\n  "version": 1,\n  "success": true\n}\n');
  });

  it('prints classic headless output using the requested format', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--classic', '--output-format', 'markdown', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('# MAP Result\n'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('- Version: 1\n'));
  });

  it('pretty-prints PR review JSON to stdout', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--review-pr', 'https://github.com/owner/repo/pull/1']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith('{\n  "success": true,\n  "verdict": "comment"\n}\n');
  });

  it('prints PR review output using the requested format', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--review-pr', 'https://github.com/owner/repo/pull/1', '--output-format', 'markdown']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('# MAP Result\n'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('- Success: true\n'));
  });

  it('rejects unsupported output formats', async () => {
    const { runCli } = await import('../src/cli-runner.js');
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      runCli(['--headless', '--output-format', 'xml', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:1');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--output-format must be one of'));
    expect(runHeadlessMock).not.toHaveBeenCalled();
    expect(runHeadlessV2Mock).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
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

  it('passes router model overrides to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--router-model', 'qwen3:latest', 'Research the task and produce a concise implementation readiness plan']),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        routerModel: 'qwen3:latest',
      }),
    );
  });

  it('passes router consensus model overrides to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--router-consensus-models',
        'gemma4:26b,qwen3:latest,llama3.1:8b',
        'Research the task and produce a concise implementation readiness plan',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        routerConsensusModels: ['gemma4:26b', 'qwen3:latest', 'llama3.1:8b'],
      }),
    );
  });
});
