import { getDatabase, type ExerciseRow, type LogicDailyDatabase, BACKUP_SCHEMA_VERSION } from '@/lib/db/database';
import { exerciseSchema, type Exercise } from '@/lib/domain/exercise-schema';
import { migrateSettings, type AppSettings } from '@/lib/domain/settings';
import { journalSchema, type Journal } from '@/lib/domain/journal';
import type { ReviewState } from '@/lib/domain/scheduling';
import type { KnowledgeState } from '@/lib/domain/mastery';
import type {
  AIAnalysisRecord,
  AIUsageRecord,
  AttemptRecord,
  DailyPlanRecord,
  DailyProgressRecord,
  ExerciseIssueReport,
  SyncStateRecord,
} from '@/lib/domain/records';
import type { DateKey } from '@/lib/domain/time';

export interface AttemptQuery {
  profileId: string;
  fromKey?: DateKey;
  toKey?: DateKey;
  exerciseId?: string;
  limit?: number;
}

export interface JournalQuery {
  profileId: string;
  includeDeleted?: boolean;
}

export interface BackupPayload {
  app: 'logicdaily';
  backupSchemaVersion: number;
  localDbVersion: number;
  exportedAt: number;
  profileId: string;
  counts: Record<string, number>;
  data: {
    settings: AppSettings;
    attempts: AttemptRecord[];
    knowledgeStates: KnowledgeState[];
    reviewStates: ReviewState[];
    journals: Journal[];
    plans: DailyPlanRecord[];
    progress: DailyProgressRecord[];
    exerciseIssues: ExerciseIssueReport[];
    aiAnalyses: AIAnalysisRecord[];
    aiUsage: AIUsageRecord[];
  };
}

export class RevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionConflictError';
  }
}

/**
 * 统一数据访问接口：本地实现使用 IndexedDB；将来的云端实现替换同一个接口，
 * 业务代码不直接接触数据库调用。
 */
export interface DataStore {
  mode: 'local' | 'cloud';
  getSettings(profileId: string): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;

  seedExercises(exercises: Exercise[], sourceTag: string): Promise<{ inserted: number; updated: number; removed: number }>;
  getExercise(id: string): Promise<Exercise | null>;
  listExercises(filter?: { category?: string; status?: string }): Promise<Exercise[]>;
  countExercises(): Promise<number>;

  addAttempt(attempt: AttemptRecord): Promise<void>;
  listAttempts(query: AttemptQuery): Promise<AttemptRecord[]>;

  getKnowledgeState(profileId: string, knowledgePointId: string): Promise<KnowledgeState | null>;
  putKnowledgeState(profileId: string, state: KnowledgeState): Promise<void>;
  listKnowledgeStates(profileId: string): Promise<KnowledgeState[]>;

  getReviewState(profileId: string, exerciseId: string): Promise<ReviewState | null>;
  putReviewState(profileId: string, state: ReviewState): Promise<void>;
  listReviewStates(profileId: string): Promise<ReviewState[]>;

  upsertJournal(journal: Journal): Promise<void>;
  getJournal(profileId: string, id: string): Promise<Journal | null>;
  listJournals(query: JournalQuery): Promise<Journal[]>;

  savePlan(plan: DailyPlanRecord): Promise<void>;
  getPlan(profileId: string, dateKey: DateKey): Promise<DailyPlanRecord | null>;
  listPlans(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<DailyPlanRecord[]>;

  getProgress(profileId: string, dateKey: DateKey): Promise<DailyProgressRecord | null>;
  listProgress(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<DailyProgressRecord[]>;
  saveProgress(progress: DailyProgressRecord): Promise<void>;

  reportIssue(issue: ExerciseIssueReport): Promise<void>;
  listIssues(status?: ExerciseIssueReport['status']): Promise<ExerciseIssueReport[]>;

  saveAIAnalysis(record: AIAnalysisRecord): Promise<void>;
  listAIAnalyses(profileId: string, limit?: number): Promise<AIAnalysisRecord[]>;
  saveAIUsage(record: AIUsageRecord): Promise<void>;
  countAIUsageToday(profileId: string, dateKey: DateKey, timezone?: string): Promise<number>;
  listAIUsage(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<AIUsageRecord[]>;

  getSyncState(profileId: string): Promise<SyncStateRecord | null>;
  saveSyncState(state: SyncStateRecord): Promise<void>;
  bumpRevision(profileId: string): Promise<number>;

  exportBackup(profileId: string): Promise<BackupPayload>;
  importBackup(payload: unknown, options?: { replaceExisting?: boolean }): Promise<{ added: number; merged: number; skipped: number }>;
  clearLocalData(profileId: string, options?: { keepExercises?: boolean }): Promise<void>;
  deleteJournalPermanently(profileId: string, journalId: string): Promise<void>;
}

export class LocalStore implements DataStore {
  readonly mode = 'local' as const;
  private readonly db: LogicDailyDatabase;

  constructor(db?: LogicDailyDatabase) {
    this.db = db ?? getDatabase();
  }

  private table(name: keyof LogicDailyDatabase) {
    return this.db.table(name as string);
  }

  async getSettings(profileId: string): Promise<AppSettings | null> {
    const row = await this.db.settings.get(profileId);
    return row ?? null;
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.settings.put(settings, settings.profileId);
    await this.bumpRevision(settings.profileId);
  }

  async seedExercises(exercises: Exercise[], sourceTag: string) {
    const existing = await this.db.exercises.toArray();
    const existingById = new Map(existing.map((e) => [e.id, e]));
    const keepIds = new Set(exercises.map((e) => e.id));
    let inserted = 0;
    let updated = 0;

    for (const exercise of exercises) {
      const prior = existingById.get(exercise.id);
      const row: ExerciseRow = { ...exercise, seededFrom: sourceTag };
      if (!prior) {
        inserted += 1;
      } else if (prior.version === exercise.version && prior.seededFrom === sourceTag) {
        continue;
      } else {
        updated += 1;
      }
      await this.db.exercises.put(row);
    }

    const stale = existing.filter((e) => !keepIds.has(e.id) && e.seededFrom === sourceTag);
    for (const item of stale) await this.db.exercises.delete(item.id);

    return { inserted, updated, removed: stale.length };
  }

  async getExercise(id: string): Promise<Exercise | null> {
    const row = await this.db.exercises.get(id);
    return row ? (stripSeedFields(row) as Exercise) : null;
  }

  async listExercises(filter?: { category?: string; status?: string }): Promise<Exercise[]> {
    let rows: ExerciseRow[];
    if (filter?.category) rows = await this.db.exercises.where('category').equals(filter.category).toArray();
    else rows = await this.db.exercises.toArray();
    if (filter?.status) rows = rows.filter((r) => r.status === filter.status);
    return rows.map((r) => stripSeedFields(r) as Exercise);
  }

  async countExercises(): Promise<number> {
    return this.db.exercises.count();
  }

  async addAttempt(attempt: AttemptRecord): Promise<void> {
    await this.db.attempts.put(attempt);
    await this.bumpRevision(attempt.profileId);
  }

  async listAttempts(query: AttemptQuery): Promise<AttemptRecord[]> {
    const all = await this.db.attempts
      .where('[profileId+dateKey]')
      // Dexie 的 between 默认左闭右开，这里必须闭区间，否则“今天”的记录会被整段丢掉。
      .between(
        [query.profileId, query.fromKey ?? '0000-00-00'],
        [query.profileId, query.toKey ?? '9999-99-99'],
        true,
        true,
      )
      .toArray();
    const filtered = query.exerciseId ? all.filter((a) => a.exerciseId === query.exerciseId) : all;
    const sorted = filtered.sort((a, b) => a.createdAt - b.createdAt);
    if (query.limit && sorted.length > query.limit) return sorted.slice(-query.limit);
    return sorted;
  }

  async getKnowledgeState(profileId: string, knowledgePointId: string): Promise<KnowledgeState | null> {
    const row = await this.db.knowledgeStates.get([profileId, knowledgePointId]);
    return row ? stripProfile(row) : null;
  }

  async putKnowledgeState(profileId: string, state: KnowledgeState): Promise<void> {
    await this.db.knowledgeStates.put({ ...state, profileId });
    await this.bumpRevision(profileId);
  }

  async listKnowledgeStates(profileId: string): Promise<KnowledgeState[]> {
    const rows = await this.db.knowledgeStates.where('profileId').equals(profileId).toArray();
    return rows.map(stripProfile);
  }

  async getReviewState(profileId: string, exerciseId: string): Promise<ReviewState | null> {
    const row = await this.db.reviewStates.get([profileId, exerciseId]);
    return row ? stripProfile(row) : null;
  }

  async putReviewState(profileId: string, state: ReviewState): Promise<void> {
    await this.db.reviewStates.put({ ...state, profileId });
    await this.bumpRevision(profileId);
  }

  async listReviewStates(profileId: string): Promise<ReviewState[]> {
    const rows = await this.db.reviewStates.where('profileId').equals(profileId).toArray();
    return rows.map(stripProfile);
  }

  async upsertJournal(journal: Journal): Promise<void> {
    await this.db.journals.put(journal);
    await this.bumpRevision(journal.profileId);
  }

  async getJournal(profileId: string, id: string): Promise<Journal | null> {
    const row = await this.db.journals.get(id);
    return row && row.profileId === profileId ? row : null;
  }

  async listJournals(query: JournalQuery): Promise<Journal[]> {
    const rows = await this.db.journals.where('profileId').equals(query.profileId).toArray();
    const kept = query.includeDeleted ? rows : rows.filter((r) => !r.deleted);
    return kept.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async savePlan(plan: DailyPlanRecord): Promise<void> {
    await this.db.plans.put(plan);
  }

  async getPlan(profileId: string, dateKey: DateKey): Promise<DailyPlanRecord | null> {
    return (
      (await this.db.plans.where('[profileId+dateKey]').equals([profileId, dateKey]).first()) ?? null
    );
  }

  async listPlans(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<DailyPlanRecord[]> {
    return this.db.plans
      .where('[profileId+dateKey]')
      .between([profileId, fromKey], [profileId, toKey], true, true)
      .toArray();
  }

  async getProgress(profileId: string, dateKey: DateKey): Promise<DailyProgressRecord | null> {
    return (await this.db.progress.get([profileId, dateKey])) ?? null;
  }

  async listProgress(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<DailyProgressRecord[]> {
    return this.db.progress
      .where('[profileId+dateKey]')
      .between([profileId, fromKey], [profileId, toKey], true, true)
      .toArray();
  }

  async saveProgress(progress: DailyProgressRecord): Promise<void> {
    await this.db.progress.put(progress);
    await this.bumpRevision(progress.profileId);
  }

  async reportIssue(issue: ExerciseIssueReport): Promise<void> {
    await this.db.exerciseIssues.put(issue);
  }

  async listIssues(status?: ExerciseIssueReport['status']): Promise<ExerciseIssueReport[]> {
    const rows = await this.db.exerciseIssues.toArray();
    return status ? rows.filter((r) => r.status === status) : rows;
  }

  async saveAIAnalysis(record: AIAnalysisRecord): Promise<void> {
    await this.db.aiAnalyses.put(record);
    await this.bumpRevision(record.profileId);
  }

  async listAIAnalyses(profileId: string, limit = 30): Promise<AIAnalysisRecord[]> {
    const rows = (await this.db.aiAnalyses.toArray()).filter((r) => r.profileId === profileId);
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  async saveAIUsage(record: AIUsageRecord): Promise<void> {
    await this.db.aiUsage.put(record);
  }

  async countAIUsageToday(profileId: string, dateKey: DateKey, timezone = 'UTC'): Promise<number> {
    // 用量按用户所在时区分日，避免跨日统计偏差。
    const rows = await this.db.aiUsage.where('profileId').equals(profileId).toArray();
    return rows.filter((r) => toDateKey(r.createdAt, timezone) === dateKey && r.status !== 'rejected').length;
  }

  async listAIUsage(profileId: string, fromKey: DateKey, toKey: DateKey): Promise<AIUsageRecord[]> {
    const rows = await this.db.aiUsage.toArray();
    return rows
      .filter((r) => r.profileId === profileId)
      .filter((r) => {
        const key = toDateKey(r.createdAt);
        return key >= fromKey && key <= toKey;
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async getSyncState(profileId: string): Promise<SyncStateRecord | null> {
    return (await this.db.syncState.get(profileId)) ?? null;
  }

  async saveSyncState(state: SyncStateRecord): Promise<void> {
    await this.db.syncState.put(state);
  }

  async bumpRevision(profileId: string): Promise<number> {
    const current = await this.db.syncState.get(profileId);
    const next = (current?.localRevision ?? 0) + 1;
    await this.db.syncState.put({
      profileId,
      localRevision: next,
      lastSyncedAt: current?.lastSyncedAt ?? null,
      lastSyncedRevision: current?.lastSyncedRevision ?? 0,
      pendingOps: (current?.pendingOps ?? 0) + 1,
      conflicts: current?.conflicts ?? 0,
      mode: current?.mode ?? 'local',
      updatedAt: Date.now(),
    });
    return next;
  }

  async exportBackup(profileId: string): Promise<BackupPayload> {
    const [settings, attempts, knowledgeStates, reviewStates, journals, plans, progress, exerciseIssues, aiAnalyses, aiUsage] =
      await Promise.all([
        this.db.settings.get(profileId),
        this.db.attempts.where('profileId').equals(profileId).toArray(),
        this.db.knowledgeStates.where('profileId').equals(profileId).toArray(),
        this.db.reviewStates.where('profileId').equals(profileId).toArray(),
        this.db.journals.where('profileId').equals(profileId).toArray(),
        this.db.plans.where('profileId').equals(profileId).toArray(),
        this.db.progress.where('profileId').equals(profileId).toArray(),
        this.db.exerciseIssues.where('profileId').equals(profileId).toArray(),
        this.db.aiAnalyses.where('profileId').equals(profileId).toArray(),
        this.db.aiUsage.where('profileId').equals(profileId).toArray(),
      ]);

    return {
      app: 'logicdaily',
      backupSchemaVersion: BACKUP_SCHEMA_VERSION,
      localDbVersion: this.db.verno,
      exportedAt: Date.now(),
      profileId,
      counts: {
        attempts: attempts.length,
        journals: journals.length,
        plans: plans.length,
        aiAnalyses: aiAnalyses.length,
      },
      data: {
        settings: settings ? migrateSettings(settings) : migrateSettings({ profileId }),
        attempts,
        knowledgeStates: knowledgeStates.map(stripProfile),
        reviewStates: reviewStates.map(stripProfile),
        journals,
        plans,
        progress,
        exerciseIssues,
        aiAnalyses,
        aiUsage,
      },
    };
  }

  async importBackup(
    payload: unknown,
    options?: { replaceExisting?: boolean },
  ): Promise<{ added: number; merged: number; skipped: number }> {
    const parsed = validateBackupPayload(payload);
    const profileId = parsed.profileId;
    let added = 0;
    let merged = 0;
    let skipped = 0;

    await this.db.transaction(
      'rw',
      [
        this.db.settings,
        this.db.attempts,
        this.db.knowledgeStates,
        this.db.reviewStates,
        this.db.journals,
        this.db.plans,
        this.db.progress,
        this.db.exerciseIssues,
        this.db.aiAnalyses,
        this.db.aiUsage,
        this.db.syncState,
      ],
      async () => {
        await this.db.settings.put(parsed.data.settings, profileId);

        if (options?.replaceExisting) {
          await this.db.attempts.where('profileId').equals(profileId).delete();
          await this.db.journals.where('profileId').equals(profileId).delete();
          await this.db.reviewStates.where('profileId').equals(profileId).delete();
          await this.db.knowledgeStates.where('profileId').equals(profileId).delete();
        }

        const existingAttempts = new Set(
          (await this.db.attempts.where('profileId').equals(profileId).toArray()).map((a) => a.id),
        );
        for (const attempt of parsed.data.attempts) {
          if (existingAttempts.has(attempt.id)) {
            skipped += 1;
            continue;
          }
          await this.db.attempts.put(attempt);
          added += 1;
        }

        const existingJournals = new Map(
          (await this.db.journals.where('profileId').equals(profileId).toArray()).map((j) => [j.id, j]),
        );
        for (const journal of parsed.data.journals) {
          const prior = existingJournals.get(journal.id);
          if (!prior) {
            await this.db.journals.put(journal);
            added += 1;
          } else if (journal.updatedAt > prior.updatedAt) {
            // 一致性规则：同一 id 以较新的 updatedAt 为准，并提示用户发生过覆盖。
            await this.db.journals.put(journal);
            merged += 1;
          } else {
            skipped += 1;
          }
        }

        for (const state of parsed.data.reviewStates) {
          const prior = await this.db.reviewStates.get([profileId, state.exerciseId]);
          if (prior && prior.updatedAt >= state.updatedAt) {
            skipped += 1;
            continue;
          }
          await this.db.reviewStates.put({ ...state, profileId });
          merged += prior ? 1 : 0;
          if (!prior) added += 1;
        }

        for (const state of parsed.data.knowledgeStates) {
          const prior = await this.db.knowledgeStates.get([profileId, state.knowledgePointId]);
          if (prior && prior.updatedAt >= state.updatedAt) {
            skipped += 1;
            continue;
          }
          await this.db.knowledgeStates.put({ ...state, profileId });
          merged += prior ? 1 : 0;
          if (!prior) added += 1;
        }

        for (const plan of parsed.data.plans) {
          const prior = await this.db.plans.get([profileId, plan.dateKey]);
          if (prior && prior.generatedAt >= plan.generatedAt) {
            skipped += 1;
            continue;
          }
          await this.db.plans.put(plan);
        }

        for (const record of parsed.data.progress) {
          const prior = await this.db.progress.get([profileId, record.dateKey]);
          if (prior && prior.updatedAt >= record.updatedAt) {
            skipped += 1;
            continue;
          }
          await this.db.progress.put(record);
        }

        for (const issue of parsed.data.exerciseIssues) await this.db.exerciseIssues.put(issue);
        for (const analysis of parsed.data.aiAnalyses) await this.db.aiAnalyses.put(analysis);
        for (const usage of parsed.data.aiUsage) await this.db.aiUsage.put(usage);

        const revision = (await this.db.syncState.get(profileId))?.localRevision ?? 0;
        await this.db.syncState.put({
          profileId,
          localRevision: revision + 1,
          lastSyncedAt: null,
          lastSyncedRevision: 0,
          pendingOps: 0,
          conflicts: merged,
          mode: 'local',
          updatedAt: Date.now(),
        });
      },
    );

    await this.bumpRevision(profileId);
    return { added, merged, skipped };
  }

  async clearLocalData(profileId: string, options?: { keepExercises?: boolean }): Promise<void> {
    await this.db.transaction(
      'rw',
      [
        this.db.settings,
        this.db.attempts,
        this.db.knowledgeStates,
        this.db.reviewStates,
        this.db.journals,
        this.db.plans,
        this.db.progress,
        this.db.exerciseIssues,
        this.db.aiAnalyses,
        this.db.aiUsage,
        this.db.syncState,
        this.db.meta,
        this.db.exercises,
      ],
      async () => {
        await this.db.attempts.where('profileId').equals(profileId).delete();
        await this.db.knowledgeStates.where('profileId').equals(profileId).delete();
        await this.db.reviewStates.where('profileId').equals(profileId).delete();
        await this.db.journals.where('profileId').equals(profileId).delete();
        await this.db.plans.where('profileId').equals(profileId).delete();
        await this.db.progress.where('profileId').equals(profileId).delete();
        await this.db.exerciseIssues.where('profileId').equals(profileId).delete();
        await this.db.aiAnalyses.where('profileId').equals(profileId).delete();
        await this.db.aiUsage.where('profileId').equals(profileId).delete();
        await this.db.settings.delete(profileId);
        await this.db.syncState.delete(profileId);
        await this.db.meta.delete(`onboarded:${profileId}`).catch(() => undefined);
        if (!options?.keepExercises) await this.db.exercises.clear();
      },
    );
  }

  async deleteJournalPermanently(profileId: string, journalId: string): Promise<void> {
    const row = await this.db.journals.get(journalId);
    if (!row || row.profileId !== profileId) {
      throw new RevisionConflictError('要删除的日志不存在或不属于当前用户。');
    }
    await this.db.journals.delete(journalId);
    await this.bumpRevision(profileId);
  }
}

function stripProfile<T extends { profileId: string }>(row: T): Omit<T, 'profileId'> {
  const { profileId: _profileId, ...rest } = row;
  void _profileId;
  return rest;
}

function stripSeedFields(row: ExerciseRow): Omit<ExerciseRow, 'seededFrom'> {
  const { seededFrom: _seededFrom, ...rest } = row;
  void _seededFrom;
  return rest;
}

function toDateKey(ts: number, zone = 'UTC'): DateKey {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ts),
  );
  return parts.replace(/\//g, '-');
}

const BACKUP_TOP_KEYS = [
  'app',
  'backupSchemaVersion',
  'localDbVersion',
  'exportedAt',
  'profileId',
  'counts',
  'data',
] as const;

const BACKUP_DATA_KEYS = [
  'settings',
  'attempts',
  'knowledgeStates',
  'reviewStates',
  'journals',
  'plans',
  'progress',
  'exerciseIssues',
  'aiAnalyses',
  'aiUsage',
] as const;

/** 导入前先验证文件结构与版本，避免无效数据污染本地库。 */
export function validateBackupPayload(payload: unknown): BackupPayload {
  if (typeof payload !== 'object' || payload === null) throw new Error('备份文件不是一个对象。');
  const raw = payload as Record<string, unknown>;
  for (const key of BACKUP_TOP_KEYS) {
    if (!(key in raw)) throw new Error(`备份缺少字段：${key}`);
  }
  if (raw.app !== 'logicdaily') throw new Error('这不是 LogicDaily 的备份文件。');
  const version = Number(raw.backupSchemaVersion);
  if (!Number.isInteger(version) || version < 1 || version > BACKUP_SCHEMA_VERSION) {
    throw new Error(`备份版本 ${version} 不被当前应用支持（支持 1..${BACKUP_SCHEMA_VERSION}）。`);
  }
  const data = raw.data as Record<string, unknown>;
  if (typeof data !== 'object' || data === null) throw new Error('备份的 data 字段不是对象。');
  for (const key of BACKUP_DATA_KEYS) {
    if (!(key in data)) throw new Error(`备份缺少 data.${key}`);
  }
  if (typeof raw.profileId !== 'string' || raw.profileId.length === 0) throw new Error('备份缺少 profileId。');

  const settings = migrateSettings(data.settings);
  const journals = (data.journals as unknown[]).map((j) => journalSchema.parse(j));
  const attempts = data.attempts as AttemptRecord[];
  for (const attempt of attempts) {
    if (typeof attempt?.id !== 'string' || typeof attempt.exerciseId !== 'string') {
      throw new Error('备份中的作答记录结构无效。');
    }
  }

  return {
    app: 'logicdaily',
    backupSchemaVersion: version,
    localDbVersion: Number(raw.localDbVersion) || 0,
    exportedAt: Number(raw.exportedAt) || 0,
    profileId: raw.profileId,
    counts: (raw.counts ?? {}) as Record<string, number>,
    data: {
      settings,
      journals,
      attempts,
      knowledgeStates: (data.knowledgeStates as KnowledgeState[]) ?? [],
      reviewStates: (data.reviewStates as ReviewState[]) ?? [],
      plans: (data.plans as DailyPlanRecord[]) ?? [],
      progress: (data.progress as DailyProgressRecord[]) ?? [],
      exerciseIssues: (data.exerciseIssues as ExerciseIssueReport[]) ?? [],
      aiAnalyses: (data.aiAnalyses as AIAnalysisRecord[]) ?? [],
      aiUsage: (data.aiUsage as AIUsageRecord[]) ?? [],
    },
  };
}

/** 练习题目结构的等价校验：导入的题目 JSON 与本地库中的题目都走同一道关。 */
export function parseExerciseRows(rows: unknown[]): Exercise[] {
  return rows.map((row) => exerciseSchema.parse(row));
}
