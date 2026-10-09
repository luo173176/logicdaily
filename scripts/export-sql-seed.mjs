#!/usr/bin/env node
/**
 * export-sql-seed.mjs -- generate supabase/migrations/0003_seed_exercises.sql
 * from the question bank that actually ships in this repo.
 *
 * Why a generator instead of a hand-written seed: content/exercises/*.json is the
 * single source of truth for the bank (loaded by lib/content/packs.ts, checked by
 * scripts/validate-exercises.mjs). Hand-copying it into SQL would let the cloud seed
 * drift from the shipped questions, and every mismatch would change what users are
 * graded on. This script reads those JSON files and prints INSERT statements.
 *
 * Plain Node, no dependencies. Writes SQL to stdout, the count report to stderr.
 *
 * Usage:
 *   node scripts/export-sql-seed.mjs > supabase/migrations/0003_seed_exercises.sql
 *   node scripts/export-sql-seed.mjs --stdout-only      # same thing
 *   node scripts/export-sql-seed.mjs --count            # print counts and exit
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONTENT_DIR = join(REPO_ROOT, 'content', 'exercises');
const PACKS_FILE = join(REPO_ROOT, 'lib', 'content', 'packs.ts');

/** Formats the exercises table can hold (lib/domain/exercise-schema.ts). */
const KNOWN_FORMATS = new Set([
  'single-choice',
  'multi-choice',
  'true-false',
  'short-answer',
  'open-response',
  'ordering',
]);

/** Column order of the generated INSERT; mirrors 0001_init.sql's exercises table. */
const COLUMNS = [
  'id',
  'version',
  'category',
  'knowledge_points',
  'difficulty',
  'estimated_seconds',
  'format',
  'context',
  'stem',
  'prompt',
  'options',
  'items',
  'answer',
  'alternatives',
  'explanation',
  'review_tags',
  'provenance',
  'status',
  'grading_partial_credit',
  'grading_order_tolerance',
  'seeded_from',
  'content_schema_version',
];

function fail(message) {
  process.stderr.write(`export-sql-seed: ${message}\n`);
  process.exit(1);
}

/**
 * The content tag is defined once, in lib/content/packs.ts
 * (EXERCISE_CONTENT_TAG, e.g. 'content-v1.0'). Reading it from that source keeps the
 * cloud seed and the local seed path in agreement; LocalStore.seedExercises() uses the
 * same value as ExerciseRow.seededFrom, and 0001 stores it in exercises.seeded_from.
 */
function readContentTag() {
  let source;
  try {
    source = readFileSync(PACKS_FILE, 'utf8');
  } catch {
    return 'content-v1.0';
  }
  const match = source.match(/EXERCISE_CONTENT_TAG\s*=\s*'([^']+)'/);
  if (!match) fail(`could not find EXERCISE_CONTENT_TAG in ${PACKS_FILE}`);
  return match[1];
}

/** SQL string literal. standard_conforming_strings is on, so backslashes stay literal. */
function str(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'string') fail(`expected a string, got ${typeof value}`);
  return `'${value.replace(/'/g, "''")}'`;
}

function textOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? str(value) : 'null';
}

function int(value, field, id) {
  if (!Number.isInteger(value)) fail(`${id}: ${field} must be an integer, got ${value}`);
  return String(value);
}

function bool(value) {
  if (typeof value !== 'boolean') fail(`expected a boolean, got ${typeof value}`);
  return value ? 'true' : 'false';
}

function num(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(fallback);
}

/** jsonb literal: JSON.stringify keeps the value on one line and escapes what needs it. */
function jsonb(value) {
  return `${str(JSON.stringify(value))}::jsonb`;
}

/** text[] literal; Postgres has no JSON-style array syntax, so build it element by element. */
function textArray(values) {
  if (!Array.isArray(values) || values.length === 0) return `'{}'::text[]`;
  return `array[${values.map((v) => str(String(v))).join(', ')}]::text[]`;
}

function loadPacks() {
  const files = readdirSync(CONTENT_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) fail(`no JSON files found in ${CONTENT_DIR}`);

  return files.map((name) => {
    const raw = readFileSync(join(CONTENT_DIR, name), 'utf8');
    let pack;
    try {
      pack = JSON.parse(raw);
    } catch (error) {
      fail(`${name}: invalid JSON (${error.message})`);
    }
    if (!Array.isArray(pack.exercises) || pack.exercises.length === 0) {
      fail(`${name}: missing or empty "exercises" array`);
    }
    if (!Number.isInteger(pack.schemaVersion)) fail(`${name}: schemaVersion must be an integer`);
    if (typeof pack.category !== 'string') fail(`${name}: category must be a string`);
    return { name, pack };
  });
}

/** One exercise -> one parenthesised VALUES row. */
function rowLiteral(exercise, pack, sourceTag) {
  const id = exercise.id ?? `${pack.name}:<no id>`;
  if (typeof exercise.id !== 'string' || exercise.id.length === 0) fail(`${id}: missing id`);
  if (!KNOWN_FORMATS.has(exercise.format)) fail(`${id}: unknown format ${exercise.format}`);
  if (!Array.isArray(exercise.knowledgePoints) || exercise.knowledgePoints.length === 0) {
    fail(`${id}: knowledgePoints must be a non-empty array`);
  }
  if (!Array.isArray(exercise.reviewTags) || exercise.reviewTags.length === 0) {
    fail(`${id}: reviewTags must be a non-empty array`);
  }
  if (!exercise.answer) fail(`${id}: missing answer`);
  if (!exercise.explanation) fail(`${id}: missing explanation`);

  const grading = exercise.grading ?? {};
  const values = [
    str(exercise.id),
    int(exercise.version, 'version', id),
    str(exercise.category ?? pack.category),
    textArray(exercise.knowledgePoints),
    int(exercise.difficulty, 'difficulty', id),
    int(exercise.estimatedSeconds, 'estimatedSeconds', id),
    str(exercise.format),
    textOrNull(exercise.context),
    str(exercise.stem),
    textOrNull(exercise.prompt),
    exercise.options === undefined ? 'null' : jsonb(exercise.options),
    exercise.items === undefined ? 'null' : jsonb(exercise.items),
    jsonb(exercise.answer),
    jsonb(exercise.alternatives ?? []),
    jsonb(exercise.explanation),
    textArray(exercise.reviewTags),
    str(exercise.provenance),
    str(exercise.status ?? 'validated'),
    bool(grading.partialCredit ?? true),
    num(grading.orderTolerance, 0.2),
    str(sourceTag),
    int(pack.schemaVersion, 'schemaVersion', id),
  ];
  return `  (${values.join(', ')})`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const sourceTag = readContentTag();
  const packs = loadPacks();

  const rows = [];
  for (const { pack, name } of packs) {
    for (const exercise of pack.exercises) {
      rows.push({ line: rowLiteral(exercise, { name, ...pack }, sourceTag), id: exercise.id });
    }
  }

  const seen = new Set();
  for (const { id } of rows) {
    if (seen.has(id)) fail(`duplicate exercise id ${id} in the bank`);
    seen.add(id);
  }
  if (args.has('--count')) {
    process.stdout.write(`${rows.length}\n`);
    return;
  }

  const out = [];
  out.push('-- ===========================================================================');
  out.push('-- 0003_seed_exercises.sql -- shared question bank seed');
  out.push('-- ===========================================================================');
  out.push('-- GENERATED FILE -- do not hand-edit.');
  out.push('-- Regenerate after changing question content with:');
  out.push('--   node scripts/export-sql-seed.mjs > supabase/migrations/0003_seed_exercises.sql');
  out.push('--');
  out.push(`-- Source: content/exercises/*.json (${packs.length} pack files), read by`);
  out.push('-- scripts/export-sql-seed.mjs. Column mapping and types: 0001_init.sql.');
  out.push(`-- Exercises seeded: ${rows.length}. Content tag: ${sourceTag}.`);
  out.push('--');
  out.push('-- The bank is global (no owner_id) and RLS gives the client roles read-only');
  out.push('-- access (0002), so this seed is applied by a migration/deploy step, never by a');
  out.push('-- browser request. Re-running it is safe: ON CONFLICT updates the row in place.');
  out.push('-- ===========================================================================');
  out.push('');
  out.push('begin;');
  out.push('');
  out.push(`insert into exercises (${COLUMNS.join(', ')}) values`);
  out.push(rows.map((row) => row.line).join(',\n'));
  out.push(`on conflict (id) do update set`);
  out.push(
    COLUMNS.filter((column) => column !== 'id')
      .map((column) => `  ${column} = excluded.${column}`)
      .join(',\n'),
  );
  out.push(';');
  out.push('');
  out.push('-- Retire rows that a previous seed of the same tag inserted but the current');
  out.push('-- content no longer contains (the local equivalent is the stale-row pass in');
  out.push('-- LocalStore.seedExercises()). Scoped to this tag so hand-added rows are safe,');
  out.push('-- and left commented out because deleting a bank row while user history');
  out.push('-- references it is a content decision, not a seed-time one.');
  out.push('-- delete from exercises where seeded_from = ' + str(sourceTag) + `;`);
  out.push('-- re-run the insert above to bring the rows back.');
  out.push('');
  out.push('commit;');
  out.push('');

  process.stdout.write(out.join('\n'));
  process.stderr.write(
    `export-sql-seed: ${packs.length} pack files, ${rows.length} exercises -> ${seen.size} unique ids (tag ${sourceTag})\n`,
  );
}

main();
