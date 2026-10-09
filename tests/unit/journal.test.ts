import { describe, expect, it } from 'vitest';

import { createEmptyJournal, journalCompleteness, journalEvidenceSchema, journalSchema, searchJournals, type Journal } from '@/lib/domain/journal';

function filled(overrides: Partial<Journal> = {}): Journal {
  return {
    ...createEmptyJournal({ id: 'j-1', profileId: 'p1', nowTs: 1_700_000_000_000 }),
    ...overrides,
  };
}

describe('新建日志', () => {
  it('快速记录只要求标题与问题，其余字段有可用默认值', () => {
    const journal = createEmptyJournal({ id: 'j-1', profileId: 'p1', nowTs: 100, title: '要不要换工作' });
    expect(journal.title).toBe('要不要换工作');
    expect(journal.status).toBe('open');
    expect(journal.reviewDueDateKey).toBeNull();
    expect(journal.deleted).toBe(false);
    expect(journal.aiConsent).toBe(false);
    expect(journal.evidence).toEqual([]);
    expect(journal.steps).toEqual([]);
    expect(journal.createdAt).toBe(journal.updatedAt);
  });

  it('没有标题时给出占位标题，超长标题被截断', () => {
    expect(createEmptyJournal({ id: 'j', profileId: 'p', nowTs: 1 }).title).toBe('未命名思考');
    expect(createEmptyJournal({ id: 'j', profileId: 'p', nowTs: 1, title: '长'.repeat(200) }).title).toHaveLength(120);
  });

  it('缺少 profileId 或标题的载荷会被 schema 拒绝', () => {
    expect(journalSchema.safeParse({ id: 'j-1', createdAt: 1, updatedAt: 1 }).success).toBe(false);
  });

  it('证据的立场、可靠性都有约束', () => {
    expect(journalEvidenceSchema.safeParse({ id: 'e', journalId: 'j', stance: 'oppose', text: '反例', createdAt: 1 }).success).toBe(true);
    expect(journalEvidenceSchema.safeParse({ id: 'e', journalId: 'j', stance: '因为所以', text: 'x', createdAt: 1 }).success).toBe(false);
    expect(journalEvidenceSchema.safeParse({ id: 'e', journalId: 'j', stance: 'support', text: 'x', reliability: 9, createdAt: 1 }).success).toBe(
      false,
    );
    expect(journalEvidenceSchema.safeParse({ id: 'e', journalId: 'j', stance: 'support', text: '', createdAt: 1 }).success).toBe(false);
  });
});

describe('完成度', () => {
  it('空日志为 0%，八个向导字段全填为 100%', () => {
    expect(journalCompleteness(filled())).toEqual({ filled: 0, total: 8, percent: 0 });

    const complete = filled({
      problem: '问题',
      background: '背景',
      facts: '事实',
      assumptions: '假设',
      conclusion: '结论',
      alternativeExplanations: '另一种解释',
      keyUncertainties: '关键不确定',
      verificationActions: '验证动作',
    });
    expect(journalCompleteness(complete)).toEqual({ filled: 8, total: 8, percent: 100 });
  });

  it('只有空白字符不算已填写', () => {
    expect(journalCompleteness(filled({ problem: '   ' })).filled).toBe(0);
  });
});

describe('搜索', () => {
  const journals: Journal[] = [
    filled({ id: 'j-1', title: '要不要接这个项目', tags: ['工作'], problem: '工期估计太乐观' }),
    filled({
      id: 'j-2',
      title: '通勤路线',
      tags: ['生活'],
      conclusion: '走二环路更快',
      evidence: [{ id: 'e1', journalId: 'j-2', stance: 'oppose', text: '早高峰二环经常封', source: '', reliability: 4, createdAt: 1 }],
      steps: [{ stepId: 's1', text: '我假设了路况不变', updatedAt: 1 }],
    }),
    filled({ id: 'j-3', title: '已删除的想法', problem: '不该被搜到', deleted: true }),
  ];

  it('软删除的日志永远搜不到', () => {
    expect(searchJournals(journals, '不该').map((j) => j.id)).toEqual([]);
  });

  it('多关键词要求全部命中', () => {
    expect(searchJournals(journals, '二环 封').map((j) => j.id)).toEqual(['j-2']);
    expect(searchJournals(journals, '二环 不存在的词')).toEqual([]);
  });

  it('搜索覆盖步骤与证据正文，而不只是主字段', () => {
    expect(searchJournals(journals, '路况不变').map((j) => j.id)).toEqual(['j-2']);
    expect(searchJournals(journals, '假设').map((j) => j.id)).toEqual(['j-2']);
  });

  it('标签过滤与关键词可以叠加，空查询返回全部未删除日志', () => {
    expect(searchJournals(journals, '', '工作').map((j) => j.id)).toEqual(['j-1']);
    expect(searchJournals(journals, '项目', '生活')).toEqual([]);
    expect(searchJournals(journals, '').map((j) => j.id)).toEqual(['j-1', 'j-2']);
  });

  it('英文关键词大小写不敏感', () => {
    const list = [filled({ id: 'j-en', problem: 'SQL injection 风险' })];
    expect(searchJournals(list, 'sql').map((j) => j.id)).toEqual(['j-en']);
  });
});

describe('导入外部数据时的边界', () => {
  it('未知字段被丢弃而不是写进记录', () => {
    const parsed = journalSchema.parse({ ...filled(), isAdmin: true });
    expect('isAdmin' in parsed).toBe(false);
  });

  it('标签数量与长度受限', () => {
    expect(journalSchema.safeParse({ ...filled(), tags: Array.from({ length: 20 }, (_, i) => `t${i}`) }).success).toBe(false);
    expect(journalSchema.safeParse({ ...filled(), tags: ['超长的标签'.repeat(10)] }).success).toBe(false);
  });
});
