import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We'll import from store once it exists — tests should fail because the module doesn't exist yet
import { loadInventory, saveInventory, addItem, useItem, listItems } from '../src/store';

describe('store', () => {
  let tmpDir: string;
  let pantryPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pantry-test-'));
    pantryPath = path.join(tmpDir, 'pantry.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // [TEST:WRITE] load-missing-file
  describe('loadInventory', () => {
    test('returns empty object when pantry.json does not exist', () => {
      const inventory = loadInventory(tmpDir);
      expect(inventory).toEqual({});
    });

    // [TEST:WRITE] load-empty-object
    test('returns empty object when pantry.json contains {}', () => {
      fs.writeFileSync(pantryPath, '{}');
      const inventory = loadInventory(tmpDir);
      expect(inventory).toEqual({});
    });

    // [TEST:WRITE] load-valid-data
    test('returns parsed inventory from valid pantry.json', () => {
      fs.writeFileSync(pantryPath, '{"rice": 5, "tea": 3}');
      const inventory = loadInventory(tmpDir);
      expect(inventory).toEqual({ rice: 5, tea: 3 });
    });

    // [TEST:WRITE] load-malformed-json
    test('throws error for malformed JSON', () => {
      fs.writeFileSync(pantryPath, '{not valid json');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-array-schema
    test('throws error when JSON is an array', () => {
      fs.writeFileSync(pantryPath, '[1, 2, 3]');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-primitive-schema
    test('throws error when JSON is a primitive string', () => {
      fs.writeFileSync(pantryPath, '"hello"');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-null-schema
    test('throws error when JSON is null', () => {
      fs.writeFileSync(pantryPath, 'null');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-negative-quantity
    test('throws error when a quantity is negative', () => {
      fs.writeFileSync(pantryPath, '{"rice": -1}');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-non-integer-quantity
    test('throws error when a quantity is a float', () => {
      fs.writeFileSync(pantryPath, '{"rice": 1.5}');
      expect(() => loadInventory(tmpDir)).toThrow();
    });

    // [TEST:WRITE] load-non-number-quantity
    test('throws error when a quantity is a string', () => {
      fs.writeFileSync(pantryPath, '{"rice": "five"}');
      expect(() => loadInventory(tmpDir)).toThrow();
    });
  });

  // [TEST:WRITE] save-inventory
  describe('saveInventory', () => {
    test('writes inventory to pantry.json', () => {
      saveInventory(tmpDir, { rice: 5, tea: 3 });
      const content = fs.readFileSync(pantryPath, 'utf-8');
      expect(JSON.parse(content)).toEqual({ rice: 5, tea: 3 });
    });

    // [TEST:WRITE] save-creates-file
    test('creates pantry.json if it does not exist', () => {
      expect(fs.existsSync(pantryPath)).toBe(false);
      saveInventory(tmpDir, { rice: 1 });
      expect(fs.existsSync(pantryPath)).toBe(true);
    });
  });

  describe('addItem', () => {
    // [TEST:WRITE] add-new-item
    test('adds new item to empty inventory', () => {
      const result = addItem(tmpDir, 'rice', 5);
      expect(result.total).toBe(5);
      expect(result.name).toBe('rice');
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 5 });
    });

    // [TEST:WRITE] add-existing-item
    test('increments existing item quantity', () => {
      fs.writeFileSync(pantryPath, '{"rice": 5}');
      const result = addItem(tmpDir, 'rice', 3);
      expect(result.total).toBe(8);
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] add-case-normalization
    test('normalizes item name to lowercase', () => {
      const result = addItem(tmpDir, 'Rice', 2);
      expect(result.name).toBe('rice');
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 2 });
    });

    // [TEST:WRITE] add-uppercase-normalization
    test('normalizes fully uppercase name to lowercase', () => {
      fs.writeFileSync(pantryPath, '{"rice": 5}');
      const result = addItem(tmpDir, 'RICE', 2);
      expect(result.name).toBe('rice');
      expect(result.total).toBe(7);
    });
  });

  describe('useItem', () => {
    // [TEST:WRITE] use-item-success
    test('decrements item quantity', () => {
      fs.writeFileSync(pantryPath, '{"rice": 8}');
      const result = useItem(tmpDir, 'rice', 4);
      expect(result.remaining).toBe(4);
      expect(result.name).toBe('rice');
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 4 });
    });

    // [TEST:WRITE] use-to-zero
    test('allows using entire stock, leaving quantity at 0', () => {
      fs.writeFileSync(pantryPath, '{"rice": 8}');
      const result = useItem(tmpDir, 'rice', 8);
      expect(result.remaining).toBe(0);
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 0 });
    });

    // [TEST:WRITE] use-insufficient-stock
    test('throws error when quantity exceeds stock', () => {
      fs.writeFileSync(pantryPath, '{"rice": 8}');
      expect(() => useItem(tmpDir, 'rice', 100)).toThrow(/insufficient/i);
      // File must be unchanged
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] use-nonexistent-item
    test('throws error when item does not exist', () => {
      fs.writeFileSync(pantryPath, '{"rice": 8}');
      expect(() => useItem(tmpDir, 'nonexistent', 1)).toThrow(/not found/i);
      // File must be unchanged
      const saved = JSON.parse(fs.readFileSync(pantryPath, 'utf-8'));
      expect(saved).toEqual({ rice: 8 });
    });

    // [TEST:WRITE] use-case-normalization
    test('normalizes item name to lowercase for lookup', () => {
      fs.writeFileSync(pantryPath, '{"rice": 8}');
      const result = useItem(tmpDir, 'RICE', 1);
      expect(result.name).toBe('rice');
      expect(result.remaining).toBe(7);
    });
  });

  describe('listItems', () => {
    // [TEST:WRITE] list-empty-missing-file
    test('returns empty array when pantry.json does not exist', () => {
      const items = listItems(tmpDir);
      expect(items).toEqual([]);
    });

    // [TEST:WRITE] list-empty-object
    test('returns empty array when pantry.json contains {}', () => {
      fs.writeFileSync(pantryPath, '{}');
      const items = listItems(tmpDir);
      expect(items).toEqual([]);
    });

    // [TEST:WRITE] list-alphabetical-order
    test('returns items sorted alphabetically by name', () => {
      fs.writeFileSync(pantryPath, '{"tea": 3, "rice": 8, "beans": 5}');
      const items = listItems(tmpDir);
      expect(items).toEqual([
        { name: 'beans', quantity: 5 },
        { name: 'rice', quantity: 8 },
        { name: 'tea', quantity: 3 },
      ]);
    });

    // [TEST:WRITE] list-single-item
    test('returns single item in array', () => {
      fs.writeFileSync(pantryPath, '{"rice": 5}');
      const items = listItems(tmpDir);
      expect(items).toEqual([{ name: 'rice', quantity: 5 }]);
    });
  });

  describe('low-stock detection', () => {
    // [TEST:WRITE] low-stock-items
    test('items with quantity < 2 are identifiable from list', () => {
      fs.writeFileSync(pantryPath, '{"rice": 1, "tea": 0, "beans": 5}');
      const items = listItems(tmpDir);
      const lowStock = items.filter(i => i.quantity < 2);
      expect(lowStock).toEqual([
        { name: 'rice', quantity: 1 },
        { name: 'tea', quantity: 0 },
      ]);
    });
  });
});
