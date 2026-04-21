import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { runHeadless } from './headless/runner.js';
import { createTuiApp } from './tui/tui-app.js';
import { loadConfig } from './config/loader.js';
import { DEFAULT_ROUTER_CONSENSUS_CONFIG } from './config/defaults.js';
import { detectAllAdapters } from './adapters/detect.js';
import { parseDuration } from './utils/duration.js';
import { validatePrompt } from './utils/prompt-validation.js';
import { extractFlag, extractPrompt, extractSubcommand, hasFlag } from './cli-args.js';
import { formatMapOutput, parseDagLayoutOption, parseMapOutputFormat, type FormatMapOutputOptions, type MapOutputFormat } from './output/result-format.js';
import { openOutputArtifact, writeGraphPngArtifacts, writeHtmlArtifact, writePdfArtifact } from './output/pdf-artifact.js';
import type { OllamaConfig, PipelineConfig } from './types/config.js';
import type { RefineQuestion, RefineResult } from './refine/refiner.js';
import { loadRefineHandoff, saveRefineHandoff } from './refine/handoff.js';

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
  --output-dir <path>    Output directory for generated reports and Markdown artifacts
  --workspace-dir <path> Execute agents in an existing project/data directory (alias: --target-dir)
  --output-format <fmt>  Print final result as json, yaml, markdown, html, text, or pdf (default: json)
  --open-output          Open generated html/pdf output automatically when finished
  --compact              Reduce the selected output format to graph plus Final Result
  --graph                Write PNG agent-network graphs for all DAG layouts
  --dag-layout <layout>  Force DAG visualization: auto, stage, metro, matrix, cluster, or circular
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --router-timeout <dur> Router planning timeout, e.g. 300s
  --router-model <name>  Override the smart-routing router model
  --router-consensus-models <csv>
                         Override default router consensus with up to 3 comma-separated Ollama models
  --disable-agent <csv>  Disable one or more smart-routing agents for this run (alias: --disable-agents)
  --compare-agents [csv]
                         Run ablation comparisons for selected agents (auto when csv omitted)
  --compare-agent-list <csv>
                         Explicit comparison candidates when optional compare value is ambiguous
  --semantic-judge       Add deterministic semantic comparison scores to agent comparisons
  --judge-panel-models <csv>
                         Run an LLM judge panel with the listed models after the DAG
  --judge-panel-roles <csv>
                         Assign adversarial judge roles, e.g. evidence-skeptic,recency-auditor
  --judge-panel-steer    Allow judge panel feedback to trigger one steered rerun
  --judge-panel-max-rounds <n>
                         Max judge-panel steering reruns before stopping (default: 1)
  --disable-cross-review
                         Disable autonomous cross-model review for this run
  --cross-review-max-rounds <n>
                         Max cross-review remediation rounds before best-effort reporting (default: 2)
  --cross-review-judge-models <csv>
                         Override hybrid cross-review judges, e.g. ollama/gemma4:26b,ollama/qwen3.6
  --ollama-host <url>    Override Ollama host for this run
  --ollama-context-length <n>
                         Context length used when MAP starts ollama serve (default: 100000)
  --ollama-num-parallel <n>
                         Parallel requests per loaded model when MAP starts ollama serve (default: 2)
  --ollama-max-loaded-models <n>
                         Max models loaded concurrently when MAP starts ollama serve (default: 2)
  --github-issue <url>   GitHub issue URL for prompt/reporting (auto-detects from gh CLI)
  --review-pr <url>      Review a GitHub PR and post review comment (auto-detects from gh CLI)
  --personality <text>   Personality/tone injected into all AI prompts
  --verbose, -V          Show detailed progress and stage output on stderr
  --silent               Suppress non-format status/path output; stdout stays only the requested format
  --v2                   Deprecated compatibility flag; smart routing is the default

Runtime updates:
  map checks the current checkout branch for newer commits before startup.
  Set MAP_NO_UPDATE=1 to disable the launch-time update check.

Commands:
  map agent list              List all registered agents
  map agent create            Create a new agent (LLM-assisted)
  map agent test <name>       Run an agent smoke test with an optional sample prompt
  map agent edit <name>       Open an agent prompt in $EDITOR
  map evidence audit [path]   Audit Claim Evidence Ledgers in existing artifacts
  map refine "rough prompt"   Refine a prompt with Socratic scoring
  map refine "rough prompt"   Refine a prompt with Socratic scoring
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
  if (subcommand?.command === 'evidence') {
    const { handleEvidenceCommand } = await import('./cli/evidence-commands.js');
    await handleEvidenceCommand(subcommand.subArgs);
    process.exit(0);
  }
  if (subcommand?.command === 'refine') {
    if (subcommand.subArgs.includes('--run')) {
      const { refinePromptHeadless } = await import('./refine/refiner.js');
      const { runHeadlessV2 } = await import('./headless/runner.js');
      const roughPrompt = extractPrompt(subcommand.subArgs);
      const crossReviewEnabled = hasFlag(subcommand.subArgs, '--disable-cross-review') ? false : undefined;
      const crossReviewMaxRounds = parsePositiveIntegerFlag(
        extractFlag(subcommand.subArgs, '--cross-review-max-rounds'),
        '--cross-review-max-rounds',
      );
      const crossReviewJudgeModels = parseCsvFlag(subcommand.subArgs, '--cross-review-judge-models');
      const refined = refinePromptHeadless({ prompt: roughPrompt, headless: true });
      const result = await runHeadlessV2({
        prompt: refined.refinedPrompt,
        crossReviewEnabled,
        crossReviewMaxRounds,
        crossReviewJudgeModels,
      });
      process.stdout.write(formatMapOutput(result, 'json'));
    } else {
      const { handleRefineCommand } = await import('./cli/refine-commands.js');
      const result = await handleRefineCommand(subcommand.subArgs);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    process.exit(0);
  }

  const hasReviewPr = args.includes('--review-pr');
  const reviewPrUrl = extractFlag(args, '--review-pr');
  const outputFormat = resolveOutputFormat(args);
  const compact = hasFlag(args, '--compact');
  const graph = hasFlag(args, '--graph');
  const dagLayout = resolveDagLayout(args);
  const openOutput = hasFlag(args, '--open-output');
  const silent = hasFlag(args, '--silent');
  if (hasReviewPr && !reviewPrUrl) {
    console.error('Error: --review-pr requires a URL argument (e.g. --review-pr https://github.com/owner/repo/pull/123)');
    process.exit(1);
  }
  if (reviewPrUrl) {
    const { runPRReview } = await import('./headless/pr-review.js');
    const configPath = extractFlag(args, '--config');
    const personality = extractFlag(args, '--personality');
    const result = await runPRReview({ prUrl: reviewPrUrl, configPath, personality });
    await writeFormattedResult(result, outputFormat, { compact, dagLayout, graph }, openOutput, silent);
    process.exit(result.success ? 0 : 1);
  }

  if (args.includes('--headless')) {
    const useV2 = !args.includes('--classic');
    const refineOnly = hasFlag(args, '--refine');
    const silent = hasFlag(args, '--silent');
    const verbose = !silent && (hasFlag(args, '--verbose') || hasFlag(args, '-V'));
    const prompt = extractPrompt(args);
    const specFileArg = extractFlag(args, '--spec-file');
    const outputDir = extractFlag(args, '--output-dir') ?? extractFlag(args, '--ouputDir');
    const workspaceDir = extractFlag(args, '--workspace-dir') ?? extractFlag(args, '--target-dir');
    const configPath = extractFlag(args, '--config');
    const totalTimeout = extractFlag(args, '--total-timeout');
    const inactivityTimeout = extractFlag(args, '--inactivity-timeout');
    const pollInterval = extractFlag(args, '--poll-interval');
    const routerTimeout = extractFlag(args, '--router-timeout');
    const routerModel = extractFlag(args, '--router-model');
    const routerConsensusModels = parseRouterConsensusModels(
      extractFlag(args, '--router-consensus-models'),
    );
    const disabledAgents = parseDisabledAgents(args);
    const compareAgents = parseCompareAgents(args);
    const semanticJudge = hasFlag(args, '--semantic-judge');
    const judgePanelModels = parseCsvFlag(args, '--judge-panel-models');
    const judgePanelRoles = parseCsvFlag(args, '--judge-panel-roles');
    const judgePanelSteer = hasFlag(args, '--judge-panel-steer');
    const judgePanelMaxSteeringRounds = parsePositiveIntegerFlag(
      extractFlag(args, '--judge-panel-max-rounds'),
      '--judge-panel-max-rounds',
    );
    const crossReviewEnabled = hasFlag(args, '--disable-cross-review') ? false : undefined;
    const crossReviewMaxRounds = parsePositiveIntegerFlag(
      extractFlag(args, '--cross-review-max-rounds'),
      '--cross-review-max-rounds',
    );
    const crossReviewJudgeModels = parseCsvFlag(args, '--cross-review-judge-models');
    const ollama = parseOllamaOverrides(args);
    const githubIssueUrl = extractFlag(args, '--github-issue');
    const personality = extractFlag(args, '--personality');

    const runWithPrompt = async (resolvedPrompt: string, options: { initialSpec?: string; specFilePath?: string; rerunPrompt?: string } = {}) => {
      if (useV2) {
        const { runHeadlessV2 } = await import('./headless/runner.js');
        const result = await runHeadlessV2({
          prompt: resolvedPrompt,
          githubIssueUrl,
          ...(options.initialSpec !== undefined ? { initialSpec: options.initialSpec } : {}),
          ...(options.specFilePath ? { specFilePath: options.specFilePath } : {}),
          outputDir,
          workspaceDir,
          configPath,
          personality,
          verbose,
          routerModel,
          routerConsensusModels,
          disabledAgents,
          rerunPrompt: options.rerunPrompt ?? prompt,
          compareAgents,
          semanticJudge,
          judgePanelModels,
          judgePanelRoles,
          judgePanelSteer,
          judgePanelMaxSteeringRounds,
          crossReviewEnabled,
          crossReviewMaxRounds,
          crossReviewJudgeModels,
          ollama,
          routerTimeoutMs:
            routerTimeout !== undefined ? parseDuration(routerTimeout, '--router-timeout') : undefined,
        });
        await writeFormattedResult(result, outputFormat, { compact, dagLayout, graph }, openOutput, silent);
        process.exit(result.success ? 0 : 1);
      }

      const result = await runHeadless({
        prompt: resolvedPrompt,
        githubIssueUrl,
        ...(options.initialSpec !== undefined ? { initialSpec: options.initialSpec } : {}),
        ...(options.specFilePath ? { specFilePath: options.specFilePath } : {}),
        outputDir,
        workspaceDir,
        configPath,
        personality,
        verbose,
        routerModel,
        routerConsensusModels,
        crossReviewEnabled,
        crossReviewMaxRounds,
        crossReviewJudgeModels,
        ollama,
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
      await writeFormattedResult(result, outputFormat, { compact, dagLayout, graph }, openOutput, silent);
      process.exit(result.success ? 0 : 1);
    };

    const runRefineGate = async (basePrompt: string) => {
      const { refinePromptHeadless } = await import('./refine/refiner.js');
      const initial = refinePromptHeadless({ prompt: basePrompt, headless: true });
      const generatedQuestions = await generateRefineQuestionDetails({
        prompt: basePrompt,
        initial,
        configPath,
        routerModel,
        ollama,
      });
      const questionDetails = generatedQuestions.length > 0 ? generatedQuestions : initial.questionDetails;
      const questioned = refinePromptHeadless({ prompt: basePrompt, headless: true, questionDetails });
      const answers = !silent && process.stdin.isTTY ? await askRefineAnswers(questioned.questionDetails) : [];
      const refined = answers.length > 0
        ? refinePromptHeadless({ prompt: basePrompt, headless: true, questionDetails, answers })
        : questioned;
      const handoff = await saveRefineHandoff(path.resolve(outputDir ?? process.cwd()), refined);
      if (silent || !process.stdin.isTTY) {
        const output = silent
          ? `${JSON.stringify(refined, null, 2)}\n`
          : `${formatRefineQuestions(refined)}${paint('Saved refined spec:', 'green', 'bold')} ${handoff.refinedPromptPath}\n`;
        process.stdout.write(output);
        process.exit(0);
      }

      const choice = await askRefineHandoffChoice();
      if (choice === 'implement') {
        await runWithPrompt(refined.refinedPrompt, { rerunPrompt: basePrompt });
        return;
      }
      if (choice === 'save') {
        process.stdout.write(`${paint('Saved refined spec:', 'green', 'bold')} ${handoff.refinedPromptPath}\n`);
        process.exit(0);
      }

      process.stdout.write(`${formatRefineQuestions(refined)}${paint('Saved refined spec:', 'green', 'bold')} ${handoff.refinedPromptPath}\n`);
      process.exit(0);
    };

    const savedRefineHandoff = await loadRefineHandoff(path.resolve(outputDir ?? process.cwd()));
    if (!silent && process.stdin.isTTY && savedRefineHandoff) {
      const choice = await askSavedRefineHandoffChoice(savedRefineHandoff.refinedPromptPath);
      if (choice === 'execute') {
        await runWithPrompt(savedRefineHandoff.result.refinedPrompt, { rerunPrompt: prompt });
        return;
      }
      if (choice === 'refine') {
        await runRefineGate(savedRefineHandoff.result.refinedPrompt);
        return;
      }
    }

    if (refineOnly) {
      if (!silent && !process.stdin.isTTY && savedRefineHandoff) {
        process.stderr.write(`${paint('Saved refined spec found; executing it in non-interactive refine mode:', 'cyan', 'bold')} ${savedRefineHandoff.refinedPromptPath}\n`);
        await runWithPrompt(savedRefineHandoff.result.refinedPrompt, { rerunPrompt: prompt });
        return;
      }
      await runRefineGate(prompt);
      return;
    }

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

    await runWithPrompt(resolvedPrompt, {
      ...(loadedSpec !== undefined ? { initialSpec: loadedSpec } : {}),
      ...(specFileArg ? { specFilePath: path.resolve(specFileArg) } : {}),
      rerunPrompt: prompt,
    });
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
  const outputDir = extractFlag(args, '--output-dir') ?? extractFlag(args, '--ouputDir');
  const workspaceDir = extractFlag(args, '--workspace-dir') ?? extractFlag(args, '--target-dir');
  const config = await loadConfig(configPath);
  config.outputDir = path.resolve(outputDir ?? process.cwd());
  if (workspaceDir) config.workspaceDir = path.resolve(workspaceDir);
  await fs.mkdir(config.outputDir, { recursive: true });
  const routerTimeout = extractFlag(args, '--router-timeout');
  const routerModel = extractFlag(args, '--router-model');
  const routerConsensusModels = parseRouterConsensusModels(
    extractFlag(args, '--router-consensus-models'),
  );
  const disabledAgents = parseDisabledAgents(args);
  const compareAgents = parseCompareAgents(args);
  const ollama = parseOllamaOverrides(args);
  if (routerTimeout !== undefined) {
    config.router = {
      ...config.router,
      timeoutMs: parseDuration(routerTimeout, '--router-timeout'),
    };
  }
  applyOllamaOverrides(config, ollama);
  applyRouterOverrides(config, routerModel, routerConsensusModels);
  applyDisabledAgentOverrides(config, disabledAgents);
  if (compareAgents !== undefined) {
    config.generateAgentSummary = true;
  }
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




async function generateRefineQuestionDetails(options: {
  prompt: string;
  initial: Pick<RefineResult, 'questionsAsked' | 'recommendedCapabilities'>;
  configPath?: string;
  routerModel?: string;
  ollama?: Partial<OllamaConfig>;
}): Promise<RefineQuestion[]> {
  try {
    const [{ createAdapter }, { generateRefineQuestions }] = await Promise.all([
      import('./adapters/adapter-factory.js'),
      import('./refine/question-generator.js'),
    ]);
    const config = await loadConfig(options.configPath);
    const adapter = createAdapter({
      type: config.router.adapter,
      model: options.routerModel ?? config.router.model,
      ...(config.router.adapter === 'ollama' ? { ...config.ollama, ...options.ollama } : {}),
    });
    return await generateRefineQuestions({
      adapter,
      prompt: options.prompt,
      heuristicQuestions: options.initial.questionsAsked,
      recommendedCapabilities: options.initial.recommendedCapabilities,
    });
  } catch {
    return [];
  }
}

async function askRefineAnswers(questions: RefineQuestion[]): Promise<string[]> {
  if (questions.length === 0) return [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answers: string[] = [];
    process.stdout.write(`${paint('MAP refine needs a few answers before execution.', 'cyan', 'bold')}\n`);
    for (const [index, entry] of questions.entries()) {
      answers.push(await rl.question(formatInteractiveQuestion(entry, index)));
    }
    return answers;
  } finally {
    rl.close();
  }
}


async function askRefineHandoffChoice(): Promise<'implement' | 'save' | 'print'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question([
      '',
      paint('What next?', 'cyan', 'bold'),
      `${paint('i', 'green', 'bold')}) implement now`,
      `${paint('s', 'yellow', 'bold')}) save refined spec for next session`,
      `${paint('p', 'dim')}) print only`,
      '> ',
    ].join('\n'))).trim().toLowerCase();
    if (answer.startsWith('i')) return 'implement';
    if (answer.startsWith('s') || answer === '') return 'save';
    return 'print';
  } finally {
    rl.close();
  }
}

async function askSavedRefineHandoffChoice(refinedPromptPath: string): Promise<'execute' | 'refine' | 'ignore'> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question([
      paint('Saved refined spec found for this output folder.', 'cyan', 'bold'),
      refinedPromptPath,
      `${paint('e', 'green', 'bold')}) execute saved spec now`,
      `${paint('r', 'yellow', 'bold')}) refine it further`,
      `${paint('i', 'dim')}) ignore and continue with current prompt`,
      '> ',
    ].join('\n'))).trim().toLowerCase();
    if (answer.startsWith('e') || answer === '') return 'execute';
    if (answer.startsWith('r')) return 'refine';
    return 'ignore';
  } finally {
    rl.close();
  }
}

function formatRefineQuestions(result: { inputPrompt: string; questionsAsked: string[]; questionDetails?: RefineQuestion[]; assumptions: string[]; answers?: string[]; refinedPrompt: string }): string {
  const questionDetails = result.questionDetails && result.questionDetails.length > 0
    ? result.questionDetails
    : result.questionsAsked.map((question) => ({ question }));
  const questions = questionDetails.length > 0
    ? questionDetails.flatMap(formatQuestionLines)
    : ['1. No clarification questions were generated; review the optimized prompt below before execution.'];
  return [
    paint('# MAP Refine Questions', 'cyan', 'bold'),
    '',
    result.answers && result.answers.length > 0
      ? 'Answers collected. Review the refined prompt below, then rerun MAP with it or use `map refine --run` when you are ready to execute automatically.'
      : 'Please answer these questions before execution, then rerun MAP with your answers included in the prompt or use `map refine --run` when you are ready to execute automatically.',
    '',
    paint('## Original request', 'bold'),
    result.inputPrompt,
    '',
    paint('## Questions', 'bold'),
    ...questions,
    '',
    ...(result.answers && result.answers.length > 0
      ? [
          paint('## Answers collected', 'bold'),
          ...result.answers.map((answer, index) => `${index + 1}. ${result.questionsAsked[index] ?? `Question ${index + 1}`}\n   Answer: ${answer}`),
          '',
        ]
      : []),
    paint('## Assumptions MAP would use if you proceed without more answers', 'bold'),
    ...result.assumptions.map((assumption) => `- ${assumption}`),
    '',
    paint('## Refined prompt draft', 'bold'),
    result.refinedPrompt,
    '',
  ].join('\n');
}


function formatInteractiveQuestion(entry: RefineQuestion, index: number): string {
  return [
    `${paint(`${index + 1}.`, 'yellow', 'bold')} ${paint(entry.question, 'bold')}`,
    ...(entry.reason ? [`   ${paint('Why it matters:', 'dim')} ${entry.reason}`] : []),
    ...(entry.defaultAssumption ? [`   ${paint('Default if unanswered:', 'dim')} ${entry.defaultAssumption}`] : []),
    paint('> ', 'green', 'bold'),
  ].join('\n');
}

function formatQuestionLines(entry: RefineQuestion, index: number): string[] {
  return [
    `${paint(`${index + 1}.`, 'yellow', 'bold')} ${entry.question}`,
    ...(entry.reason ? [`   ${paint('Why it matters:', 'dim')} ${entry.reason}`] : []),
    ...(entry.defaultAssumption ? [`   ${paint('Default if unanswered:', 'dim')} ${entry.defaultAssumption}`] : []),
  ];
}

function paint(text: string, ...styles: Array<'bold' | 'cyan' | 'yellow' | 'green' | 'dim'>): string {
  if (!shouldUseColor()) return text;
  const codes: Record<'bold' | 'cyan' | 'yellow' | 'green' | 'dim', string> = {
    bold: '1',
    cyan: '36',
    yellow: '33',
    green: '32',
    dim: '2',
  };
  return `${styles.map((style) => `[${codes[style]}m`).join('')}${text}[0m`;
}

function shouldUseColor(): boolean {
  return process.env.MAP_NO_COLOR !== '1' && process.stdout.isTTY === true;
}

function parseCompareAgents(args: string[]): string[] | undefined {
  if (!hasFlag(args, '--compare-agents')) {
    const explicit = extractFlag(args, '--compare-agent-list');
    return explicit === undefined ? undefined : parseCsvList(explicit);
  }
  const idx = args.indexOf('--compare-agents');
  const value = args[idx + 1];
  if (value && !value.startsWith('--') && value.includes(',')) {
    return parseCsvList(value);
  }
  if (value && !value.startsWith('--')) {
    const following = args.slice(idx + 2).some((arg) => !arg.startsWith('--'));
    if (following) return parseCsvList(value);
  }
  return [];
}

function parseDisabledAgents(args: string[]): string[] | undefined {
  const values = collectFlagValues(args, ['--disable-agent', '--disable-agents']);
  const agents = values.flatMap(parseCsvList);
  if (agents.length === 0) return undefined;
  return [...new Set(agents)];
}

function parseCsvFlag(args: string[], flag: string): string[] | undefined {
  const value = extractFlag(args, flag);
  return value === undefined ? undefined : parseCsvList(value);
}

function parseCsvList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function collectFlagValues(args: string[], flags: string[]): string[] {
  const flagSet = new Set(flags);
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (!flagSet.has(args[index] ?? '')) continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) continue;
    values.push(value);
  }
  return values;
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

function applyDisabledAgentOverrides(
  config: PipelineConfig,
  disabledAgents: string[] | undefined,
): void {
  if (!disabledAgents || disabledAgents.length === 0) return;
  const existingOverrides = config.agentOverrides ?? {};
  config.agentOverrides = {
    ...existingOverrides,
    ...Object.fromEntries(
      disabledAgents.map((name) => [
        name,
        {
          ...(existingOverrides[name] ?? {}),
          enabled: false,
        },
      ]),
    ),
  };
}

function parseOllamaOverrides(args: string[]): Partial<OllamaConfig> | undefined {
  const host = extractFlag(args, '--ollama-host');
  const contextLength = parsePositiveIntegerFlag(
    extractFlag(args, '--ollama-context-length'),
    '--ollama-context-length',
  );
  const numParallel = parsePositiveIntegerFlag(
    extractFlag(args, '--ollama-num-parallel'),
    '--ollama-num-parallel',
  );
  const maxLoadedModels = parsePositiveIntegerFlag(
    extractFlag(args, '--ollama-max-loaded-models'),
    '--ollama-max-loaded-models',
  );

  const override: Partial<OllamaConfig> = {};
  if (host !== undefined) {
    const trimmed = host.trim();
    if (trimmed === '') {
      throw new Error('--ollama-host must be a non-empty string');
    }
    override.host = trimmed;
  }
  if (contextLength !== undefined) override.contextLength = contextLength;
  if (numParallel !== undefined) override.numParallel = numParallel;
  if (maxLoadedModels !== undefined) override.maxLoadedModels = maxLoadedModels;

  return Object.keys(override).length > 0 ? override : undefined;
}

function parsePositiveIntegerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function resolveOutputFormat(args: string[]): MapOutputFormat {
  try {
    return parseMapOutputFormat(extractFlag(args, '--output-format'));
  } catch (error) {
    console.error(error instanceof Error ? `Error: ${error.message}` : String(error));
    process.exit(1);
  }
}

function resolveDagLayout(args: string[]): FormatMapOutputOptions['dagLayout'] {
  try {
    return parseDagLayoutOption(extractFlag(args, '--dag-layout'));
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

function applyOllamaOverrides(
  config: PipelineConfig,
  ollama: Partial<OllamaConfig> | undefined,
): void {
  if (ollama === undefined) return;
  config.ollama = {
    ...config.ollama,
    ...ollama,
  };
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

async function writeFormattedResult(
  result: unknown,
  format: MapOutputFormat,
  formatOptions: FormatMapOutputOptions & { graph?: boolean } = {},
  openOutput = false,
  silent = false,
): Promise<void> {
  const compact = formatOptions.compact ?? false;
  const outputDir = typeof result === 'object' && result !== null && !Array.isArray(result)
    ? ((result as Record<string, unknown>)['outputDir'] as string | undefined)
    : undefined;
  const resultWithGraph = formatOptions.graph === true
    ? await attachGraphArtifacts(result, outputDir)
    : result;

  if (format === 'pdf') {
    const artifact = await writePdfArtifact(resultWithGraph, {
      compact,
      outputDir,
      dagLayout: formatOptions.dagLayout,
    });
    if (openOutput) {
      await openOutputArtifact(artifact.pdfPath ?? artifact.htmlPath);
    }
    if (!silent) {
      if (artifact.pdfPath) {
        process.stdout.write(`PDF written to ${artifact.pdfPath}
HTML source written to ${artifact.htmlPath}
`);
        reportOutputStorage(resultWithGraph, artifact.htmlPath, silent);
        return;
      }
      process.stdout.write(`HTML report written to ${artifact.htmlPath}
${artifact.warning ?? 'PDF rendering unavailable.'}
`);
      reportOutputStorage(resultWithGraph, artifact.htmlPath, silent);
    }
    return;
  }

  if (format === 'html' && openOutput) {
    const artifact = await writeHtmlArtifact(resultWithGraph, { compact, outputDir, dagLayout: formatOptions.dagLayout });
    await openOutputArtifact(artifact.htmlPath);
    if (!silent) {
      process.stdout.write(`HTML report written to ${artifact.htmlPath}
`);
      reportOutputStorage(resultWithGraph, artifact.htmlPath, silent);
    }
    return;
  }

  if (openOutput) {
    const artifact = await writeHtmlArtifact(resultWithGraph, { compact, outputDir, dagLayout: formatOptions.dagLayout });
    await openOutputArtifact(artifact.htmlPath);
  }

  process.stdout.write(formatMapOutput(resultWithGraph, format, formatOptions));
  reportOutputStorage(resultWithGraph, outputDir, silent);
}

function reportOutputStorage(result: unknown, fallbackPath: string | undefined, silent: boolean): void {
  if (silent) return;
  const outputDir = resolveOutputStorageDir(result, fallbackPath);
  if (!outputDir) return;
  process.stderr.write(`Output directory: ${outputDir}
`);
}

function resolveOutputStorageDir(result: unknown, fallbackPath: string | undefined): string | undefined {
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    const maybeOutputDir = (result as Record<string, unknown>)['outputDir'];
    if (typeof maybeOutputDir === 'string' && maybeOutputDir.trim()) return maybeOutputDir;
  }
  return fallbackPath ? path.dirname(fallbackPath) : undefined;
}

async function attachGraphArtifacts(result: unknown, outputDir: string | undefined): Promise<unknown> {
  const graph = await writeGraphPngArtifacts(result, { outputDir });
  if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
    return {
      ...result,
      graphArtifacts: graph.artifacts,
      graphArtifactManifestPath: graph.manifestPath,
      ...(graph.warnings.length > 0 ? { graphWarnings: graph.warnings } : {}),
    };
  }
  return {
    result,
    graphArtifacts: graph.artifacts,
    graphArtifactManifestPath: graph.manifestPath,
    ...(graph.warnings.length > 0 ? { graphWarnings: graph.warnings } : {}),
  };
}
