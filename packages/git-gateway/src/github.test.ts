import { describe, expect, it } from 'vitest';
import { isAllowedGithubPath } from './github.js';

describe('isAllowedGithubPath', () => {
  it('allows git/* paths', () => {
    expect(isAllowedGithubPath('git/refs/heads/main')).toBe(true);
  });

  it('allows contents/* paths', () => {
    expect(isAllowedGithubPath('contents/README.md')).toBe(true);
  });

  it('allows pulls collection and sub-paths', () => {
    expect(isAllowedGithubPath('pulls')).toBe(true);
    expect(isAllowedGithubPath('pulls/123')).toBe(true);
    expect(isAllowedGithubPath('pulls?state=open')).toBe(true);
  });

  it('allows branches collection and sub-paths', () => {
    expect(isAllowedGithubPath('branches')).toBe(true);
    expect(isAllowedGithubPath('branches/main')).toBe(true);
  });

  it('allows merges', () => {
    expect(isAllowedGithubPath('merges')).toBe(true);
  });

  it('allows commits collection and sub-paths', () => {
    expect(isAllowedGithubPath('commits')).toBe(true);
    expect(isAllowedGithubPath('commits/abc123')).toBe(true);
  });

  describe('issues/:n/labels', () => {
    it('allows labels collection endpoint', () => {
      expect(isAllowedGithubPath('issues/42/labels')).toBe(true);
    });

    it('allows specific label removal endpoint (DELETE /issues/:n/labels/:name)', () => {
      expect(isAllowedGithubPath('issues/42/labels/In-Review')).toBe(true);
    });

    it('denies extra segment beyond label name', () => {
      expect(isAllowedGithubPath('issues/42/labels/foo/bar')).toBe(false);
    });
  });

  it('denies /user', () => {
    expect(isAllowedGithubPath('user')).toBe(false);
  });

  it('denies /orgs', () => {
    expect(isAllowedGithubPath('orgs/acme')).toBe(false);
  });

  it('denies /admin', () => {
    expect(isAllowedGithubPath('admin/hooks')).toBe(false);
  });

  it('strips leading slash before matching', () => {
    expect(isAllowedGithubPath('/issues/1/labels')).toBe(true);
    expect(isAllowedGithubPath('/issues/1/labels/bug')).toBe(true);
    expect(isAllowedGithubPath('/user')).toBe(false);
  });
});
