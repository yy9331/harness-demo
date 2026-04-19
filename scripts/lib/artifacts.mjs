/**
 * Deterministic post-processing for harness artifacts.
 *
 * Shared by:
 *   - scripts/evaluator.mjs   (`api` 模式：Anthropic；`cursor` 模式：转调 finalize，无 API）
 *   - scripts/finalize.mjs    （Cursor 评审产物 → harness 文件）
 *   - .cursor/hooks/ralph-stop.mjs
 *
 * Inputs:
 *   - parsedEvalJson: object that the "evaluator" produced. Required fields:
 *       summary: string
 *       criteria: Array<{ id, score, rationale, name? }>
 *       action_items?: string[]
 *       pass_all?: boolean        // model self-claim, recorded but recomputed
 *
 * The rubric (`harness/rubric.json`) is the source of truth for `pass_score`,
 * `weight`, and the canonical `name` of each criterion. Pass status is always
 * recomputed here, never trusted from the evaluator.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildCritiqueMarkdown(evalJson, modelLabel) {
  const lines = [`# 评审摘要（模型输出）`, '', `**模型**: ${modelLabel}`, ''];
  lines.push(`**总评**: ${evalJson.summary || '(无)'}`, '');
  if (Array.isArray(evalJson.criteria)) {
    for (const c of evalJson.criteria) {
      lines.push(`## ${c.name || c.id}`);
      lines.push(`- 分数: **${c.score}** / 10`);
      lines.push(`- 通过: **${c.pass ? '是' : '否'}**`);
      lines.push(`- 说明: ${c.rationale || ''}`, '');
    }
  }
  if (Array.isArray(evalJson.action_items) && evalJson.action_items.length) {
    lines.push('## 行动项', ...evalJson.action_items.map((x) => `- ${x}`), '');
  }
  return lines.join('\n');
}

export function buildNextPrompt(evalJson, passAll, iteration, maxIt) {
  if (passAll) {
    return [
      '# Ralph：本轮已通过',
      '',
      '评测认为已满足 `harness/rubric.json` 与 `harness/spec.md` 的主要要求。如需继续打磨体验，可说明新目标；否则可关闭 Ralph（删除 `harness/.ralph-enabled`）。',
    ].join('\n');
  }
  if (iteration >= maxIt) {
    return [
      '# Ralph：达到最大迭代次数',
      '',
      `当前 iteration=${iteration}，max=${maxIt}。请人工检查 \`harness/last_eval.json\` 与 \`harness/last_critique.md\`，决定重置 state 或调整 spec/rubric。`,
    ].join('\n');
  }
  const items = (evalJson.action_items || []).map((x) => `- ${x}`).join('\n');
  return [
    '# Ralph 跟进（Evaluator → Generator）',
    '',
    '请先阅读 `harness/last_eval.json` 与 `harness/last_critique.md`，然后只修改 `apps/web` 下代码以满足 spec 与 rubric。',
    '',
    '## 行动项（摘要）',
    items || '- （见 last_critique.md）',
    '',
    '完成后结束本轮 Agent；下一轮由 Evaluator 角色重新打分。',
  ].join('\n');
}

/**
 * Recompute pass per rubric, write all derived files, advance state.json,
 * append progress.md. Returns { evalOut, passAll, iteration, maxIt }.
 *
 * @param {string} repoRoot
 * @param {object} parsedEvalJson  raw output from the evaluator role
 * @param {{ modelLabel: string }} opts
 */
export function finalizeArtifacts(repoRoot, parsedEvalJson, { modelLabel }) {
  const rubricPath = join(repoRoot, 'harness', 'rubric.json');
  const statePath = join(repoRoot, 'harness', 'state.json');

  const rubricRaw = JSON.parse(readFileSync(rubricPath, 'utf8'));
  const criteria = rubricRaw.criteria;
  if (!Array.isArray(criteria)) throw new Error('rubric.json: expected criteria array');

  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const maxIt = Number(state.max_iterations) || 12;
  const prevIteration = Number(state.iteration) || 0;

  const byId = new Map((parsedEvalJson.criteria || []).map((c) => [c.id, c]));
  const mergedCriteria = criteria.map((c) => {
    const row = byId.get(c.id) || {};
    const score = Math.max(0, Math.min(10, Math.round(Number(row.score) || 0)));
    const pass = score >= Number(c.pass_score);
    return {
      id: c.id,
      name: c.name,
      weight: c.weight ?? 1,
      pass_score: c.pass_score,
      score,
      pass,
      rationale: row.rationale || '',
    };
  });

  const passAllComputed = mergedCriteria.every((c) => c.pass);
  const at = new Date().toISOString();
  const iteration = prevIteration + 1;

  const evalOut = {
    status: 'ok',
    at,
    model: modelLabel,
    iteration,
    summary: parsedEvalJson.summary || '',
    criteria: mergedCriteria,
    pass_all: passAllComputed,
    pass_all_model: Boolean(parsedEvalJson.pass_all),
    action_items: Array.isArray(parsedEvalJson.action_items) ? parsedEvalJson.action_items : [],
  };

  writeFileSync(
    join(repoRoot, 'harness', 'last_eval.json'),
    JSON.stringify(evalOut, null, 2),
    'utf8',
  );

  const critique = buildCritiqueMarkdown(evalOut, modelLabel);
  writeFileSync(join(repoRoot, 'harness', 'last_critique.md'), critique, 'utf8');

  const nextPrompt = buildNextPrompt(evalOut, passAllComputed, iteration, maxIt);
  writeFileSync(join(repoRoot, 'harness', 'NEXT_PROMPT.md'), nextPrompt, 'utf8');

  const stNext = {
    ...state,
    iteration,
    last_run_at: at,
    pass_all: passAllComputed,
    last_error: null,
  };
  writeFileSync(statePath, JSON.stringify(stNext, null, 2), 'utf8');

  const logLine = `\n## ${at} — iteration ${iteration} — pass_all=${passAllComputed}\n\n${evalOut.summary}\n`;
  appendFileSync(join(repoRoot, 'harness', 'progress.md'), logLine, 'utf8');

  return { evalOut, passAll: passAllComputed, iteration, maxIt, nextPrompt };
}
