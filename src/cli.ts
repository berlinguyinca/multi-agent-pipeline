import React from 'react';
import { render } from 'ink';

// Placeholder App until TUI screens are wired up
function App() {
  return React.createElement(
    'ink-box',
    null,
    React.createElement('ink-text', null, 'MAP - Multi-Agent Pipeline'),
  );
}

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

Options:
  --help, -h             Show this help
  --version, -v          Show version
  --config <path>        Path to pipeline.yaml config
  --resume [id]          Resume a saved pipeline
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('0.1.0');
    process.exit(0);
  }

  const { waitUntilExit } = render(React.createElement(App));
  await waitUntilExit();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
