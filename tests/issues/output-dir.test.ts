import { describe, expect, it } from 'vitest';
import { issueOutputDirName } from '../../src/issues/output-dir.js';

describe('issueOutputDirName', () => {
  it('uses GitHub issue number as the default output directory name', () => {
    expect(issueOutputDirName({
      githubIssueUrl: 'https://github.com/openai/codex/issues/123',
    })).toBe('123');
  });

  it('uses YouTrack readable issue id as the default output directory name', () => {
    expect(issueOutputDirName({
      youtrackIssueUrl: 'https://wcmc.myjetbrains.com/youtrack/issue/MAP-123/Title',
    })).toBe('MAP-123');
  });

  it('uses bare YouTrack issue ids directly', () => {
    expect(issueOutputDirName({ youtrackIssueUrl: 'map-123' })).toBe('MAP-123');
  });

  it('returns undefined without an issue source', () => {
    expect(issueOutputDirName({})).toBeUndefined();
  });
});
