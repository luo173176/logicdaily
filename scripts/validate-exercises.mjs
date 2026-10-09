#!/usr/bin/env node
/**
 * 题库校验脚本：结构合法性由 zod 保证，逻辑一致性由这里的规则保证。
 * 用法：
 *   node scripts/validate-exercises.mjs            # 校验 content/exercises 全部文件
 *   node scripts/validate-exercises.mjs --file a.json,b.json
 *   node scripts/validate-exercises.mjs --strict    # 把警告也视为失败
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CONTENT_DIR = path.resolve('content/exercises');

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith('--file=')) ?? null;
const fileCsv = args[args.indexOf('--file') + 1];
const explicit = fileArg ? fileArg.slice('--file='.length) : fileCsv && !fileCsv.startsWith('--') ? fileCsv : '';
const strict = args.includes('--strict');

const CJK = /[\u4e00-\u9fff]/;


/** 枚举来自 scripts/content-enums.mjs，由 tests/integration/content.test.ts 保证与 taxonomy.ts 一致。 */
const { CATEGORY_ENUM, ERROR_ENUM } = await import('./content-enums.mjs');

let KNOWLEDGE_ENUM = [];
try {
  const text = await readFile(path.resolve('lib/domain/taxonomy.ts'), 'utf8');
  const block = text.split('export const KNOWLEDGE_POINTS')[1]?.split('] as const;')[0] ?? '';
  KNOWLEDGE_ENUM = [...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
} catch {
  console.warn('! 未能读取知识点目录，跳过知识点校验');
}

function checkExercise(ex, { file, index }) {
  const errors = [];
  const warnings = [];
  const where = `${file}#${index} ${ex?.id ?? '(无 id)'}`;
  if (typeof ex !== 'object' || ex === null) return { errors: [`${where}: 不是对象`], warnings };

  if (!/^ex-[a-z-]+-\d{3}$/.test(ex.id ?? '')) errors.push(`${where}: id 必须形如 ex-<类别缩写>-001`);
  if (!CATEGORY_ENUM.includes(ex.category)) errors.push(`${where}: 未知 category ${ex.category}`);
  if (![1, 2, 3, 4, 5].includes(ex.difficulty)) errors.push(`${where}: difficulty 必须在 1..5`);
  if (!Number.isInteger(ex.version) || ex.version < 1) errors.push(`${where}: version 必须是正整数`);
  if (ex.status !== 'validated' && ex.status !== 'draft') errors.push(`${where}: status 非法 ${ex.status}`);
  if (!CJK.test(ex.stem ?? '')) errors.push(`${where}: stem 必须包含中文`);
  if ((ex.stem ?? '').length < 15) errors.push(`${where}: stem 过短（<15 字）`);
  if (!Array.isArray(ex.knowledgePoints) || ex.knowledgePoints.length === 0)
    errors.push(`${where}: knowledgePoints 不能为空`);
  else {
    for (const kp of ex.knowledgePoints)
      if (KNOWLEDGE_ENUM.length && !KNOWLEDGE_ENUM.includes(kp)) errors.push(`${where}: 未知知识点 ${kp}`);
  }
  if (!Array.isArray(ex.reviewTags) || ex.reviewTags.length === 0) errors.push(`${where}: reviewTags 不能为空`);
  if (typeof ex.provenance !== 'string' || ex.provenance.length < 6)
    errors.push(`${where}: provenance 需要写明来源或编写说明`);

  const ex_ = ex.explanation ?? {};
  if (typeof ex_.summary !== 'string' || ex_.summary.length < 8) errors.push(`${where}: explanation.summary 过短`);
  if (!Array.isArray(ex_.steps) || ex_.steps.length < 2) errors.push(`${where}: explanation.steps 至少 2 步`);
  if (typeof ex_.takeaway !== 'string' || ex_.takeaway.length < 4) errors.push(`${where}: takeaway 缺失`);
  if (!Array.isArray(ex_.commonMistakes)) errors.push(`${where}: commonMistakes 必须是数组`);

  const optionKeys = new Set((ex.options ?? []).map((o) => o.key));
  const answerKeys = ex.answer?.keys ?? [];

  for (const mistake of ex_.commonMistakes ?? []) {
    if (!ERROR_ENUM.includes(mistake.errorType))
      errors.push(`${where}: commonMistakes.errorType 非法 ${mistake.errorType}`);
    if (mistake.option && !optionKeys.has(mistake.option))
      errors.push(`${where}: commonMistakes.option ${mistake.option} 不在选项里`);
    if (mistake.option && answerKeys.includes(mistake.option))
      errors.push(`${where}: 正确选项 ${mistake.option} 不能同时被标记为常见错误`);
    if ((mistake.why ?? '').length < 6) errors.push(`${where}: commonMistakes.why 过短`);
  }

  for (const opt of ex.options ?? []) {
    if (!/^[A-H]$/.test(opt.key ?? '')) errors.push(`${where}: 选项 key 必须是大写字母`);
    if (!CJK.test(opt.text ?? '')) errors.push(`${where}: 选项 ${opt.key} 文本必须包含中文`);
    if (opt.errorType && !ERROR_ENUM.includes(opt.errorType))
      errors.push(`${where}: 选项 ${opt.key} 的 errorType 非法`);
    if (opt.errorType && answerKeys.includes(opt.key))
      errors.push(`${where}: 正确选项 ${opt.key} 不能标记 errorType`);
    if (opt.errorType && !(ex_.commonMistakes ?? []).some((m) => m.option === opt.key))
      warnings.push(`${where}: 选项 ${opt.key} 标记了 errorType 但 explanation 未解释原因`);
  }

  if (ex.format === 'single-choice') {
    if (answerKeys.length !== 1) errors.push(`${where}: 单选题必须只有一个正确答案`);
    if ((ex.options ?? []).length < 3) errors.push(`${where}: 单选题至少 3 个选项`);
    if ((ex.options ?? []).length > 6) errors.push(`${where}: 手机屏上单选题不宜超过 6 个选项`);
  }
  if (ex.format === 'multi-choice') {
    if (answerKeys.length < 2) errors.push(`${where}: 多选题正确答案至少 2 个`);
    if (answerKeys.length > (ex.options ?? []).length - 1) errors.push(`${where}: 多选题不能全部选项都正确`);
  }
  if (ex.format === 'true-false' && typeof ex.answer?.value !== 'boolean')
    errors.push(`${where}: true-false 必须有布尔 value`);

  if (ex.format === 'ordering') {
    const itemKeys = (ex.items ?? []).map((i) => i.key);
    if (itemKeys.length !== new Set(itemKeys).size) errors.push(`${where}: items key 重复`);
    if (answerKeys.sort().join('|') !== [...itemKeys].sort().join('|'))
      errors.push(`${where}: answer.keys 必须正好是 items 的一个排列`);
    if ((ex.items ?? []).length < 3) errors.push(`${where}: 排序题至少 3 步`);
    for (const item of ex.items ?? []) if (!CJK.test(item.text ?? '')) errors.push(`${where}: item ${item.key} 文本需为中文`);
  }

  if (ex.format === 'short-answer') {
    const cps = ex.answer?.checkpoints ?? [];
    if (cps.length < 2) errors.push(`${where}: 简答题至少 2 个要点`);
    const model = ex.answer?.modelAnswer ?? '';
    if (model.length < 15) errors.push(`${where}: modelAnswer 过短`);
    const norm = (s) => (s ?? '').replace(/[\s，。、；：“”‘’（）《》【】—\-,.:;!?\"'`()<>[\]{}]/g, '').toLowerCase();
    for (const cp of cps) {
      if (!cp.keywords?.length) errors.push(`${where}: 要点 ${cp.id} 缺少关键词`);
      const hit = (cp.keywords ?? []).some((k) => norm(model).includes(norm(k)));
      if (!hit) errors.push(`${where}: 要点 ${cp.id} 的关键词在 modelAnswer 中找不到，判分与范文不一致`);
      if (!CJK.test(cp.label ?? '')) errors.push(`${where}: 要点 ${cp.id} 的 label 需为中文`);
    }
    if ((ex.answer?.correctRatio ?? 0) <= (ex.answer?.partialRatio ?? 1))
      errors.push(`${where}: correctRatio 必须大于 partialRatio`);
  }

  if (ex.format === 'open-response') {
    const scale = ex.answer?.scale ?? [];
    if (scale.length < 3) errors.push(`${where}: 开放题量表至少 3 级`);
    const scores = scale.map((s) => s.score);
    if (new Set(scores).size !== scores.length) errors.push(`${where}: 量表等级重复`);
    if (!scores.includes(0)) warnings.push(`${where}: 量表建议包含 0 级（未达成）`);
    for (const level of scale) if ((level.criteria ?? '').length < 8) errors.push(`${where}: 等级 ${level.score} 的 criteria 过短`);
  }

  for (const alt of ex.alternatives ?? []) {
    for (const k of alt.keys ?? [])
      if (optionKeys.size && !optionKeys.has(k)) errors.push(`${where}: alternatives 引用了不存在的选项 ${k}`);
    if ((alt.note ?? '').length < 6) errors.push(`${where}: alternative 必须写明为何可接受`);
  }

  return { errors, warnings, where };
}

async function main() {
  const files = explicit
    ? explicit.split(',').map((f) => path.resolve(f.trim()))
    : existsSync(CONTENT_DIR)
      ? (await readdir(CONTENT_DIR)).filter((f) => f.endsWith('.json')).map((f) => path.join(CONTENT_DIR, f))
      : [];

  if (files.length === 0) {
    console.error(`✗ 没有找到题库文件（${CONTENT_DIR}）`);
    process.exit(1);
  }


  const allExercises = [];
  const errors = [];
  const warnings = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'));
    } catch (e) {
      errors.push(`${rel}: JSON 解析失败 ${e.message}`);
      continue;
    }
    if (parsed.schemaVersion !== 1) errors.push(`${rel}: schemaVersion 应为 1，实际 ${parsed.schemaVersion}`);
    if (!CATEGORY_ENUM.includes(parsed.category)) errors.push(`${rel}: category 非法 ${parsed.category}`);
    if (!Array.isArray(parsed.exercises) || parsed.exercises.length === 0) {
      errors.push(`${rel}: exercises 不能为空`);
      continue;
    }
    parsed.exercises.forEach((ex, index) => {
      const result = checkExercise(ex, { file: rel, index });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
      if (ex?.category && parsed.category && ex.category !== parsed.category)
        errors.push(`${rel}#${index} ${ex.id}: 题目 category 与文件 category 不一致`);
      allExercises.push({ ...ex, __file: rel });
    });
  }

  const ids = allExercises.map((e) => e.id);
  const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupIds.length) errors.push(`重复 id: ${[...new Set(dupIds)].join(', ')}`);

  const stems = allExercises.map((e) => (e.stem ?? '').replace(/\s+/g, ''));
  const dupStems = stems.filter((s, i) => stems.indexOf(s) !== i);
  if (dupStems.length) errors.push(`重复题干: ${[...new Set(dupStems)].slice(0, 3).join(' | ')}`);

  const byCategory = new Map();
  const byFormat = new Map();
  const usedErrorTypes = new Set();
  for (const e of allExercises) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
    byFormat.set(e.format, (byFormat.get(e.format) ?? 0) + 1);
    for (const m of e.explanation?.commonMistakes ?? []) usedErrorTypes.add(m.errorType);
    for (const o of e.options ?? []) if (o.errorType) usedErrorTypes.add(o.errorType);
  }

  console.log(`共 ${allExercises.length} 道题，来自 ${files.length} 个文件`);
  console.log('题型分布:', Object.fromEntries(byFormat));
  console.log('类别数量:', Object.fromEntries(byCategory));
  console.log(`覆盖错误类型 ${usedErrorTypes.size}/${ERROR_ENUM.length}`);

  const missingCategories = CATEGORY_ENUM.filter((c) => !byCategory.get(c));
  if (missingCategories.length) warnings.push(`缺少类别: ${missingCategories.join(', ')}`);
  const missingErrorTypes = ERROR_ENUM.filter((t) => !usedErrorTypes.has(t));
  if (missingErrorTypes.length) warnings.push(`未覆盖错误类型: ${missingErrorTypes.join(', ')}`);
  const weakFormats = ['short-answer', 'ordering', 'open-response'].filter((f) => (byFormat.get(f) ?? 0) < 3);
  if (weakFormats.length) warnings.push(`这些题型的样本偏少: ${weakFormats.join(', ')}`);

  if (warnings.length) {
    console.log(`\n警告 ${warnings.length} 条:`);
    for (const w of warnings.slice(0, 40)) console.log('  - ' + w);
  }

  if (errors.length) {
    console.log(`\n错误 ${errors.length} 条:`);
    for (const e of errors.slice(0, 120)) console.log('  ✗ ' + e);
    if (errors.length > 120) console.log(`  … 还有 ${errors.length - 120} 条`);
    process.exit(1);
  }

  if (strict && warnings.length) {
    console.log('✗ --strict 模式下警告视为失败');
    process.exit(1);
  }

  console.log('\n✓ 题库校验通过');
}

await main();
