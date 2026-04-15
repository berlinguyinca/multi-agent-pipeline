const { convert } = require('./convert.js');

const USAGE = 'Usage: cli.js <string> [--style kebab|snake]';
const VALID_STYLES = ['kebab', 'snake'];

const args = process.argv.slice(2);

let style = null;
const positional = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--style') {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      process.stderr.write('Invalid style\n');
      process.exitCode = 1;
      process.exit();
    }
    if (!VALID_STYLES.includes(value)) {
      process.stderr.write(`Invalid style: ${value}\n`);
      process.exitCode = 1;
      process.exit();
    }
    style = value;
    i++; // skip the value
  } else {
    positional.push(args[i]);
  }
}

if (positional.length !== 1) {
  process.stderr.write(USAGE + '\n');
  process.exitCode = 1;
  process.exit();
}

const input = positional[0];
const result = convert(input, style || 'kebab');
process.stdout.write(result + '\n');
