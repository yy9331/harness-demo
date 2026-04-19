# Ralph 三角色循环工作流

基于 Anthropic 《Harness Design for Long-Running Apps》文章实现的全自动AI辅助前端开发工作流。

## 整体架构

```
┌─────────────┐
│  设计器 Designer  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  生成器 Generator  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  评价器 Evaluator  │
└──────┬──────┘
       │  不通过
       ▼
┌─────────────┐
│  生成器再次迭代  │
└─────────────┘
       │  通过
       ▼
    ✅ 完成
```

## 完整工作流程

### 第一步：设计阶段（Designer）

**输入**：`harness/design_spec.md` - 原始用户需求

**输出**：
- `harness/spec.md` - 结构化产品需求规格
- `harness/rubric.json` - 量化评估标准
- `harness/state.json` - 初始化迭代状态
- `harness/NEXT_PROMPT.md` - 给生成器的下一步提示

**运行方式**：

```bash
# Cursor 模式（推荐，在Cursor对话内分角色执行）
# 1. 在Cursor中切换到设计师角色，读取 design_spec.md，输出设计结果到 harness/_pending_design.json
# 2. 运行：
pnpm design

# API 模式（独立调用Anthropic API）
HARNESS_DESIGN_MODE=api pnpm design
```

### 第二步：实现阶段（Generator）

设计完成后，根据 `NEXT_PROMPT.md` 的提示，生成器在 `apps/web` 目录实现产品。

完成后结束本轮，由评价器接手。

### 第三步：评估阶段（Evaluator）

**输入**：`apps/web` 源码 + `harness/spec.md` + `harness/rubric.json`

**输出**：
- `harness/last_eval.json` - 评分结果
- `harness/last_critique.md` - 评审摘要
- `harness/NEXT_PROMPT.md` - 如果不通过，给出具体改进项给下一轮生成器
- `harness/progress.md` - 追加迭代进度记录

**运行方式**：

```bash
# Cursor 模式（推荐）
# 在Cursor中切换到评价器角色，输出评测结果到 harness/_pending_eval.json，然后运行：
pnpm finalize

# API 模式
HARNESS_EVAL_MODE=api pnpm eval
```

### 循环迭代

如果评价不通过，生成器根据 `NEXT_PROMPT.md` 中的改进项进行修改，然后再次评价。如此循环，直到评价通过或达到最大迭代次数。

## 环境变量

- `HARNESS_DESIGN_MODE` - `cursor`（默认）或 `api`
- `HARNESS_EVAL_MODE` - `cursor`（默认）或 `api`
- `ANTHROPIC_API_KEY` - 使用 API 模式时需要

## 文件说明

| 文件 | 作用 |
|------|------|
| `harness/design_spec.md` | 原始用户需求，由人工填写 |
| `harness/spec.md` | 结构化产品规格，由设计器生成 |
| `harness/rubric.json` | 评估标准，由设计器生成 |
| `harness/state.json` | 迭代状态，维护当前迭代次数等 |
| `harness/_pending_design.json` | 设计器临时输出（cursor模式），用完即删 |
| `harness/_pending_eval.json` | 评价器临时输出（cursor模式），用完即删 |
| `harness/last_design.json` | 最后一次设计结果 |
| `harness/last_eval.json` | 最后一次评测结果 |
| `harness/last_critique.md` | 最后一次评审摘要 |
| `harness/NEXT_PROMPT.md` | 下一步提示，给下一个角色 |
| `harness/progress.md` | 迭代进度日志 |
| `harness/.ralph-enabled` | 标记启用Ralph循环 |

## 角色职责

### 设计器 Designer
- 从模糊的原始需求产出结构化的产品规格
- 制定可量化的评估标准
- 初始化整个项目状态

### 生成器 Generator
- 根据产品规格用代码实现功能
- 只修改 `apps/web` 目录
- 根据评价器的反馈迭代改进

### 评价器 Evaluator
- 对照规格和评估标准逐条打分
- 要求具体、挑剔、有建设性
- 不通过时给出明确的改进行动项
- 直到所有标准都满足要求

## 符合 Anthropic Harness 设计原则

1. ✅ **角色分离** - 设计、实现、评估三个角色完全分离
2. ✅ **明确评估标准** - 包括主观标准（美感、原创性）也量化评分
3. ✅ **自动化循环** - 评价不通过自动触发下一轮生成
4. ✅ **可追溯性** - 每轮迭代结果都记录在案
5. ✅ **灵活模式** - 支持Cursor内部分轮执行，也支持独立API调用
6. ✅ **最大迭代限制** - 避免无限循环，`state.json` 中可配置 `max_iterations`

## 完整全自动循环

开启 `harness/.ralph-enabled` 后，配合 Cursor stop hook，可以实现：

1. 设计器输出设计 → 自动初始化
2. 生成器完成实现 → 自动触发评价
3. 评价不通过 → 自动生成改进提示给生成器
4. 重复直到通过或达到最大次数

整个过程无需人工干预，人工只需要提供初始需求和查看最终结果。