import { runHeadless } from './headless/runner.js';
import { createTuiApp } from './tui/tui-app.js';
import { loadConfig } from './config/loader.js';
import { detectAllAdapters } from './adapters/detect.js';
import { parseDuration } from './utils/duration.js';
import { validatePrompt } from './utils/prompt-validation.js';
import { extractFlag, extractPrompt, extractSubcommand, hasFlag } from './cli-args.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MAP - Multi-Agent Pipeline
One task. One shot. Useful output.

Usage:
  map                    Launch interactive TUI
  map "your idea"        Start with a task or question
  map --resume [id]      Resume a saved pipeline
  map --config <path>    Use custom config file
  map --headless "idea"  Run non-interactively, outputs JSON to stdout
  map --github-issue <url>
                         Use a GitHub issue as the task prompt and post final report
  map --review-pr <url>  Review a GitHub PR and post findings as a comment

Options:
  --help, -h             Show this help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
  --headless             Run without TUI, print JSON result to stdout
  --output-dir <path>    Output directory (headless mode)
  --total-timeout <dur>  Total headless runtime budget, e.g. 60m
  --inactivity-timeout <dur>
                         Stall timeout since last stage activity, e.g. 10m
  --poll-interval <dur>  Internal polling cadence for timeout checks, e.g. 10s
  --github-issue <url>   GitHub issue URL for prompt/reporting (auto-detects from gh CLI)
  --review-pr <url>      Review a GitHub PR and post review comment (auto-detects from gh CLI)
  --personality <text>   Personality/tone injected into all AI prompts
  --verbose, -V          Show detailed progress and stage output on stderr
  --v2                   Use v2 routing mode (DAG-based agent routing)

Commands:
  map agent list              List all registered agents
  map agent create            Create a new agent (LLM-assisted)
  map agent test <name>       Test an agent with a sample prompt
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  const subcommand = extractSubcommand(args);
  if (subcommand?.command === 'agent') {
    const { handleAgentCommand } = await import('./cli/agent-commands.js');
    await handleAgentCommand(subcommand.subArgs);
    process.exit(0);
  }

  const hasReviewPr = args.includes('--review-pr');
  const reviewPrUrl = extractFlag(args, '--review-pr');
  if (hasReviewPr && !reviewPrUrl) {
    console.error('Error: --review-pr requires a URL argument (e.g. --review-pr https://github.com/owner/repo/pull/123)');
    process.exit(1);
  }
  if (reviewPrUrl) {
    const { runPRReview } = await import('./headless/pr-review.js');
    const configPath = extractFlag(args, '--config');
    const personality = extractFlag(args, '--personality');
    const result = await runPRReview({ prUrl: reviewPrUrl, configPath, personality });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.success ? 0 : 1);
  }

  if (args.includes('--headless')) {
    const useV2 = args.includes('--v2');
    const verbose = hasFlag(args, '--verbose') || hasFlag(args, '-V');
    const prompt = extractPrompt(args);
    const outputDir = extractFlag(args, '--output-dir');
    const configPath = extractFlag(args, '--config');
    const totalTimeout = extractFlag(args, '--total-timeout');
    const inactivityTimeout = extractFlag(args, '--inactivity-timeout');
    const pollInterval = extractFlag(args, '--poll-interval');
    const githubIssueUrl = extractFlag(args, '--github-issue');
    const personality = extractFlag(args, '--personality');

    const validation = validatePrompt(prompt, githubIssueUrl);
    if (!validation.valid) {
      console.error(`Error: ${validation.error}`);
      process.exit(1);
    }

    if (useV2) {
      const { runHeadlessV2 } = await import('./headless/runner.js');
      const result = await runHeadlessV2({
        prompt,
        outputDir,
        configPath,
        personality,
        verbose,
      });
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(result.success ? 0 : 1);
    }

    const result = await runHeadless({
      prompt,
      githubIssueUrl,
      outputDir,
      configPath,
      personality,
      verbose,
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
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(result.success ? 0 : 1);
  }

  const configPath = extractFlag(args, '--config');
  const useV2 = args.includes('--v2');
  const initialPrompt = extractPrompt(args);
  const initialGithubIssueUrl = extractFlag(args, '--github-issue');
  const config = await loadConfig(configPath);
  const detection = await detectAllAdapters(config.ollama.host);

  const app = createTuiApp({
    config,
    detection,
    useV2,
    initialPrompt: initialPrompt === '' ? undefined : initialPrompt,
    initialGithubIssueUrl,
  });
  await app.run();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
