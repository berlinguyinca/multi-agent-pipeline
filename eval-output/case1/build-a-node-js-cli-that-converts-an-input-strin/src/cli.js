#!/usr/bin/env node
'use strict';

const { convert, VALID_STYLES } = require('./convert');

function parseArgs(argv) {
  const args = argv.slice(2);
  let style = 'kebab';
  let input = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--style') {
      i++;
      if (i >= args.length) {
        process.stderr.write('Error: --style requires a value\n');
        process.exit(1);
      }
      style = args[i];
    } else if (input === null) {
      input = args[i];
    }
  }

  return { style, input };
}

const { style, input } = parseArgs(process.argv);

if (input === null) {
  process.stderr.write('Usage: string-case-converter [--style <style>] <input>\n');
  process.stderr.write(`Styles: ${VALID_STYLES.join(', ')}\n`);
  process.exit(1);
}

if (!VALID_STYLES.includes(style)) {
  process.stderr.write(`Error: Unknown style "${style}". Valid styles: ${VALID_STYLES.join(', ')}\n`);
  process.exit(1);
}

const result = convert(input, style);
process.stdout.write(result + '\n');
