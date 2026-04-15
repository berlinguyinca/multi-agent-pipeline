import * as fs from 'fs';
import * as path from 'path';

export interface InventoryItem {
  name: string;
  quantity: number;
}

export type Inventory = Record<string, number>;

/**
 * Load and validate inventory from pantry.json in the given directory.
 * Returns empty object if file does not exist.
 * Throws on malformed JSON or invalid schema.
 */
export function loadInventory(dir: string): Inventory {
  const filePath = path.join(dir, 'pantry.json');

  if (!fs.existsSync(filePath)) {
    return {};
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Malformed JSON in pantry.json');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid pantry.json schema: must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'number') {
      throw new Error(`Invalid quantity for "${key}": must be a number`);
    }
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid quantity for "${key}": must be an integer`);
    }
    if (value < 0) {
      throw new Error(`Invalid quantity for "${key}": must be non-negative`);
    }
  }

  return obj as Inventory;
}

/**
 * Save inventory to pantry.json in the given directory.
 */
export function saveInventory(dir: string, inventory: Inventory): void {
  const filePath = path.join(dir, 'pantry.json');
  fs.writeFileSync(filePath, JSON.stringify(inventory, null, 2) + '\n');
}

/**
 * Add quantity to an item. Creates the item if it doesn't exist.
 * Returns the normalized name and new total.
 */
export function addItem(dir: string, name: string, quantity: number): { name: string; total: number } {
  const inventory = loadInventory(dir);
  const normalized = name.toLowerCase().trim();
  const current = inventory[normalized] ?? 0;
  const total = current + quantity;
  inventory[normalized] = total;
  saveInventory(dir, inventory);
  return { name: normalized, total };
}

/**
 * Use quantity from an existing item.
 * Throws if item not found or insufficient stock.
 * Returns the normalized name and remaining quantity.
 */
export function useItem(dir: string, name: string, quantity: number): { name: string; remaining: number } {
  const inventory = loadInventory(dir);
  const normalized = name.toLowerCase().trim();

  if (!(normalized in inventory)) {
    throw new Error(`Item not found: ${normalized}`);
  }

  const current = inventory[normalized];
  if (quantity > current) {
    throw new Error(`Insufficient stock for ${normalized}: have ${current}, need ${quantity}`);
  }

  const remaining = current - quantity;
  inventory[normalized] = remaining;
  saveInventory(dir, inventory);
  return { name: normalized, remaining };
}

/**
 * List all items sorted alphabetically.
 * Returns empty array if pantry is empty or file doesn't exist.
 */
export function listItems(dir: string): InventoryItem[] {
  const inventory = loadInventory(dir);
  return Object.entries(inventory)
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
