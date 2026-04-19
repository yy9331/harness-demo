#!/usr/bin/env node
/**
 * Harness Designer entry.
 *
 * Workflow:
 *   1. Designer reads raw user requirements from `harness/design_spec.md`
 *   2. Designer produces structured product spec (`harness/spec.md`) and
 *      evaluation rubric (`harness/rubric.json`)
 *   3. Initialize `harness/state.json` for iteration loop
 *   4. Then Generator can start implementing according to the spec
 *
 * Two modes (controlled by HARNESS_DESIGN_MODE, default `cursor`):
 *   - `cursor` (default): no API call. Designer acts as a separate role in Cursor chat,
 *     writes raw output to `harness/_pending_design.json`, then this script finalizes.
 *   - `api`: calls Anthropic Messages API as an independent designer process.
 *     Requires `ANTHROPIC_API_KEY`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessage, getModel } from './lib/anthropic.mjs';
import { loadDotEnv } from './lib/env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, '..');

function resolveRoot(argvPath) {
  if (argvPath) return argvPath;
  return DEFAULT_ROOT;
}

function resolveMode() {
  const m = (process.env.HARNESS_DESIGN_MODE || 'cursor').trim().toLowerCase();
  return m === 'api' ? 'api' : 'cursor';
}

function extractJsonObject(text) {
  const t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const body = fence ? fence[1].trim() : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Designer did not return a JSON object.');
  }
  return JSON.parse(body.slice(start, end + 1));
}

async function runApiDesign(repoRoot) {
  loadDotEnv(repoRoot);

  const designSpecPath = join(repoRoot, 'harness', 'design_spec.md');
  if (!existsSync(designSpecPath)) {
    throw new Error('Missing harness/design_spec.md: please put your raw user requirements here.');
  }

  const rawRequirements = readFileSync(designSpecPath, 'utf8');

  const system = `You are an experienced product designer (not the implementer). You convert raw user requirements into a structured product spec and evaluation rubric for a frontend project.

Rules:
- Output MUST be a single JSON object only. No prose outside JSON.
- The project is a Vite + React + TypeScript frontend app.
- Be specific about what features need to be implemented.
- Create evaluation criteria that cover both functionality and quality.

JSON shape:
{
  "spec": {
    "title": string,
    "description": string,
    "goals": string[],
    "features_mvp": { id: string, description: string }[],
    "features_extension": { id: string, description: string }[],
    "technical_constraints": string[],
    "non_goals": string[]
  },
  "rubric": {
    "criteria": {
      id: string,
      name: string,
      description: string,
      weight: number,
      pass_score: number
    }[]
  }
}

Scores are 0-10, pass_score is typically 6-7 depending on importance.
Weight should be 1.0-1.5; more important criteria get higher weight.`;

  const user = `## Raw user requirements\n\n${rawRequirements}`;

  const raw = await createMessage({
    system,
    messages: [{ role: 'user', content: user }],
    max_tokens: 8192,
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
      join(repoRoot, 'harness', 'last_design.json'),
      JSON.stringify(errObj, null, 2),
      'utf8',
    );
    throw e;
  }

  return finalizeDesign(repoRoot, parsed, { modelLabel: getModel() });
}

function buildSpecMarkdown(spec) {
  const lines = [];

  lines.push(`# ${spec.title}`);
  lines.push('');
  lines.push(spec.description);
  lines.push('');

  if (spec.goals && spec.goals.length > 0) {
    lines.push('## 目标');
    lines.push('');
    for (const goal of spec.goals) {
      lines.push(`- ${goal}`);
    }
    lines.push('');
  }

  if (spec.features_mvp && spec.features_mvp.length > 0) {
    lines.push('## 功能（MVP 基线）');
    lines.push('');
    let counter = 1;
    for (const f of spec.features_mvp) {
      lines.push(`${counter}. ${f.description}`);
      counter++;
    }
    lines.push('');
  }

  if (spec.features_extension && spec.features_extension.length > 0) {
    lines.push('## 功能（扩展 — 本轮迭代）');
    lines.push('');
    let counter = 1;
    for (const f of spec.features_extension) {
      lines.push(`${counter}. ${f.description}`);
      counter++;
    }
    lines.push('');
  }

  if (spec.technical_constraints && spec.technical_constraints.length > 0) {
    lines.push('## 技术约束');
    lines.push('');
    for (const c of spec.technical_constraints) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (spec.non_goals && spec.non_goals.length > 0) {
    lines.push('## 非目标');
    lines.push('');
    for (const ng of spec.non_goals) {
      lines.push(`- ${ng}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function buildRubricJson(parsedRubric) {
  return {
    version: 1,
    criteria: parsedRubric.criteria.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      weight: c.weight,
      pass_score: c.pass_score,
    })),
    notes: 'Evaluator 需逐条打分并给出 pass/fail；权重高的标准更重要。',
  };
}

function finalizeDesign(repoRoot, parsed, { modelLabel }) {
  // Generate spec.md
  const specMd = buildSpecMarkdown(parsed.spec);
  writeFileSync(join(repoRoot, 'harness', 'spec.md'), specMd, 'utf8');

  // Generate rubric.json
  const rubric = buildRubricJson(parsed.rubric);
  writeFileSync(join(repoRoot, 'harness', 'rubric.json'), JSON.stringify(rubric, null, 2), 'utf8');

  // Initialize state.json
  const initialState = {
    iteration: 0,
    max_iterations: 12,
    pass_all: false,
    last_run_at: null,
    last_error: null,
  };
  writeFileSync(join(repoRoot, 'harness', 'state.json'), JSON.stringify(initialState, null, 2), 'utf8');

  // Write designer output
  const out = {
    status: 'ok',
    at: new Date().toISOString(),
    model: modelLabel,
    spec: parsed.spec,
    rubric: parsed.rubric,
  };
  writeFileSync(join(repoRoot, 'harness', 'last_design.json'), JSON.stringify(out, null, 2), 'utf8');

  // Ensure .ralph-enabled exists for full loop
  touchFile(join(repoRoot, 'harness', '.ralph-enabled'));

  // Generate NEXT_PROMPT for Generator
  const nextPrompt = `# Ralph：设计已完成，请开始实现

设计器已生成：
- \`harness/spec.md\`: 产品需求规格
- \`harness/rubric.json\`: 评估标准

请按照 spec.md 的要求，在 \`apps/web\` 目录中实现产品。完成后结束本轮，由 Evaluator 进行评估。

迭代次数从 0 开始，祝你好运！`;
  writeFileSync(join(repoRoot, 'harness', 'NEXT_PROMPT.md'), nextPrompt, 'utf8');

  // Initialize progress.md
  const progressIntro = `# Harness 进度笔记

由 \`scripts/evaluator.mjs\` 与 \`.cursor/hooks/ralph-stop.mjs\` 在每轮评测后追加摘要。

（首轮运行前为空。）
`;
  writeFileSync(join(repoRoot, 'harness', 'progress.md'), progressIntro, 'utf8');

  return { spec: parsed.spec, rubric: parsed.rubric };
}

function touchFile(path) {
  if (!existsSync(path)) {
    writeFileSync(path, '', 'utf8');
  }
}

/**
 * Public entry. Picks mode from env.
 * @param {string} repoRoot
 */
export async function runDesign(repoRoot) {
  const mode = resolveMode();
  if (mode === 'api') return runApiDesign(repoRoot);

  // cursor mode: read _pending_design.json from in-chat designer role and finalize
  const pendingPath = join(repoRoot, 'harness', '_pending_design.json');
  if (!existsSync(pendingPath)) {
    throw new Error('Missing harness/_pending_design.json. In cursor mode, designer role must output the design to this file.');
  }

  const pending = JSON.parse(readFileSync(pendingPath, 'utf8'));
  const result = finalizeDesign(repoRoot, pending, {
    modelLabel: pending.model || 'cursor-agent-designer',
  });

  // Consume pending file
  const { unlinkSync } = require('node:fs');
  unlinkSync(pendingPath);

  return result;
}

async function main() {
  const root = resolveRoot(process.argv[2]);
  try {
    const r = await runDesign(root);
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: resolveMode(),
          spec_title: r.spec.title,
          criteria_count: r.rubric.criteria.length,
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

const isMain = process.argv[1]?.endsWith('designer.mjs');
if (isMain) {
  main();
}