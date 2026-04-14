import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PipelineConfig } from '../types/config.js';

const execFileAsync = promisify(execFile);

const GH_TIMEOUT_MS = 5_000;

/**
 * Attempt to get a GitHub token from the `gh` CLI.
 * Returns undefined if `gh` is not installed, the user is not logged in,
 * or the command times out.
 */
export async function getGhCliToken(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], {
      timeout: GH_TIMEOUT_MS,
    });
    const token = stdout.trim();
    return token === '' ? undefined : token;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a GitHub token using a three-tier fallback:
 *   1. GITHUB_TOKEN environment variable
 *   2. github.token from pipeline.yaml config
 *   3. Live `gh auth token` CLI call
 */
export async function resolveGitHubToken(
  config?: PipelineConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  // Tier 1: environment variable
  const envToken = env['GITHUB_TOKEN']?.trim();
  if (envToken && envToken !== '') {
    return envToken;
  }

  // Tier 2: config file
  const configToken = config?.github?.token;
  if (configToken && configToken.trim() !== '') {
    return configToken.trim();
  }

  // Tier 3: gh CLI
  return getGhCliToken();
}
