#!/usr/bin/env node
/**
 * Cursor Agent path: post-process an evaluator output written in-chat.
 *
 * Workflow:
 *   1. Generator (Cursor Agent) edits apps/web in one turn.
 *   2. Evaluator (Cursor Agent, separate turn / response) writes a raw eval JSON
 *      to one of:
 *        - harness/_pending_eval.json  (preferred; ignored input file)
 *        - harness/last_eval.json      (already in final shape; will be re-finalized)
 *   3. Run `pnpm finalize` (or let the stop hook do it) to:
 *        - recompute pass via rubric.json
 *        - rewrite last_critique.md / NEXT_PROMPT.md
 *        - bump state.json iteration / pass_all / last_run_at
 *        - append progress.md
 *
 * Required raw eval shape (minimal):
 *   {
 *     "summary": string,
 *     "criteria": [ { "id": string, "name"?: string, "score": number, "rationale": string } ],
 *     "action_items"?: string[],
 *     "pass_all"?: boolean
 *   }
 */
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finalizeArtifacts } from './lib/artifacts.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..');

const DEFAULT_MODEL_LABEL = 'cursor-agent-evaluator';

function resolveRoot(argvPath) {
  if (argvPath) return argvPath;
  return DEFAULT_ROOT;
}

function pickInputPath(repoRoot, explicit) {
  if (explicit) return explicit;
  const pending = join(repoRoot, 'harness', '_pending_eval.json');
  if (existsSync(pending)) return pending;
  return join(repoRoot, 'harness', 'last_eval.json');
}

export function runFinalize(repoRoot, { inputPath, modelLabel } = {}) {
  const pendingPath = join(repoRoot, 'harness', '_pending_eval.json');
  const inPath = pickInputPath(repoRoot, inputPath);
  if (!existsSync(inPath)) {
    throw new Error(
      `Missing evaluator input. Expected harness/_pending_eval.json or harness/last_eval.json at ${inPath}.`,
    );
  }
  const raw = JSON.parse(readFileSync(inPath, 'utf8'));
  if (!raw || typeof raw !== 'object') {
    throw new Error('Evaluator input is not a JSON object.');
  }
  if (!Array.isArray(raw.criteria)) {
    throw new Error('Evaluator input is missing `criteria` array.');
  }
  const out = finalizeArtifacts(repoRoot, raw, {
    modelLabel: modelLabel || raw.model || DEFAULT_MODEL_LABEL,
  });
  // Consume staging file so a later `stop` does not re-run finalize on stale input.
  if (inPath === pendingPath && existsSync(pendingPath)) {
    unlinkSync(pendingPath);
  }
  return out;
}

async function main() {
  const root = resolveRoot(process.argv[2]);
  try {
    const r = runFinalize(root);
    console.log(
      JSON.stringify(
        {
          ok: true,
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

const isMain = process.argv[1]?.endsWith('finalize.mjs');
if (isMain) {
  main();
}
