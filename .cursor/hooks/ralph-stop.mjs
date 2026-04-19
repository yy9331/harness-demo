#!/usr/bin/env node
/**
 * Cursor `stop` hook for the harness loop.
 *
 * Behavior depends on HARNESS_EVAL_MODE (default `cursor`):
 *   - cursor: if `HARNESS_FINALIZE_ON_STOP` is not `0`/`false` and
 *     `harness/_pending_eval.json` exists, run finalize (deterministic
 *     post-process) and possibly emit `followup_message`. Otherwise emit `{}`.
 *     No API call is ever made.
 *   - api: when `harness/.ralph-enabled` exists, call the Anthropic-based
 *     evaluator and emit `followup_message` if not yet pass_all.
 *
 * In both modes, when Ralph is off (no `.ralph-enabled` file) the hook does
 * nothing besides printing `{}`, which is a valid JSON ack.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function writeOut(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function resolveRoot(payload) {
  const roots = payload?.workspace_roots;
  if (Array.isArray(roots) && roots[0] && typeof roots[0] === 'string') {
    return roots[0];
  }
  return process.cwd();
}

function resolveMode() {
  const m = (process.env.HARNESS_EVAL_MODE || 'cursor').trim().toLowerCase();
  return m === 'api' ? 'api' : 'cursor';
}

function finalizeOnStopEnabled() {
  const v = (process.env.HARNESS_FINALIZE_ON_STOP ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    writeOut({});
    return;
  }

  const root = resolveRoot(payload);
  const flag = join(root, 'harness', '.ralph-enabled');

  if (!existsSync(flag)) {
    writeOut({});
    return;
  }

  const mode = resolveMode();

  if (mode === 'cursor') {
    if (!finalizeOnStopEnabled()) {
      writeOut({});
      return;
    }
    const pending = join(root, 'harness', '_pending_eval.json');
    if (!existsSync(pending)) {
      writeOut({});
      return;
    }
    try {
      const finalizeUrl = pathToFileURL(join(root, 'scripts', 'finalize.mjs')).href;
      const { runFinalize } = await import(finalizeUrl);
      runFinalize(root);
    } catch (e) {
      console.error('[ralph-stop:cursor]', e?.message || e);
      writeOut({});
      return;
    }
  } else {
    try {
      const evaluatorUrl = pathToFileURL(join(root, 'scripts', 'evaluator.mjs')).href;
      const { runEval } = await import(evaluatorUrl);
      await runEval(root);
    } catch (e) {
      console.error('[ralph-stop:api]', e?.message || e);
      writeOut({});
      return;
    }
  }

  let state;
  try {
    state = JSON.parse(readFileSync(join(root, 'harness', 'state.json'), 'utf8'));
  } catch {
    writeOut({});
    return;
  }

  const maxIt = Number(state.max_iterations) || 12;
  const iter = Number(state.iteration) || 0;
  const passAll = Boolean(state.pass_all);

  if (passAll || iter >= maxIt) {
    writeOut({});
    return;
  }

  let followup = '';
  try {
    followup = readFileSync(join(root, 'harness', 'NEXT_PROMPT.md'), 'utf8').trim();
  } catch {
    followup =
      '请阅读 harness/last_eval.json 与 harness/last_critique.md，在 apps/web 中修复未通过项，然后结束本轮。';
  }

  writeOut({ followup_message: followup });
}

main().catch((e) => {
  console.error('[ralph-stop]', e);
  writeOut({});
});
