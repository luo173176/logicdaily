import Dexie, { type Table } from 'dexie';

import type { AppSettings } from '@/lib/domain/settings';
import type { Journal } from '@/lib/domain/journal';
import type { Exercise } from '@/lib/domain/exercise-schema';
import type { ReviewState } from '@/lib/domain/scheduling';
import type { KnowledgeState } from '@/lib/domain/mastery';
import type {
  AIAnalysisRecord,
  AIUsageRecord,
  AttemptRecord,
  DailyPlanRecord,
  DailyProgressRecord,
  ExerciseIssueReport,
  MetaRecord,
  SyncStateRecord,
} from '@/lib/domain/records';

export const LOCAL_DB_VERSION = 1;
export const BACKUP_SCHEMA_VERSION = 1;

/** 内容包版本随题目一起保存，便于题目更新后重新播种。 */
export type ExerciseRow = Exercise & { seededFrom: string };

export class LogicDailyDatabase extends Dexie {
  meta!: Table<MetaRecord, string>;
  settings!: Table<AppSettings, string>;
  exercises!: Table<ExerciseRow, string>;
  attempts!: Table<AttemptRecord, string>;
  knowledgeStates!: Table<KnowledgeState & { profileId: string }, string>;
  reviewStates!: Table<ReviewState & { profileId: string }, string>;
  journals!: Table<Journal, string>;
  plans!: Table<DailyPlanRecord, string>;
  progress!: Table<DailyProgressRecord, string>;
  exerciseIssues!: Table<ExerciseIssueReport, string>;
  aiAnalyses!: Table<AIAnalysisRecord, string>;
  aiUsage!: Table<AIUsageRecord, string>;
  syncState!: Table<SyncStateRecord, string>;

  constructor(name = 'logicdaily') {
    super(name);

    this.version(1).stores({
      meta: 'key',
      settings: 'profileId',
      exercises: 'id, category, format, difficulty, status',
      attempts: 'id, profileId, [profileId+dateKey], [profileId+exerciseId], exerciseId, dateKey, createdAt',
      knowledgeStates: '[profileId+knowledgePointId], profileId, knowledgePointId',
      reviewStates: '[profileId+exerciseId], profileId, exerciseId, dueDateKey',
      journals: 'id, profileId, [profileId+deleted], [profileId+updatedAt], createdAt, reviewDueDateKey',
      plans: 'id, profileId, [profileId+dateKey], dateKey',
      progress: '[profileId+dateKey], profileId, dateKey',
      exerciseIssues: 'id, profileId, exerciseId, status, createdAt',
      aiAnalyses: 'id, profileId, [profileId+subjectKind], subjectId, createdAt',
      aiUsage: 'id, profileId, [profileId+createdAt], task, createdAt',
      syncState: 'profileId',
    });
  }
}

let shared: LogicDailyDatabase | null = null;

export function getDatabase(): LogicDailyDatabase {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB，无法在本地保存数据。');
  }
  shared ??= new LogicDailyDatabase();
  return shared;
}

/** 复合主键需要显式拼接，Dexie 的 '[a+b]' 索引按数组键查找。 */
export function knowledgeStateKey(profileId: string, knowledgePointId: string): string {
  return `${profileId}::${knowledgePointId}`;
}

export function reviewStateKey(profileId: string, exerciseId: string): string {
  return `${profileId}::${exerciseId}`;
}

export function progressKey(profileId: string, dateKey: string): string {
  return `${profileId}::${dateKey}`;
}
