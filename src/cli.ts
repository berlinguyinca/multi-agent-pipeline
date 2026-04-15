import { maybeSelfUpdate } from './self-update.js';

async function main() {
  const args = process.argv.slice(2);
  await maybeSelfUpdate(args);

  const { runCli } = await import('./cli-runner.js');
  await runCli(args);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
