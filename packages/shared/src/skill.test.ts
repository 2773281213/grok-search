import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const skillRoot = resolve(projectRoot, '.claude/skills/researching-with-ai');
const skillPath = resolve(skillRoot, 'SKILL.md');

describe('researching-with-ai project skill', () => {
  it('has valid concise frontmatter and a matching folder name', () => {
    const text = readFileSync(skillPath, 'utf8');
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter?.[1]).toMatch(/^name: researching-with-ai$/m);
    expect(frontmatter?.[1]).toMatch(/^description: .*(verify|current|compare|investigate|source)/mi);
    expect(text.split(/\r?\n/).length).toBeLessThan(500);
  });

  it('keeps every first-level Markdown reference resolvable', () => {
    const text = readFileSync(skillPath, 'utf8');
    const links = [...text.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)].map((match) => match[1]!);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const link of links) expect(existsSync(resolve(skillRoot, link))).toBe(true);
  });

  it('defines five canonical trigger cases', () => {
    const text = readFileSync(resolve(skillRoot, 'references/trigger-tests.md'), 'utf8');
    expect(text.match(/^### \d+\./gm)).toHaveLength(5);
    for (const phrase of ['Latest software API', 'Compare technical approaches', 'Investigate recent news', 'GitHub Issue', 'disputed claim']) {
      expect(text).toContain(phrase);
    }
  });

  it('healthcheck returns machine-readable success without paid calls', () => {
    const run = spawnSync(process.execPath, [resolve(skillRoot, 'scripts/healthcheck.mjs'), '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty('smoke');
  });
});
