#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const smoke = args.has('--smoke');
const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
const projectRoot = resolve(skillDir, '../../..');
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

const required = [
  'package.json',
  'apps/cli/src/index.ts',
  'apps/mcp/src/index.ts',
  'packages/search-core/src/engine.ts',
  '.claude/skills/researching-with-ai/SKILL.md',
  '.claude/skills/researching-with-ai/references/provider-capabilities.md',
  '.claude/skills/researching-with-ai/references/search-quality.md',
];

for (const path of required) {
  check(`file:${path}`, existsSync(join(projectRoot, path)), path);
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
check('node', nodeMajor >= 20, `Node ${process.versions.node} (requires >=20)`);

try {
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  check('manifest', manifest.name === 'cairn', `package name: ${manifest.name ?? 'missing'}`);
} catch (error) {
  check('manifest', false, error instanceof Error ? error.message : String(error));
}

const artifacts = ['apps/cli/dist/index.js', 'apps/mcp/dist/index.js'];
for (const path of artifacts) {
  checks.push({
    name: `artifact:${path}`,
    ok: existsSync(join(projectRoot, path)),
    warning: true,
    detail: existsSync(join(projectRoot, path)) ? 'built' : 'not built; run corepack pnpm build',
  });
}

let smokeResult;
if (smoke) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'cairn-health-'));
  try {
    const smokeArgs = [
      'pnpm',
      '--filter',
      '@cairn/cli',
      'exec',
      'tsx',
      'src/index.ts',
      'search',
      'Explain citation validation',
      '--provider',
      'mock',
      '--json',
    ];
    const isWindows = process.platform === 'win32';
    const command = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'corepack';
    const commandArgs = isWindows
      ? ['/d', '/c', 'corepack', ...smokeArgs]
      : smokeArgs;
    const run = spawnSync(command, commandArgs, {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CAIRN_MOCK: '1',
        CAIRN_DB_PATH: join(tempRoot, 'healthcheck.db'),
      },
      timeout: 60_000,
    });
    const stdout = run.stdout ?? '';
    const stderr = run.stderr ?? run.error?.message ?? '';
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = null;
    }
    const ok = run.status === 0
      && parsed?.status === 'completed'
      && Array.isArray(parsed?.citations)
      && parsed.citations.length > 0;
    smokeResult = {
      ok,
      status: run.status,
      sessionStatus: parsed?.status,
      citationCount: parsed?.citations?.length ?? 0,
      stderr: stderr.trim() || undefined,
    };
    check('mock-smoke', ok, ok ? 'Mock search completed with citations' : 'Mock search failed');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const failures = checks.filter((item) => !item.ok && !item.warning);
const warnings = checks.filter((item) => !item.ok && item.warning);
const result = {
  ok: failures.length === 0,
  projectRoot,
  checks,
  failures: failures.length,
  warnings: warnings.length,
  smoke: smokeResult,
};

if (json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`Cairn research skill: ${result.ok ? 'healthy' : 'unhealthy'}\n`);
  for (const item of checks) {
    const mark = item.ok ? 'OK' : item.warning ? 'WARN' : 'FAIL';
    process.stdout.write(`[${mark}] ${item.name}: ${item.detail}\n`);
  }
}

process.exitCode = result.ok ? 0 : 1;
