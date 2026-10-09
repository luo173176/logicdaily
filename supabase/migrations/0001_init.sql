-- ===========================================================================
-- 0001_init.sql -- LogicDaily cloud schema: tables mirroring the local records
-- ===========================================================================
-- Source of truth for the column shapes (read these before editing):
--   lib/domain/records.ts         AttemptRecord, DailyPlanItemRecord,
--                                 DailyPlanRecord, DailyProgressRecord,
--                                 ExerciseIssueReport, AIUsageRecord,
--                                 AIAnalysisRecord, SyncStateRecord
--   lib/domain/journal.ts         Journal + nested JournalEvidence + nested JournalStepAnswer
--   lib/domain/settings.ts        AppSettings
--   lib/domain/exercise-schema.ts Exercise / ExerciseFile (shared question bank)
--   lib/db/database.ts            the Dexie index map this file's indexes copy
--   lib/db/store.ts               LocalStore query patterns = the access paths to keep fast
--
-- Naming and type-mapping conventions (applied consistently, table by table)
--   * camelCase TS field  ->  snake_case column, 1:1 (timeSpentSeconds -> time_spent_seconds).
--     Every column comment names the TS field it maps to, or says "no TS counterpart".
--   * profileId: string   ->  owner_id: uuid. In cloud mode the local profile id is replaced by
--     the authenticated Supabase user id (one login = one profile), so profileId is not
--     duplicated as a text column. See 0002 for the isolation this enables.
--   * epoch milliseconds (Date.now())  ->  timestamptz. Lossless round-trip at ms resolution
--     via toISOString() / valueOf().
--   * DateKey ('YYYY-MM-DD' string, lib/domain/time.ts)  ->  date. The local wire format is
--     already ISO-8601, and `date` turns the [profileId+dateKey] string range scans Dexie does
--     into real btree range scans.
--   * string[] -> text[], number[] -> integer[].
--   * JS number (IEEE-754 double) -> double precision for fractional values, integer for the
--     counts/durations the zod schemas declare as .int().
--   * Timestamps: a column mapped from a REQUIRED TS timestamp field is `not null` with no
--     default -- the client stamp is the fact being recorded and a silent now() would fabricate
--     history. A DB-only audit column defaults to now(). Both created_at and updated_at exist on
--     every table.
--   * `meta` (MetaRecord) is deliberately NOT mirrored: it is local bookkeeping
--     (e.g. key 'onboarded:<profileId>') with no cloud meaning; that flag lives in
--     app_settings.onboarded.
--
-- jsonb vs child table -- the rule used throughout this file
--   A nested array becomes a child table only when its elements are individually addressable AND
--   are read or conflict-resolved without the parent. Exactly one collection qualifies:
--   journal evidence (see its table comment). Everything else stays jsonb, stated at the column.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared question bank. NOT user-owned: content is versioned in git
-- (content/exercises/*.json, loaded by lib/content/packs.ts, validated by
-- scripts/validate-exercises.mjs) and identical for every profile, so it is one
-- global table rather than per-user copies.
-- ---------------------------------------------------------------------------
create table if not exists exercises (
  id text primary key,                                            -- Exercise.id
  version integer not null check (version >= 1),                  -- Exercise.version
  category text not null check (category in (                     -- Exercise.category (EXERCISE_CATEGORIES)
    'deductive-reasoning','inductive-reasoning','conditional-reasoning',
    'truth-teller-puzzles','necessary-sufficient-conditions','contrapositive-conversion',
    'causal-reasoning','correlation-vs-causation','statistical-intuition',
    'logical-fallacies','argument-analysis','counterexample-rebuttal',
    'problem-decomposition','decision-analysis')),
  knowledge_points text[] not null                                -- Exercise.knowledgePoints (KNOWLEDGE_POINT_IDS;
    check (cardinality(knowledge_points) between 1 and 4),        --   id membership is checked by zod, not by a
                                                                    --   60-value CHECK list that would drift)
  difficulty integer not null check (difficulty between 1 and 5), -- Exercise.difficulty
  estimated_seconds integer not null                              -- Exercise.estimatedSeconds
    check (estimated_seconds between 20 and 600),
  format text not null check (format in (                         -- Exercise.format
    'single-choice','multi-choice','true-false','short-answer','open-response','ordering')),
  context text,                                                   -- Exercise.context (optional in the schema)
  stem text not null,                                             -- Exercise.stem
  prompt text,                                                    -- Exercise.prompt (optional; unused by shipped content)
  options jsonb                                                   -- Exercise.options: optionSchema[] {key, text,
    check (options is null or jsonb_typeof(options) = 'array'),    --   errorType?, reason?}. Present only for
                                                                    --   single/multi-choice, so it is a nullable jsonb
                                                                    --   array rather than 6 x nullable columns
  items jsonb                                                     -- Exercise.items: ordering {key, text}[] in
    check (items is null or jsonb_typeof(items) = 'array'),        --   correct order (the UI shuffles)
  answer jsonb not null                                           -- Exercise.answer. Shape differs per format
    check (jsonb_typeof(answer) = 'object'),                       --   ({keys} | {value:boolean} | {checkpoints,
                                                                    --   correctRatio, partialRatio, modelAnswer} |
                                                                    --   {scale, guidance, selfAssessed}) -> jsonb
  alternatives jsonb not null default '[]'::jsonb                  -- Exercise.alternatives[]
    check (jsonb_typeof(alternatives) = 'array'),
  explanation jsonb not null                                      -- Exercise.explanation {summary, steps[],
    check (jsonb_typeof(explanation) = 'object'),                  --   commonMistakes[], takeaway}: never filtered
                                                                    --   on, always rendered as a unit -> jsonb
  review_tags text[] not null                                     -- Exercise.reviewTags
    check (cardinality(review_tags) between 1 and 6),
  provenance text not null,                                       -- Exercise.provenance
  status text not null default 'validated' check (status in (     -- Exercise.status
    'draft','validated','retired')),
  grading_partial_credit boolean not null default true,           -- Exercise.grading.partialCredit
  grading_order_tolerance double precision not null default 0.2    -- Exercise.grading.orderTolerance
    check (grading_order_tolerance between 0 and 0.5),
  seeded_from text not null,                                      -- ExerciseRow.seededFrom: content tag from
                                                                    --   lib/content/packs.ts EXERCISE_CONTENT_TAG
  content_schema_version integer not null default 1,              -- ExerciseFile.schemaVersion, denormalised onto
                                                                    --   each row (one table, many pack files)
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  updated_at timestamptz not null default now()                   -- no TS counterpart; DB audit column
);

-- Mirrors the Dexie map 'id, category, format, difficulty, status'.
create index if not exists idx_exercises_category   on exercises (category);
create index if not exists idx_exercises_format     on exercises (format);
create index if not exists idx_exercises_difficulty on exercises (difficulty);
-- LocalStore.listExercises({category, status}) uses the category index then filters status in
-- memory; one composite btree serves both call shapes in cloud mode.
create index if not exists idx_exercises_category_status on exercises (category, status);

-- ---------------------------------------------------------------------------
-- AI analyses. Declared before attempts because attempts.ai_analysis_id
-- references it.
-- ---------------------------------------------------------------------------
create table if not exists ai_analysis_records (
  id text primary key,                                            -- AIAnalysisRecord.id ('ana-<36>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- AIAnalysisRecord.profileId
  subject_kind text not null check (subject_kind in (             -- AIAnalysisRecord.subjectKind
    'attempt','journal','material','profile')),
  subject_id text,                                                -- AIAnalysisRecord.subjectId. Polymorphic pointer
                                                                    --   (attempt | journal | material | profile), so a
                                                                    --   single FK is impossible; the discriminator plus
                                                                    --   owner scoping (0002) keeps it unambiguous.
  task text not null,                                             -- AIAnalysisRecord.task
  provider text not null,                                         -- AIAnalysisRecord.provider
  model text not null,                                            -- AIAnalysisRecord.model
  prompt_version text not null,                                   -- AIAnalysisRecord.promptVersion
  result jsonb not null,                                          -- AIAnalysisRecord.result: typed `unknown` in TS
                                                                    --   (structured model output) -> jsonb, no shape check
  uncertainty text not null,                                      -- AIAnalysisRecord.uncertainty
  retained_input_summary text,                                    -- AIAnalysisRecord.retainedInputSummary; null =
                                                                    --   the user did not consent to keeping the input
  created_at timestamptz not null,                                -- AIAnalysisRecord.createdAt (epoch ms)
  updated_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  unique (owner_id, id)                                           -- FK target for attempts: proves a row cannot point
);                                                              --   into another owner's analysis

create index if not exists idx_ai_analyses_owner_subject on ai_analysis_records (owner_id, subject_kind);
create index if not exists idx_ai_analyses_subject_id    on ai_analysis_records (subject_id);
-- listAIAnalyses(profileId, limit) reads newest-first.
create index if not exists idx_ai_analyses_owner_created on ai_analysis_records (owner_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Answer history.
-- ---------------------------------------------------------------------------
create table if not exists attempts (
  id text primary key,                                            -- AttemptRecord.id ('atp-<36>-<exerciseId>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- AttemptRecord.profileId
  exercise_id text not null,                                      -- AttemptRecord.exerciseId. Deliberately NOT a FK:
                                                                    --   seedExercises() deletes stale bank rows and an
                                                                    --   append-only answer history must outlive content
                                                                    --   edits (IndexedDB has no FKs either, so an
                                                                    --   import would otherwise fail).
  exercise_version integer not null,                              -- AttemptRecord.exerciseVersion: the bank version the
                                                                    --   answer was graded against, so old rows stay
                                                                    --   interpretable after the bank moves on
  date_key date not null,                                         -- AttemptRecord.dateKey (DateKey 'YYYY-MM-DD')
  created_at timestamptz not null,                                -- AttemptRecord.createdAt (epoch ms); required, no
                                                                    --   default -- see the timestamp rule in the header
  answer jsonb not null                                           -- AttemptRecord.answer: AnswerInput is a
    check (jsonb_typeof(answer) = 'object'),                      --   discriminated union whose payload differs per
                                                                    --   format: {format, keys[]} for single/multi-choice
                                                                    --   and ordering, {format, value:boolean|null} for
                                                                    --   true-false, {format, text} for short-answer and
                                                                    --   {format, text, score} for open-response. The
                                                                    --   embedded `format` key keeps the blob
                                                                    --   self-describing, so one column covers all six.
  outcome text not null check (outcome in (                       -- AttemptRecord.outcome (GradeOutcome)
    'correct','partial','incorrect','self-assessed')),
  score double precision not null check (score between 0 and 1),   -- AttemptRecord.score (0..1)
  time_spent_seconds integer not null check (time_spent_seconds >= 0), -- AttemptRecord.timeSpentSeconds
  confidence integer not null check (confidence between 1 and 5), -- AttemptRecord.confidence (1..5 self-rating)
  reasoning text not null,                                        -- AttemptRecord.reasoning: the user's own words, so
                                                                    --   private; owner-only read is enforced in 0002
  self_report text check (self_report in (                        -- AttemptRecord.selfReport (SelfReport). NULL means
    'careless','unknown-term','misread','ambiguous')               --   "the user reported no cause", which is why the
    or self_report is null),                                      --   column is nullable
  error_types text[] not null default array[]::text[],            -- AttemptRecord.errorTypes (LogicErrorType[];
                                                                    --   element validity comes from zod, same trade-off
                                                                    --   as exercises.knowledge_points)
  cause text not null check (cause in (                           -- AttemptRecord.cause (CauseType)
    'none','logic-skill','knowledge-gap','carelessness',
    'misread-question','ambiguous-question','unknown')),
  plan_item_id text,                                              -- AttemptRecord.planItemId: id of an entry inside
                                                                    --   daily_plans.items jsonb -> no FK is possible
  is_review boolean not null,                                     -- AttemptRecord.isReview
  flagged_for_review boolean not null,                            -- AttemptRecord.flaggedForReview
  ai_analysis_id text,                                            -- AttemptRecord.aiAnalysisId (nullable)
  updated_at timestamptz not null default now(),                  -- no TS counterpart; attempts are append-only, the
                                                                    --   column exists so a later repair is traceable
  foreign key (owner_id, ai_analysis_id)
    references ai_analysis_records (owner_id, id) on delete set null
);

-- Dexie: 'id, profileId, [profileId+dateKey], [profileId+exerciseId], exerciseId, dateKey, createdAt'.
-- listAttempts() does an inclusive (profile, date) range then sorts by createdAt, so the date
-- index carries created_at to serve both; owner_id is the leading column of every index below,
-- which also covers the owner_id FK.
create index if not exists idx_attempts_owner_date     on attempts (owner_id, date_key, created_at);
create index if not exists idx_attempts_owner_exercise on attempts (owner_id, exercise_id);
create index if not exists idx_attempts_exercise       on attempts (exercise_id);
create index if not exists idx_attempts_owner_created  on attempts (owner_id, created_at);

-- ---------------------------------------------------------------------------
-- Mastery (lib/domain/mastery.ts KnowledgeState).
-- ---------------------------------------------------------------------------
create table if not exists knowledge_point_states (
  owner_id uuid not null references auth.users (id) on delete cascade, -- KnowledgeState has no profileId field:
                                                                    --   LocalStore.putKnowledgeState() injects it and
                                                                    --   stripProfile() removes it on read, so this
                                                                    --   column is the row key, not a record field
  knowledge_point_id text not null,                               -- KnowledgeState.knowledgePointId
  ewma double precision not null check (ewma between 0 and 1),    -- KnowledgeState.ewma (0..1 weighted performance)
  attempts integer not null check (attempts >= 0),                -- KnowledgeState.attempts
  correct integer not null check (correct >= 0),                  -- KnowledgeState.correct
  partial integer not null check (partial >= 0),                  -- KnowledgeState.partial
  incorrect integer not null check (incorrect >= 0),              -- KnowledgeState.incorrect
  recent_error_types text[] not null default array[]::text[],     -- KnowledgeState.recentErrorTypes (updateKnowledgeState
                                                                    --   keeps the last 5)
  last_attempt_date_key date,                                     -- KnowledgeState.lastAttemptDateKey (nullable)
  updated_at timestamptz not null,                                -- KnowledgeState.updatedAt (epoch ms)
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  primary key (owner_id, knowledge_point_id)                      -- Dexie compound key
);                                                                --   [profileId+knowledgePointId]

create index if not exists idx_kp_states_point on knowledge_point_states (knowledge_point_id);

-- ---------------------------------------------------------------------------
-- Spaced-repetition queue (lib/domain/scheduling.ts ReviewState).
-- ---------------------------------------------------------------------------
create table if not exists review_states (
  owner_id uuid not null references auth.users (id) on delete cascade, -- added by putReviewState()
  exercise_id text not null,                                      -- ReviewState.exerciseId. No FK for the same
                                                                    --   reason as attempts.exercise_id: retiring
                                                                    --   content must not delete a learner's queue.
  ease double precision not null check (ease between 1.8 and 2.8), -- ReviewState.ease (SRS_LIMITS.min/maxEase)
  interval_days integer not null check (interval_days between 0 and 45), -- ReviewState.intervalDays (0 until the
                                                                    --   first success; maxIntervalDays = 45)
  repetitions integer not null check (repetitions >= 0),          -- ReviewState.repetitions
  lapses integer not null check (lapses >= 0),                    -- ReviewState.lapses
  due_date_key date,                                              -- ReviewState.dueDateKey; NULL = not in the queue
  same_day_relearn boolean not null default false,                -- ReviewState.sameDayRelearn
  same_day_relearn_after_ts timestamptz,                          -- ReviewState.sameDayRelearnAfterTs (epoch ms,
                                                                    --   nullable)
  leech boolean not null default false,                           -- ReviewState.leech
  last_outcome text check (last_outcome in (                      -- ReviewState.lastOutcome (GradeOutcome | null)
    'correct','partial','incorrect','self-assessed')
    or last_outcome is null),
  last_confidence integer check (                                 -- ReviewState.lastConfidence (nullable)
    last_confidence between 1 and 5 or last_confidence is null),
  last_error_types text[] not null default array[]::text[],       -- ReviewState.lastErrorTypes (LogicErrorType[])
  updated_at timestamptz not null,                                -- ReviewState.updatedAt (epoch ms)
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  primary key (owner_id, exercise_id)                             -- Dexie compound key [profileId+exerciseId]
);

-- Dexie: '[profileId+exerciseId], profileId, exerciseId, dueDateKey'.
-- The due-review scan (isDueForReview, and the plan generator's "what is overdue today") is
-- "my rows with due_date_key <= today"; NULL due dates are not in the queue, so they stay out of
-- the index.
create index if not exists idx_review_states_due      on review_states (owner_id, due_date_key)
  where due_date_key is not null;
create index if not exists idx_review_states_exercise on review_states (exercise_id);

-- ---------------------------------------------------------------------------
-- Thinking journals (lib/domain/journal.ts), columns in zod declaration order.
-- ---------------------------------------------------------------------------
create table if not exists journals (
  id text primary key,                                            -- Journal.id ('jr-<36>-<rand>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- Journal.profileId
  title text not null check (char_length(title) between 1 and 120), -- Journal.title (zod min 1 / max 120)
  problem text not null default '' check (char_length(problem) <= 4000),                    -- Journal.problem
  background text not null default '' check (char_length(background) <= 4000),              -- Journal.background
  facts text not null default '' check (char_length(facts) <= 6000),                        -- Journal.facts
  assumptions text not null default '' check (char_length(assumptions) <= 6000),            -- Journal.assumptions
  conclusion text not null default '' check (char_length(conclusion) <= 6000),              -- Journal.conclusion
  alternative_explanations text not null default ''                                          -- Journal.alternativeExplanations
    check (char_length(alternative_explanations) <= 6000),
  key_uncertainties text not null default '' check (char_length(key_uncertainties) <= 6000), -- Journal.keyUncertainties
  verification_actions text not null default ''                                            -- Journal.verificationActions
    check (char_length(verification_actions) <= 6000),
  review_outcome text not null default '' check (char_length(review_outcome) <= 6000),      -- Journal.reviewOutcome
  review_delta text not null default 'unknown' check (review_delta in (                     -- Journal.reviewDelta
    'better','as-expected','worse','unknown')),
  steps jsonb not null default '[]'::jsonb                        -- Journal.steps: JournalStepAnswer[]
    check (jsonb_typeof(steps) = 'array'),                        --   KEPT AS JSONB, not a child table: stepId comes
                                                                    --   from the activity template (not user-created),
                                                                    --   the array is small and bounded, upsertJournal()
                                                                    --   replaces the whole document atomically, and no
                                                                    --   read path touches a step without its journal
                                                                    --   (searchJournals() flattens it in memory). A
                                                                    --   child table would cost an extra round-trip per
                                                                    --   journal read plus per-row sync diffing for no
                                                                    --   query benefit. Shape: {stepId, text, updatedAt}.
  -- Journal.evidence is NOT a column: it moved to the journal_evidence child table below.
  tags text[] not null default array[]::text[]                    -- Journal.tags (max 12 entries, each 1..24 chars)
    check (cardinality(tags) <= 12),
  self_confidence integer not null default 3 check (self_confidence between 1 and 5), -- Journal.selfConfidence
  status text not null default 'open' check (status in (          -- Journal.status
    'open','review-due','reviewed','decided','archived')),
  review_due_date_key date,                                       -- Journal.reviewDueDateKey (nullable DateKey)
  created_at timestamptz not null,                                -- Journal.createdAt (epoch ms)
  updated_at timestamptz not null,                                -- Journal.updatedAt (epoch ms). Written by the
                                                                    --   client, never by a trigger: last-write-wins
                                                                    --   sync (see importBackup / upsertJournal)
                                                                    --   compares these values, so the database has to
                                                                    --   accept the incoming timestamp
  deleted boolean not null default false,                         -- Journal.deleted (soft delete; must propagate
                                                                    --   on sync, so it is a column not a row absence)
  deleted_at timestamptz,                                         -- Journal.deletedAt (nullable)
  ai_consent boolean not null default false,                      -- Journal.aiConsent: the journal's text is only
                                                                    --   sent to the model when this is true
  unique (owner_id, id)                                           -- FK target for journal_evidence, so an evidence
);                                                              --   row can never be attached to another owner's journal

-- Dexie: 'id, profileId, [profileId+deleted], [profileId+updatedAt], createdAt, reviewDueDateKey'.
-- listJournals() filters profileId, drops deleted rows and sorts updatedAt desc.
create index if not exists idx_journals_owner_updated on journals (owner_id, updated_at desc);
create index if not exists idx_journals_owner_deleted on journals (owner_id, deleted);
create index if not exists idx_journals_owner_created on journals (owner_id, created_at);
-- due-review scan: "my journals whose review is due", skipping NULL due dates.
create index if not exists idx_journals_owner_due     on journals (owner_id, review_due_date_key)
  where review_due_date_key is not null;
-- the everyday list (not deleted, newest first)
create index if not exists idx_journals_owner_open    on journals (owner_id, updated_at desc)
  where deleted = false;
-- searchJournals(tag) does tags.includes(tag) in memory -> array containment index.
create index if not exists idx_journals_tags on journals using gin (tags);

-- ---------------------------------------------------------------------------
-- Journal evidence: CHILD TABLE -- the one deliberate counter-example to
-- journals.steps above.
--
-- Why a table here and jsonb for the sibling collection:
--   1. Every element already has its own stable, user-generated id ('ev-<36>-<n>') and its own
--      createdAt, so it is addressable independently of the journal.
--   2. It is the unit the coach reasons over -- one stance (support / oppose / alternative /
--      unknown) plus a 1..5 reliability self-rating per row -- so per-row reads, per-row conflict
--      resolution and per-row indexes are meaningful; journals.steps are template-fixed prompts
--      with no independent identity.
--   3. It is the only journal collection that grows without a schema-level bound (steps and the
--      wizard fields are fixed-shape), so keeping it out of the parent means the common
--      "list my journals newest-first" query does not drag every evidence paragraph across the
--      wire.
--   4. Write path: upsertJournal() replaces the whole journal, so Phase 3 writes this table as
--      delete-by-journal_id + reinsert inside one transaction; ON DELETE CASCADE makes that
--      cheap and keeps orphans impossible.
-- ---------------------------------------------------------------------------
create table if not exists journal_evidence (
  id text not null,                                               -- JournalEvidence.id
  owner_id uuid not null references auth.users (id) on delete cascade, -- Journal.profileId, denormalised onto the
                                                                    --   child so RLS can scope it without a join
  journal_id text not null,                                       -- JournalEvidence.journalId
  stance text not null check (stance in (                         -- JournalEvidence.stance
    'support','oppose','alternative','unknown')),
  text text not null check (char_length(text) between 1 and 4000),-- JournalEvidence.text
  source text not null default '' check (char_length(source) <= 300), -- JournalEvidence.source
  reliability integer not null default 3 check (reliability between 1 and 5), -- JournalEvidence.reliability
  created_at timestamptz not null,                                -- JournalEvidence.createdAt (epoch ms)
  updated_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  primary key (owner_id, id),                                     -- the parent's id is only unique per owner under
                                                                    --   RLS; keeping owner_id in the key matches
                                                                    --   journals (owner_id, id)
  foreign key (owner_id, journal_id) references journals (owner_id, id) on delete cascade
);

create index if not exists idx_evidence_journal        on journal_evidence (journal_id);
create index if not exists idx_evidence_owner_journal  on journal_evidence (owner_id, journal_id, created_at);

-- ---------------------------------------------------------------------------
-- Daily plans (DailyPlanRecord + nested DailyPlanItemRecord[]).
-- ---------------------------------------------------------------------------
create table if not exists daily_plans (
  id text primary key,                                            -- DailyPlanRecord.id ('plan-<profileId>-<dateKey>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- DailyPlanRecord.profileId
  date_key date not null,                                         -- DailyPlanRecord.dateKey
  budget_minutes integer not null check (budget_minutes between 3 and 60), -- DailyPlanRecord.budgetMinutes
                                                                    --   (same domain as AppSettings.dailyBudgetMinutes)
  rest_day boolean not null,                                      -- DailyPlanRecord.restDay
  items jsonb not null default '[]'::jsonb                        -- DailyPlanRecord.items: DailyPlanItemRecord[]
    check (jsonb_typeof(items) = 'array'),                        --   KEPT AS JSONB, not a child table: item ids are
                                                                    --   'item-1', 'item-2', ... (daily-plan.ts) which
                                                                    --   are unique only WITHIN a plan, so a child
                                                                    --   table would need a composite (plan_id,
                                                                    --   item_id) key; savePlan() replaces the whole
                                                                    --   document atomically; nothing reads an item
                                                                    --   except through its plan. Element shape:
                                                                    --   {id, activity (ActivityType), exerciseId|null,
                                                                    --    journalId|null, estimatedSeconds, reason,
                                                                    --    kind: new|review|same-day-relearn|journal,
                                                                    --    required}
  notes text[] not null default array[]::text[],                  -- DailyPlanRecord.notes
  generated_at timestamptz not null,                              -- DailyPlanRecord.generatedAt (epoch ms; also the
                                                                    --   conflict rule in importBackup -- a newer
                                                                    --   generatedAt replaces the older plan)
  algorithm text not null,                                        -- DailyPlanRecord.algorithm (e.g. DAILY_PLAN_ALGORITHM
                                                                    --   = 'logicdaily-daily-plan-v1')
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  updated_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  unique (owner_id, date_key),                                    -- getPlan(profileId, dateKey) and
                                                                    --   plans.get([profileId, dateKey]) assume one
                                                                    --   plan per profile per day; Dexie only implied
                                                                    --   that through the id format, here it is stated
  unique (owner_id, id)                                           -- FK target for daily_progress.plan_id
);

-- Dexie: 'id, profileId, [profileId+dateKey], dateKey' -- the cross-profile date index backs
-- content-side analytics ("how hard was today's set for everyone").
create index if not exists idx_plans_date_key on daily_plans (date_key);

-- ---------------------------------------------------------------------------
-- Daily progress (DailyProgressRecord): Dexie compound key becomes the PK.
-- ---------------------------------------------------------------------------
create table if not exists daily_progress (
  owner_id uuid not null references auth.users (id) on delete cascade, -- DailyProgressRecord.profileId
  date_key date not null,                                         -- DailyProgressRecord.dateKey
  plan_id text,                                                   -- DailyProgressRecord.planId (nullable)
  completed_item_ids text[] not null default array[]::text[],     -- DailyProgressRecord.completedItemIds: ids inside
                                                                    --   daily_plans.items jsonb -> no FK possible
  skipped_item_ids text[] not null default array[]::text[],       -- DailyProgressRecord.skippedItemIds
  total_seconds integer not null check (total_seconds >= 0),      -- DailyProgressRecord.totalSeconds
  attempts integer not null check (attempts >= 0),                -- DailyProgressRecord.attempts
  updated_at timestamptz not null,                                -- DailyProgressRecord.updatedAt (epoch ms;
                                                                    --   last-write-wins key during import)
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  primary key (owner_id, date_key),                               -- Dexie '[profileId+dateKey]'
  foreign key (owner_id, plan_id) references daily_plans (owner_id, id) on delete set null
                                                                    --   SET NULL: the day's tally must survive the plan
                                                                    --   being regenerated or deleted
);

create index if not exists idx_progress_date_key on daily_progress (date_key);

-- ---------------------------------------------------------------------------
-- Question-bank issue reports (ExerciseIssueReport).
-- Behavioural note for Phase 3: LocalStore.listIssues() returns rows from every profile, because
-- the single-local-user app treats that queue as "issues for the bank maintainer to triage".
-- Cloud mode cannot keep that as an authenticated read -- see 0002, where the queue is read with
-- the service role (server-side, no client policy), not by widening RLS.
-- ---------------------------------------------------------------------------
create table if not exists exercise_issue_reports (
  id text primary key,                                            -- ExerciseIssueReport.id ('issue-<36>-<exerciseId>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- ExerciseIssueReport.profileId
  exercise_id text not null,                                      -- ExerciseIssueReport.exerciseId. No FK: a report
                                                                    --   must outlive the bank entry it complains about
  kind text not null check (kind in (                             -- ExerciseIssueReport.kind
    'ambiguous','wrong-answer','typo','too-hard','duplicate','other')),
  note text not null,                                             -- ExerciseIssueReport.note
  date_key date not null,                                         -- ExerciseIssueReport.dateKey
  status text not null default 'open' check (status in (          -- ExerciseIssueReport.status
    'open','acknowledged','fixed','rejected')),
  created_at timestamptz not null,                                -- ExerciseIssueReport.createdAt (epoch ms)
  updated_at timestamptz not null default now()                   -- no TS counterpart; DB audit column
);

-- Dexie: 'id, profileId, exerciseId, status, createdAt'.
create index if not exists idx_issues_owner_created   on exercise_issue_reports (owner_id, created_at);
create index if not exists idx_issues_exercise_status on exercise_issue_reports (exercise_id, status);
create index if not exists idx_issues_status          on exercise_issue_reports (status);

-- ---------------------------------------------------------------------------
-- AI usage (AIUsageRecord) -- cost data, so owner-scoped in 0002 like everything else: token
-- counts, model names and error strings all leak what a user asked the coach about.
-- ---------------------------------------------------------------------------
create table if not exists ai_usage_records (
  id text primary key,                                            -- AIUsageRecord.id ('usage-<36>-<kind>')
  owner_id uuid not null references auth.users (id) on delete cascade, -- AIUsageRecord.profileId
  task text not null,                                             -- AIUsageRecord.task
  provider text not null,                                         -- AIUsageRecord.provider
  model text not null,                                            -- AIUsageRecord.model
  prompt_version text not null,                                   -- AIUsageRecord.promptVersion
  created_at timestamptz not null,                                -- AIUsageRecord.createdAt (epoch ms).
                                                                    --   countAIUsageToday() buckets by the user's
                                                                    --   timezone, which lives in app_settings.timezone,
                                                                    --   so the cloud query does
                                                                    --   `(created_at at time zone tz)::date = $1`
                                                                    --   instead of inventing a stored date column.
  latency_ms integer not null check (latency_ms >= 0),            -- AIUsageRecord.latencyMs
  input_chars integer not null check (input_chars >= 0),          -- AIUsageRecord.inputChars
  output_chars integer not null check (output_chars >= 0),        -- AIUsageRecord.outputChars
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),       -- AIUsageRecord.promptTokens
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0), -- .completionTokens
  status text not null check (status in (                         -- AIUsageRecord.status
    'ok','error','rejected','degraded')),
  error_code text,                                                -- AIUsageRecord.errorCode (nullable; category only)
  error_message text,                                             -- AIUsageRecord.errorMessage (nullable; records.ts
                                                                    --   states no user privacy text is stored here)
  updated_at timestamptz not null default now()                   -- no TS counterpart; DB audit column
);

-- Dexie: 'id, profileId, [profileId+createdAt], task, createdAt'
create index if not exists idx_ai_usage_owner_created on ai_usage_records (owner_id, created_at);
create index if not exists idx_ai_usage_task          on ai_usage_records (task);

-- ---------------------------------------------------------------------------
-- Sync bookkeeping (SyncStateRecord) -- one row per profile.
-- ---------------------------------------------------------------------------
create table if not exists sync_states (
  owner_id uuid primary key references auth.users (id) on delete cascade, -- SyncStateRecord.profileId
  local_revision bigint not null default 0 check (local_revision >= 0),   -- SyncStateRecord.localRevision: monotonic
                                                                    --   revision counter (bigint: it only ever grows)
  last_synced_at timestamptz,                                     -- SyncStateRecord.lastSyncedAt (nullable)
  last_synced_revision bigint not null default 0 check (last_synced_revision >= 0), -- .lastSyncedRevision
  pending_ops integer not null default 0 check (pending_ops >= 0),-- SyncStateRecord.pendingOps
  conflicts integer not null default 0 check (conflicts >= 0),    -- SyncStateRecord.conflicts
  mode text not null default 'local' check (mode in ('local','cloud')), -- SyncStateRecord.mode
  updated_at timestamptz not null                                 -- SyncStateRecord.updatedAt (epoch ms)
);

-- ---------------------------------------------------------------------------
-- Per-user settings (AppSettings), keyed by owner exactly like Dexie's
-- settings:'profileId'. Column order follows the zod object.
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade, -- AppSettings.profileId
  display_name text not null default '我'                         -- AppSettings.displayName
    check (char_length(display_name) between 1 and 40),
  onboarded boolean not null default false,                       -- AppSettings.onboarded
  daily_budget_minutes integer not null default 10                -- AppSettings.dailyBudgetMinutes
    check (daily_budget_minutes between 3 and 60),
  new_to_review_ratio double precision not null default 0.4        -- AppSettings.newToReviewRatio
    check (new_to_review_ratio between 0 and 1),
  preferred_categories text[] not null default array[]::text[],   -- AppSettings.preferredCategories, checked against
    check (preferred_categories <@ array[                         --   EXERCISE_CATEGORIES so a typo cannot create a
      'deductive-reasoning','inductive-reasoning','conditional-reasoning',      -- filter that matches no content
      'truth-teller-puzzles','necessary-sufficient-conditions','contrapositive-conversion',
      'causal-reasoning','correlation-vs-causation','statistical-intuition',
      'logical-fallacies','argument-analysis','counterexample-rebuttal',
      'problem-decomposition','decision-analysis']::text[]),
  rest_weekdays integer[] not null default array[]::int[]         -- AppSettings.restWeekdays (0=Sun .. 6=Sat)
    check (rest_weekdays <@ array[0,1,2,3,4,5,6]::integer[]),
  difficulty_bias double precision not null default 0.5           -- AppSettings.difficultyBias
    check (difficulty_bias between 0 and 1),
  timezone text not null default 'UTC',                           -- AppSettings.timezone (IANA name)
  journal_daily_reminder boolean not null default true,           -- AppSettings.journalDailyReminder
  theme text not null default 'system' check (theme in (          -- AppSettings.theme
    'system','light','dark')),
  reminders jsonb not null default '{"enabled": false, "time": "20:00", "quietStart": "22:30", "quietEnd": "07:30", "weeklyReviewDay": 0, "paused": false}'::jsonb,
  --        ^ REMINDER_DEFAULTS in settings.ts. reminders is jsonb because it is read and written as
  --          one unit by saveSettings(settings: AppSettings) and shallow-merged by migrateSettings():
  --          six columns a partial client update could leave half-written would be a downgrade.
    check (jsonb_typeof(reminders) = 'object'),
  ai jsonb not null default '{"enabled": false, "provider": "openai-compatible", "model": "", "baseUrlLabel": "", "temperature": 0.4, "timeoutMs": 25000, "maxOutputTokens": 900, "dailyCallLimit": 20}'::jsonb,
  --  ^ AI_DEFAULTS in settings.ts; same jsonb rationale as reminders. Shape: {enabled, provider,
  --    model, baseUrlLabel, temperature, timeoutMs, maxOutputTokens, dailyCallLimit}.
  --    The NOT (?| ...) predicate below is a structural guard, not a secret scanner: migrateSettings()
  --    already deletes apiKey/key/token from imported backups, and the real key lives in server-side
  --    env only (see the trust-boundary note in 0002). jsonb key existence is CASE-SENSITIVE, so the
  --    list spells out every casing the code or a hand-edited payload could use; ?| tests the whole
  --    array in one expression because a CHECK constraint cannot contain a subquery.
    check (jsonb_typeof(ai) = 'object'
      and ai ? 'provider' and ai ? 'model'
      and not (ai ?| array['apiKey', 'ApiKey', 'apikey', 'api_key', 'API_KEY',
                           'key', 'Key', 'token', 'Token', 'access_token', 'secret'])),
  created_at timestamptz not null default now(),                  -- no TS counterpart; DB audit column
  updated_at timestamptz not null default now()                   -- no TS counterpart; last-write-wins marker
);
