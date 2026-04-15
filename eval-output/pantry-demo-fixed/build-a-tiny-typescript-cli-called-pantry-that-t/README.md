# pantry

A tiny TypeScript CLI for managing a local pantry inventory stored in `pantry.json`.

## Installation

```bash
npm install
npm run build
```

To install globally:

```bash
npm link
```

## Commands

### `pantry add <name> <quantity>`

Adds a quantity of an item to the pantry. Creates the item if it doesn't exist, or increments the existing quantity.

```bash
pantry add rice 5
# Added rice. Total quantity: 5

pantry add rice 3
# Added rice. Total quantity: 8
```

Item names are case-insensitive and stored lowercase:

```bash
pantry add Rice 2
# Added rice. Total quantity: 2
```

### `pantry list`

Lists all items in the pantry in alphabetical order. Prints low-stock warnings to stderr for items with quantity < 2.

```bash
pantry list
# rice: 8
# tea: 1
# (stderr) Warning: tea is low (quantity: 1)
```

If the pantry is empty:

```bash
pantry list
# Pantry is empty.
```

### `pantry use <name> <quantity>`

Uses a quantity of an item from the pantry. Prints low-stock warnings to stderr for items with quantity < 2.

```bash
pantry use rice 4
# Used 4 rice. Remaining quantity: 4

pantry use rice 4
# Used 4 rice. Remaining quantity: 0
# (stderr) Warning: rice is low (quantity: 0)
```

Using more than available stock is an error:

```bash
pantry use rice 100
# (stderr) Error: Insufficient stock for rice: have 8, need 100
```

Using a nonexistent item is an error:

```bash
pantry use flour 1
# (stderr) Error: Item not found: flour
```

## Low-Stock Warnings

Items with quantity < 2 (including 0) trigger a warning after successful `list` and `use` commands. Warnings are printed to stderr in alphabetical order. The `add` command does not emit warnings.

## Data File

Inventory is stored in `pantry.json` in the current working directory. The file contains a JSON object mapping lowercase item names to integer quantities:

```json
{
  "rice": 8,
  "tea": 3
}
```

A missing `pantry.json` is treated as an empty pantry. Items used to zero remain in the file with quantity 0.

## Quantity Validation

Quantities must be positive integers (base-10). Leading zeros are accepted (`01` is treated as `1`).

Invalid quantities: `0`, `-1`, `1.5`, `foo`, `3abc`, empty string.

## Running Tests

```bash
npm test
```

## Building

```bash
npm run build
```
