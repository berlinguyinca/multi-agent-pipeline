#!/usr/bin/env node

import { addItem, useItem, listItems, loadInventory } from './store';

const USAGE = `Usage:
  pantry add <name> <quantity>
  pantry list
  pantry use <name> <quantity>`;

function printUsageAndExit(): never {
  process.stderr.write(USAGE + '\n');
  process.exit(1);
}

function parseQuantity(raw: string): number {
  // Must be a base-10 integer string, positive
  // Allow leading zeros (01 -> 1)
  if (raw === '') {
    throw new Error('Quantity must be a positive integer');
  }
  // Reject strings with non-digit characters (except leading sign)
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid quantity: ${raw}`);
  }
  const n = parseInt(raw, 10);
  if (n <= 0) {
    throw new Error(`Quantity must be a positive integer, got ${n}`);
  }
  return n;
}

function validateName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  if (trimmed === '') {
    throw new Error('Item name must not be empty');
  }
  return trimmed;
}

function printLowStockWarnings(dir: string): void {
  const items = listItems(dir);
  const lowStock = items.filter(i => i.quantity < 2);
  for (const item of lowStock) {
    process.stderr.write(`Warning: ${item.name} is low (quantity: ${item.quantity})\n`);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printUsageAndExit();
  }

  const cwd = process.cwd();

  try {
    switch (command) {
      case 'add': {
        if (args.length < 3) printUsageAndExit();
        if (args.length > 3) printUsageAndExit();
        const name = validateName(args[1]);
        const quantity = parseQuantity(args[2]);
        const result = addItem(cwd, name, quantity);
        process.stdout.write(`Added ${result.name}. Total quantity: ${result.total}\n`);
        break;
      }
      case 'list': {
        if (args.length > 1) printUsageAndExit();
        const items = listItems(cwd);
        if (items.length === 0) {
          process.stdout.write('Pantry is empty.\n');
        } else {
          for (const item of items) {
            process.stdout.write(`${item.name}: ${item.quantity}\n`);
          }
        }
        printLowStockWarnings(cwd);
        break;
      }
      case 'use': {
        if (args.length < 3) printUsageAndExit();
        if (args.length > 3) printUsageAndExit();
        const name = validateName(args[1]);
        const quantity = parseQuantity(args[2]);
        const result = useItem(cwd, name, quantity);
        process.stdout.write(`Used ${quantity} ${result.name}. Remaining quantity: ${result.remaining}\n`);
        printLowStockWarnings(cwd);
        break;
      }
      default:
        printUsageAndExit();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
  }
}

main();
