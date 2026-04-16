import { describe, expect, it } from 'vitest';
import { createDbConnectionTool } from '../../../src/tools/builtin/db-connection.js';

describe('DbConnectionTool', () => {
  it('rejects multi-statement read-only bypass attempts', async () => {
    const tool = createDbConnectionTool({ connectionString: 'postgres://localhost/db' });

    const result = await tool.execute({ query: 'SELECT * FROM users; DROP TABLE users;' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('single read-only statement');
  });
});
