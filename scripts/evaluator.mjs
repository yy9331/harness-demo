#!/usr/bin/env node
/**
 * Harness Evaluator entry.
 *
 * Two modes (controlled by HARNESS_EVAL_MODE, default `cursor`):
 *
 *   - `cursor` (default): no API call. Reads an in-chat evaluator output
 *      (`harness/_pending_eval.json` or `harness/last_eval.json`) and runs the
 *      shared finalize pipeline. See `scripts/finalize.mjs`.
 *
 *   - `api` (legacy): calls Anthropic Messages API as a separate evaluator
 *      role. Requires `ANTHROPIC_API_KEY`. Useful if you want a fully
 *      independent process (different model run) outside the Cursor Agent.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessage, getModel } from './lib/anthropic.mjs';
import { finalizeArtifacts } from './lib/artifacts.mjs';
import { loadDotEnv } from './lib/env.mjs';
import { runFinalize } from './finalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..');

const MAX_FILE_BYTES = 24_000;
const ALLOW_EXT = new Set(['.tsx', '.ts', '.css']);

function resolveRoot(argvPath) {
  if (argvPath) return argvPath;
  return DEFAULT_ROOT;
}

function resolveMode() {
  const m = (process.env.HARNESS_EVAL_MODE || 'cursor').trim().toLowerCase();
  return m === 'api' ? 'api' : 'cursor';
}

function walkSrcFiles(dir) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkSrcFiles(p).forEach((f) => out.push(f));
      continue;
    }
    const dot = ent.name.lastIndexOf('.');
    const ext = dot >= 0 ? ent.name.slice(dot) : '';
    if (!ALLOW_EXT.has(ext)) continue;
    out.push(p);
  }
  return out;
}

function readBoundedFile(absPath) {
  const buf = readFileSync(absPath);
  const raw = buf.toString('utf8');
  if (raw.length > MAX_FILE_BYTES) {
    return `${raw.slice(0, MAX_FILE_BYTES)}\n\n/* ... truncated (${raw.length} chars total) ... */\n`;
  }
  return raw;
}

function buildSourceBundle(repoRoot) {
  const srcRoot = join(repoRoot, 'apps', 'web', 'src');
  const files = walkSrcFiles(srcRoot).sort();
  const parts = [];
  for (const abs of files) {
    const rel = relative(repoRoot, abs).split('\\').join('/');
    parts.push(`### FILE: ${rel}\n\n\`\`\`\n${readBoundedFile(abs)}\n\`\`\`\n`);
  }
  const pkgPath = join(repoRoot, 'apps', 'web', 'package.json');
  if (existsSync(pkgPath)) {
    parts.unshift(
      `### FILE: apps/web/package.json\n\n\`\`\`json\n${readBoundedFile(pkgPath)}\n\`\`\`\n`,
    );
  }
  return parts.join('\n');
}

function extractJsonObject(text) {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const body = fence ? fence[1].trim() : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Evaluator did not return a JSON object.');
  }
  return JSON.parse(body.slice(start, end + 1));
}

async function runApiEval(repoRoot) {
  loadDotEnv(repoRoot);

  const specPath = join(repoRoot, 'harness', 'spec.md');
  const rubricPath = join(repoRoot, 'harness', 'rubric.json');
  const statePath = join(repoRoot, 'harness', 'state.json');

  if (!existsSync(specPath) || !existsSync(rubricPath)) {
    throw new Error('Missing harness/spec.md or harness/rubric.json');
  }

  const spec = readFileSync(specPath, 'utf8');
  const rubricRaw = JSON.parse(readFileSync(rubricPath, 'utf8'));
  const criteria = rubricRaw.criteria;
  if (!Array.isArray(criteria)) throw new Error('rubric.json: expected criteria array');

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const nextIteration = Number(state.iteration) || 0;

  const sourceBundle = buildSourceBundle(repoRoot);

  const system = `You are an independent evaluator (not the implementer). You review a small React+Vite frontend against a product spec and a scoring rubric.

Rules:
- Output MUST be a single JSON object only. No markdown fences, no prose outside JSON.
- Be skeptical and specific. Prefer concrete, actionable findings.
- Scores are integers 0-10.
- For each rubric criterion id listed in the user message, you MUST include one entry in the "criteria" array with fields: id, name, score, pass, rationale.
- "pass" for a criterion MUST be true iff score >= the pass_score given for that id in the rubric.

JSON shape:
{
  "summary": string,
  "criteria": [ { "id": string, "name": string, "score": number, "pass": boolean, "rationale": string } ],
  "action_items": string[],
  "pass_all": boolean
}

Set "pass_all" to true only if every criterion passes.`;

  const rubricBrief = criteria
    .map(
      (c) =>
        `- id=${JSON.stringify(c.id)} name=${JSON.stringify(c.name)} pass_score=${c.pass_score} weight=${c.weight ?? 1}`,
    )
    .join('\n');

  const user = `## Product spec (Markdown)\n\n${spec}\n\n## Rubric criteria (pass scores)\n\n${rubricBrief}\n\n## Codebase (whitelisted files)\n\n${sourceBundle}`;

  const raw = await createMessage({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 6144,
  });

  let parsed;
  try {
    parsed = extractJsonObject(raw);
  } catch (e) {
    const errObj = {
      status: 'parse_error',
      raw_excerpt: raw.slice(0, 4000),
      error: String(e?.message || e),
      at: new Date().toISOString(),
    };
    writeFileSync(
      join(repoRoot, 'harness', 'last_eval.json'),
      JSON.stringify(errObj, null, 2),
      'utf8',
    );
    const st = JSON.parse(readFileSync(statePath, 'utf8'));
    st.iteration = nextIteration + 1;
    st.last_run_at = new Date().toISOString();
    st.last_error = errObj.error;
    st.pass_all = false;
    writeFileSync(statePath, JSON.stringify(st, null, 2), 'utf8');
    throw e;
  }

  return finalizeArtifacts(repoRoot, parsed, { modelLabel: getModel() });
}

/**
 * Public entry used by the stop hook and CLI. Picks mode from env.
 * @param {string} repoRoot
 */
export async function runEval(repoRoot) {
  const mode = resolveMode();
  if (mode === 'api') return runApiEval(repoRoot);
  return runFinalize(repoRoot);
}

async function main() {
  const root = resolveRoot(process.argv[2]);
  try {
    const r = await runEval(root);
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: resolveMode(),
          iteration: r.iteration,
          pass_all: r.passAll,
          summary: r.evalOut.summary,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error(String(e?.message || e));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]?.endsWith('evaluator.mjs');
if (isMain) {
  main();
}
