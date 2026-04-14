import React from 'react';
import { render } from 'ink';
import { runHeadless } from './headless/runner.js';
import App from './tui/App.js';
import { loadConfig } from './config/loader.js';
import { detectAllAdapters } from './adapters/detect.js';
import { parseDuration } from './utils/duration.js';
import { extractFlag, extractPrompt } from './cli-args.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MAP - Multi-Agent Pipeline
One prompt. One shot. Working software.

Usage:
  map                    Launch interactive TUI
  map "your idea"        Start pipeline with a prompt
  map --resume [id]      Resume a saved pipeline
  map --config <path>    Use custom config file
  map --headless "idea"  Run non-interactively, outputs JSON to stdout
  map --github-issue <url>
                         Use a GitHub issue as the build prompt and post final report

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
  --github-issue <url>   GitHub issue URL for prompt/reporting (requires GITHUB_TOKEN)
  --personality <text>   Personality/tone injected into all AI prompts
  --v2                   Use v2 routing mode (DAG-based agent routing)
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  if (args.includes('--headless')) {
    const useV2 = args.includes('--v2');
    const prompt = extractPrompt(args);
    const outputDir = extractFlag(args, '--output-dir');
    const configPath = extractFlag(args, '--config');
    const totalTimeout = extractFlag(args, '--total-timeout');
    const inactivityTimeout = extractFlag(args, '--inactivity-timeout');
    const pollInterval = extractFlag(args, '--poll-interval');
    const githubIssueUrl = extractFlag(args, '--github-issue');
    const personality = extractFlag(args, '--personality');

    if (useV2) {
      const { runHeadlessV2 } = await import('./headless/runner.js');
      const result = await runHeadlessV2({
        prompt,
        outputDir,
        configPath,
        personality,
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
  const initialPrompt = extractPrompt(args);
  const initialGithubIssueUrl = extractFlag(args, '--github-issue');
  const config = await loadConfig(configPath);
  const detection = await detectAllAdapters(config.ollama.host);

  const { waitUntilExit } = render(
    React.createElement(App, {
      config,
      detection,
      initialPrompt: initialPrompt === '' ? undefined : initialPrompt,
      initialGithubIssueUrl,
    }),
  );
  await waitUntilExit();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
