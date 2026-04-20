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
const handleEvidenceCommandMock = vi.fn(async () => {});
const writePdfArtifactMock = vi.fn(async () => ({
  pdfPath: '/tmp/map-result.pdf',
  htmlPath: '/tmp/map-result.html',
  renderer: 'chrome',
}));
const writeHtmlArtifactMock = vi.fn(async () => ({
  htmlPath: '/tmp/map-result.html',
}));
const writeGraphPngArtifactsMock = vi.fn(async () => ({
  manifestPath: '/tmp/out/agent-graph-manifest.json',
  artifacts: [
    { id: 'agent-network-auto', src: 'agent-network-auto.png', path: '/tmp/out/agent-network-auto.png' },
    { id: 'agent-network-stage', src: 'agent-network-stage.png', path: '/tmp/out/agent-network-stage.png' },
  ],
  warnings: [],
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

vi.mock('../src/cli/evidence-commands.js', () => ({
  handleEvidenceCommand: handleEvidenceCommandMock,
}));

vi.mock('../src/output/pdf-artifact.js', () => ({
  openOutputArtifact: openOutputArtifactMock,
  writeHtmlArtifact: writeHtmlArtifactMock,
  writeGraphPngArtifacts: writeGraphPngArtifactsMock,
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
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
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

  it('runs evidence audit subcommand', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(runCli(['evidence', 'audit', 'output'])).rejects.toThrow('process.exit:0');

    expect(handleEvidenceCommandMock).toHaveBeenCalledWith(['audit', 'output']);
    expect(runHeadlessV2Mock).not.toHaveBeenCalled();
  });

  it('runs refine subcommand through smart routing when --run is provided', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(runCli(['refine', '--run', 'Build something useful'])).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('Original request'),
    }));
  });

  it('passes cross-review overrides through refine --run smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        'refine',
        '--run',
        '--disable-cross-review',
        '--cross-review-max-rounds',
        '4',
        '--cross-review-judge-models',
        'ollama/gemma4:26b,ollama/qwen3.6',
        'Build something useful with enough detail',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      crossReviewEnabled: false,
      crossReviewMaxRounds: 4,
      crossReviewJudgeModels: ['ollama/gemma4:26b', 'ollama/qwen3.6'],
    }));
    expect(runHeadlessV2Mock.mock.calls[0]?.[0].prompt).not.toContain('ollama/gemma4:26b');
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
      dagLayout: 'auto',
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
      dagLayout: 'auto',
    });
    expect(openOutputArtifactMock).toHaveBeenCalledWith('/tmp/map-result.html');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('HTML report written to /tmp/map-result.html'));
  });

  it('opens a companion HTML artifact when --open-output is used with default JSON output', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--open-output', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writeHtmlArtifactMock).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/tmp/out' }), {
      compact: false,
      outputDir: '/tmp/out',
      dagLayout: 'auto',
    });
    expect(openOutputArtifactMock).toHaveBeenCalledWith('/tmp/map-result.html');
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
  });


  it('reports the output directory on stderr after a normal headless run', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
    expect(stderrWriteSpy).toHaveBeenCalledWith(expect.stringContaining('Output directory: /tmp/out'));
  });

  it('keeps silent headless JSON output free of extra stderr chatter', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--silent', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"success": true'));
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it('suppresses artifact path chatter for silent PDF runs', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--silent', '--output-format', 'pdf', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writePdfArtifactMock).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });


  it('passes forced dag layout to html artifact output', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outcome: 'success',
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--output-format', 'html', '--open-output', '--dag-layout', 'metro', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writeHtmlArtifactMock).toHaveBeenCalledWith(expect.objectContaining({ outputDir: '/tmp/out' }), {
      compact: false,
      outputDir: '/tmp/out',
      dagLayout: 'metro',
    });
  });

  it('prints an error for unsupported dag layout values', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--dag-layout', 'radial', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:1');

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('--dag-layout must be one of'));
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
      agentGraph: [
        'Stage 1 (sequence):',
        '- step-1 [researcher] completed',
        'Stage 2 (sequence):',
        '- step-2 [writer] completed | inputs: step-1',
        'Connections:',
        '- step-1 -> step-2 (planned)',
      ],
      finalResult: 'Final answer',
    });
  });

  it('generates graph PNG artifacts when --graph is requested', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outcome: 'success',
      outputDir: '/tmp/out',
      dag: {
        nodes: [
          { id: 'step-1', agent: 'researcher', status: 'completed', duration: 1 },
          { id: 'step-2', agent: 'writer', status: 'completed', duration: 1 },
        ],
        edges: [{ from: 'step-1', to: 'step-2', type: 'planned' }],
      },
      steps: [
        { id: 'step-1', agent: 'researcher', task: 'Research', status: 'completed', output: 'Research' },
        { id: 'step-2', agent: 'writer', task: 'Write', status: 'completed', output: 'Final' },
      ],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli(['--headless', '--graph', 'Build a tested Node CLI with docs and error handling']),
    ).rejects.toThrow('process.exit:0');

    expect(writeGraphPngArtifactsMock).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: '/tmp/out' }),
      { outputDir: '/tmp/out' },
    );
    const parsed = JSON.parse(String(stdoutSpy.mock.calls.at(-1)?.[0] ?? '{}'));
    expect(parsed.graphArtifacts.map((artifact: { id: string }) => artifact.id)).toEqual([
      'agent-network-auto',
      'agent-network-stage',
    ]);
    expect(parsed.graphArtifactManifestPath).toBe('/tmp/out/agent-graph-manifest.json');
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
        rerunPrompt: 'Use this for the next implementation pass',
        initialSpec: '# Loaded Spec\n\nBuild the thing from this spec.',
        specFilePath: expect.stringContaining('docs/spec.md'),
      }),
    );
    expect(runHeadlessV2Mock.mock.calls[0]?.[0].prompt).toContain('Use this for the next implementation pass');
    expect(runHeadlessMock).not.toHaveBeenCalled();
  });

  it('passes workspace directory to headless smart routing without treating it as prompt text', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--workspace-dir',
        '/tmp/existing-platform',
        '--output-dir',
        '/tmp/map-report',
        'Add billing subscriptions invoices and account settings to the existing app',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Add billing subscriptions invoices and account settings to the existing app',
        outputDir: '/tmp/map-report',
        workspaceDir: '/tmp/existing-platform',
      }),
    );
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

  it('supports the real-world classification/taxonomy PDF graph command shape', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/out',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const prompt = 'please provide a classification and taxonomy report for cocaine as well as usages for it on the medical and metabolomics field. Keep this short and assume this will presented to a customer inside a handful of XLS cells. Ensure that correctness is judged fairly and only report the output tables and the graph plot. Nothing else';
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--v2',
        '--router-timeout',
        '5m',
        '--output-format',
        'pdf',
        '--open-output',
        '--verbose',
        '--graph',
        prompt,
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      prompt,
      routerTimeoutMs: 5 * 60 * 1000,
      verbose: true,
    }));
    expect(writeGraphPngArtifactsMock).toHaveBeenCalled();
    expect(writePdfArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({ graphArtifacts: expect.any(Array) }),
      expect.objectContaining({ outputDir: '/tmp/out', dagLayout: 'auto' }),
    );
  });


  it('refines then runs headless smart routing without leaking execution flags into the prompt', async () => {
    runHeadlessV2Mock.mockResolvedValueOnce({
      version: 2,
      success: true,
      outputDir: '/tmp/pubchem',
      dag: { nodes: [], edges: [] },
      steps: [],
    });
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--v2',
        '--router-timeout',
        '5m',
        '--output-format',
        'pdf',
        '--open-output',
        '--verbose',
        '--graph',
        'Build a PubChem sync tool with markdown conversion',
        '--refine',
        '--ouputDir',
        'pubchem',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      outputDir: 'pubchem',
      routerTimeoutMs: 5 * 60 * 1000,
      verbose: true,
      prompt: expect.stringContaining('Build a PubChem sync tool with markdown conversion'),
    }));
    const refinedPrompt = String(runHeadlessV2Mock.mock.calls[0]?.[0].prompt ?? '');
    expect(refinedPrompt).toContain('Original request');
    expect(refinedPrompt).not.toContain('5m pdf');
    expect(refinedPrompt).not.toContain('pubchem Build');
    expect(writeGraphPngArtifactsMock).toHaveBeenCalled();
    expect(writePdfArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({ outputDir: '/tmp/pubchem' }),
      expect.objectContaining({ outputDir: '/tmp/pubchem' }),
    );
    expect(openOutputArtifactMock).toHaveBeenCalledWith('/tmp/map-result.pdf');
  });

  it('passes disabled agent overrides to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--disable-agent',
        'output-formatter,researcher',
        '--disable-agents',
        'grammar-spelling-specialist',
        'Research the task and produce a concise implementation readiness plan',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Research the task and produce a concise implementation readiness plan',
        disabledAgents: ['output-formatter', 'researcher', 'grammar-spelling-specialist'],
      }),
    );
  });

  it('passes agent comparison and semantic judge flags to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--compare-agents',
        'researcher,writer',
        '--semantic-judge',
        'Research the task and produce a concise implementation readiness plan',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Research the task and produce a concise implementation readiness plan',
        compareAgents: ['researcher', 'writer'],
        semanticJudge: true,
      }),
    );
  });

  it('passes LLM judge panel options to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--judge-panel-models',
        'ollama/gemma4:26b,claude/sonnet,codex/gpt-5',
        '--judge-panel-roles',
        'evidence-skeptic,recency-auditor,contradiction-finder',
        '--judge-panel-steer',
        '--judge-panel-max-rounds',
        '2',
        'Research the task and produce a concise implementation readiness plan',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Research the task and produce a concise implementation readiness plan',
        judgePanelModels: ['ollama/gemma4:26b', 'claude/sonnet', 'codex/gpt-5'],
        judgePanelRoles: ['evidence-skeptic', 'recency-auditor', 'contradiction-finder'],
        judgePanelSteer: true,
        judgePanelMaxSteeringRounds: 2,
      }),
    );
  });

  it('passes cross-review overrides to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--disable-cross-review',
        '--cross-review-max-rounds',
        '4',
        '--cross-review-judge-models',
        'ollama/gemma4:26b,ollama/qwen3.6',
        'Implement autonomous cross review with enough detail for the validation gate',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      crossReviewEnabled: false,
      crossReviewMaxRounds: 4,
      crossReviewJudgeModels: ['ollama/gemma4:26b', 'ollama/qwen3.6'],
    }));
  });

  it('passes Ollama server overrides to headless smart routing', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await expect(
      runCli([
        '--headless',
        '--ollama-host',
        'http://127.0.0.1:11435',
        '--ollama-context-length',
        '64000',
        '--ollama-num-parallel',
        '4',
        '--ollama-max-loaded-models',
        '3',
        'Research the task and produce a concise implementation readiness plan',
      ]),
    ).rejects.toThrow('process.exit:0');

    expect(runHeadlessV2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        ollama: {
          host: 'http://127.0.0.1:11435',
          contextLength: 64000,
          numParallel: 4,
          maxLoadedModels: 3,
        },
      }),
    );
  });

  it('applies Ollama server overrides before launching the TUI', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await runCli([
      '--ollama-host',
      'http://127.0.0.1:11435',
      '--ollama-context-length',
      '64000',
      '--ollama-num-parallel',
      '4',
      '--ollama-max-loaded-models',
      '3',
    ]);

    expect(detectAllAdaptersMock).toHaveBeenCalledWith('http://127.0.0.1:11435');
    expect(createTuiAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          ollama: {
            host: 'http://127.0.0.1:11435',
            contextLength: 64000,
            numParallel: 4,
            maxLoadedModels: 3,
          },
        }),
      }),
    );
  });

  it('applies disabled agent overrides before launching the TUI', async () => {
    const { runCli } = await import('../src/cli-runner.js');

    await runCli(['--disable-agent', 'researcher']);

    expect(createTuiAppMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          agentOverrides: expect.objectContaining({
            researcher: expect.objectContaining({ enabled: false }),
          }),
        }),
      }),
    );
  });
});
