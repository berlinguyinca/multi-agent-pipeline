import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { runHeadless } from './headless/runner.js';
import { createTuiApp } from './tui/tui-app.js';
import { loadConfig } from './config/loader.js';
import { DEFAULT_ROUTER_CONSENSUS_CONFIG } from './config/defaults.js';
import { detectAllAdapters } from './adapters/detect.js';
import { parseDuration } from './utils/duration.js';
import { validatePrompt } from './utils/prompt-validation.js';
import { extractFlag, extractPrompt, extractSubcommand, hasFlag } from './cli-args.js';
import { formatMapOutput, parseMapOutputFormat, type MapOutputFormat } from './output/result-format.js';

export async function runCli(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MAP - Multi-Agent Pipeline
One task. One shot. Useful output.

Usage:
  map                    Launch interactive TUI
  map "your idea"        Start with a task or question
  map --resume [id]      Resume a saved pipeline
  map --config <path>    Use custom config file
  map --headless "idea"  Run non-interactively, outputs result to stdout
  map --classic "idea"   Use the classic fixed-stage pipeline
  map --spec-file <path> Start from a local spec file
  map --github-issue <url>
                         Use a GitHub issue as the task prompt and post final report
  map --review-pr <url>  Review a GitHub PR and post findings as a comment

Options:
  --help, -h             Show this help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
  --headless             Run without TUI, print result to stdout
  --classic              Use the classic fixed-stage pipeline
  --spec-file <path>     Use a local spec file as input
  --output-dir <path>    Output directory for generated files and Markdown artifacts
  --output-format <fmt>  Print final result as json, yaml, markdown, html, or text (default: json)
  --compact              Reduce the selected output format to graph plus Final Result
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --router-timeout <dur> Router planning timeout, e.g. 300s
  --router-model <name>  Override the smart-routing router model
  --router-consensus-models <csv>
                         Enable router consensus with up to 3 comma-separated Ollama models
  --github-issue <url>   GitHub issue URL for prompt/reporting (auto-detects from gh CLI)
  --review-pr <url>      Review a GitHub PR and post review comment (auto-detects from gh CLI)
  --personality <text>   Personality/tone injected into all AI prompts
  --verbose, -V          Show detailed progress and stage output on stderr
  --v2                   Deprecated compatibility flag; smart routing is the default

Runtime updates:
  map checks the current checkout branch for newer commits before startup.
  Set MAP_NO_UPDATE=1 to disable the launch-time update check.

Commands:
  map agent list              List all registered agents
  map agent create            Create a new agent (LLM-assisted)
  map agent test <name>       Run an agent smoke test with an optional sample prompt
  map agent edit <name>       Open an agent prompt in $EDITOR
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  if (args.includes('--classic') && args.includes('--v2')) {
    console.error('Error: Cannot combine --classic and --v2. Smart routing is the default; use --classic only for the fixed-stage pipeline.');
    process.exit(1);
  }

  const subcommand = extractSubcommand(args);
  if (subcommand?.command === 'agent') {
    const { handleAgentCommand } = await import('./cli/agent-commands.js');
    await handleAgentCommand(subcommand.subArgs);
    process.exit(0);
  }

  const hasReviewPr = args.includes('--review-pr');
  const reviewPrUrl = extractFlag(args, '--review-pr');
  const outputFormat = resolveOutputFormat(args);
  const compact = hasFlag(args, '--compact');
  if (hasReviewPr && !reviewPrUrl) {
    console.error('Error: --review-pr requires a URL argument (e.g. --review-pr https://github.com/owner/repo/pull/123)');
    process.exit(1);
  }
  if (reviewPrUrl) {
    const { runPRReview } = await import('./headless/pr-review.js');
    const configPath = extractFlag(args, '--config');
    const personality = extractFlag(args, '--personality');
    const result = await runPRReview({ prUrl: reviewPrUrl, configPath, personality });
    writeFormattedResult(result, outputFormat, compact);
    process.exit(result.success ? 0 : 1);
  }

  if (args.includes('--headless')) {
    const useV2 = !args.includes('--classic');
    const verbose = hasFlag(args, '--verbose') || hasFlag(args, '-V');
    const prompt = extractPrompt(args);
    const specFileArg = extractFlag(args, '--spec-file');
    const outputDir = extractFlag(args, '--output-dir');
    const configPath = extractFlag(args, '--config');
    const totalTimeout = extractFlag(args, '--total-timeout');
    const inactivityTimeout = extractFlag(args, '--inactivity-timeout');
    const pollInterval = extractFlag(args, '--poll-interval');
    const routerTimeout = extractFlag(args, '--router-timeout');
    const routerModel = extractFlag(args, '--router-model');
    const routerConsensusModels = parseRouterConsensusModels(
      extractFlag(args, '--router-consensus-models'),
    );
    const githubIssueUrl = extractFlag(args, '--github-issue');
    const personality = extractFlag(args, '--personality');

    const validation = validatePrompt(prompt, githubIssueUrl, specFileArg, {
      allowPromptWithSpecFile: useV2,
    });
    if (!validation.valid) {
      console.error(`Error: ${validation.error}`);
      process.exit(1);
    }

    const loadedSpec = specFileArg ? await loadSpecFile(specFileArg) : undefined;
    const resolvedPrompt =
      loadedSpec !== undefined
        ? (useV2 ? buildV2SpecFilePrompt(specFileArg!, loadedSpec, prompt) : buildSpecFilePrompt(specFileArg!))
        : prompt;

    if (useV2) {
      const { runHeadlessV2 } = await import('./headless/runner.js');
      const result = await runHeadlessV2({
        prompt: resolvedPrompt,
        githubIssueUrl,
        initialSpec: loadedSpec,
        specFilePath: specFileArg ? path.resolve(specFileArg) : undefined,
        outputDir,
        configPath,
        personality,
        verbose,
        routerModel,
        routerConsensusModels,
        routerTimeoutMs:
          routerTimeout !== undefined ? parseDuration(routerTimeout, '--router-timeout') : undefined,
      });
      writeFormattedResult(result, outputFormat, compact);
      process.exit(result.success ? 0 : 1);
    }

    const result = await runHeadless({
      prompt: resolvedPrompt,
      githubIssueUrl,
      initialSpec: loadedSpec,
      specFilePath: specFileArg ? path.resolve(specFileArg) : undefined,
      outputDir,
      configPath,
      personality,
      verbose,
      routerModel,
      routerConsensusModels,
      routerTimeoutMs:
        routerTimeout !== undefined ? parseDuration(routerTimeout, '--router-timeout') : undefined,
      totalTimeoutMs:
        totalTimeout !== undefined
          ? parseDuration(totalTimeout, '--total-timeout')
          : undefined,
      inactivityTimeoutMs:
        inactivityTimeout !== undefined
          ? parseDuration(inactivityTimeout, '--inactivity-timeout')
          : undefined,
      pollIntervalMs:
        pollInterval !== undefined ? parseDuration(pollInterval, '--poll-interval') : undefined,
    });
    writeFormattedResult(result, outputFormat, compact);
    process.exit(result.success ? 0 : 1);
  }

  const configPath = extractFlag(args, '--config');
  const useV2 = !args.includes('--classic');
  const initialPrompt = extractPrompt(args);
  const initialGithubIssueUrl = extractFlag(args, '--github-issue');
  const specFileArg = extractFlag(args, '--spec-file');
  const hasInitialInput =
    initialPrompt.trim().length > 0 ||
    Boolean(initialGithubIssueUrl?.trim()) ||
    Boolean(specFileArg?.trim());
  if (hasInitialInput) {
    const validation = validatePrompt(initialPrompt, initialGithubIssueUrl, specFileArg, {
      allowPromptWithSpecFile: useV2,
    });
    if (!validation.valid) {
      console.error(`Error: ${validation.error}`);
      process.exit(1);
    }
  }
  const loadedSpec = specFileArg ? await loadSpecFile(specFileArg) : undefined;
  const resolvedInitialPrompt =
    loadedSpec !== undefined
      ? (useV2 ? buildV2SpecFilePrompt(specFileArg!, loadedSpec, initialPrompt) : buildSpecFilePrompt(specFileArg!))
      : initialPrompt;
  const outputDir = extractFlag(args, '--output-dir');
  const config = await loadConfig(configPath);
  config.outputDir = path.resolve(outputDir ?? process.cwd());
  await fs.mkdir(config.outputDir, { recursive: true });
  const routerTimeout = extractFlag(args, '--router-timeout');
  const routerModel = extractFlag(args, '--router-model');
  const routerConsensusModels = parseRouterConsensusModels(
    extractFlag(args, '--router-consensus-models'),
  );
  if (routerTimeout !== undefined) {
    config.router = {
      ...config.router,
      timeoutMs: parseDuration(routerTimeout, '--router-timeout'),
    };
  }
  applyRouterOverrides(config, routerModel, routerConsensusModels);
  const detection = await detectAllAdapters(config.ollama.host);

  const app = createTuiApp({
    config,
    detection,
    useV2,
    initialPrompt: resolvedInitialPrompt === '' ? undefined : resolvedInitialPrompt,
    initialGithubIssueUrl,
    initialSpec: loadedSpec,
    specFilePath: specFileArg ? path.resolve(specFileArg) : undefined,
  });
  await app.run();
}

function parseRouterConsensusModels(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const models = value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  if (models.length === 0) {
    throw new Error('--router-consensus-models requires at least one model');
  }
  if (models.length > 3) {
    throw new Error('--router-consensus-models accepts at most 3 models');
  }
  return models;
}

function resolveOutputFormat(args: string[]): MapOutputFormat {
  try {
    return parseMapOutputFormat(extractFlag(args, '--output-format'));
  } catch (error) {
    console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
    process.exit(1);
  }
}

function applyRouterOverrides(
  config: Awaited<ReturnType<typeof loadConfig>>,
  routerModel: string | undefined,
  routerConsensusModels: string[] | undefined,
): void {
  if (routerModel !== undefined) {
    config.router = {
      ...config.router,
      model: routerModel,
    };
  }
  if (routerConsensusModels !== undefined) {
    config.router = {
      ...config.router,
      consensus: {
        ...(config.router.consensus ?? {
          ...DEFAULT_ROUTER_CONSENSUS_CONFIG,
        }),
        enabled: true,
        models: routerConsensusModels,
        scope: 'router',
        mode: 'majority',
      },
    };
  }
}

async function loadSpecFile(specFilePath: string): Promise<string> {
  const resolvedPath = path.resolve(specFilePath);
  let content: string;
  try {
    content = await fs.readFile(resolvedPath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read --spec-file ${resolvedPath}: ${message}`);
  }

  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new Error(`--spec-file ${resolvedPath} is empty`);
  }

  return trimmed;
}

function buildSpecFilePrompt(specFilePath: string): string {
  return `Use the provided specification file at ${path.resolve(specFilePath)}.`;
}

function buildV2SpecFilePrompt(
  specFilePath: string,
  specContent: string,
  extraPrompt: string,
): string {
  const resolvedPath = path.resolve(specFilePath);
  const trimmedExtra = extraPrompt.trim();
  return [
    'Use the provided specification file as the source task for smart routing v2.',
    '',
    `Spec file: ${resolvedPath}`,
    '',
    'Specification content:',
    '```markdown',
    specContent,
    '```',
    ...(trimmedExtra
      ? [
          '',
          'Additional user instructions:',
          trimmedExtra,
        ]
      : []),
  ].join('\n');
}

function writeFormattedResult(result: unknown, format: MapOutputFormat, compact = false): void {
  process.stdout.write(formatMapOutput(result, format, { compact }));
}
