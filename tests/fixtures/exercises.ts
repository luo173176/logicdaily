import type { Exercise } from '@/lib/domain/exercise-schema';

const explanation = {
  summary: '由“若 P 则 Q”和“非 Q”可以有效推出“非 P”，这是否定后件式。',
  steps: ['把题干写成“若 P 则 Q”。', '确认已知的是“非 Q”。', '使用否定后件式得到“非 P”。'],
  commonMistakes: [{ option: 'B', errorType: 'affirming-consequent' as const, why: '把条件的方向弄反了。' }],
  takeaway: '否定后件可以否定前件，肯定后件不行。',
};

const meta = {
  version: 1,
  category: 'conditional-reasoning' as const,
  knowledgePoints: ['modus-ponens', 'affirming-consequent'],
  difficulty: 2,
  estimatedSeconds: 60,
  reviewTags: ['条件推理'],
  provenance: '原创示例题，仅用于单元测试。',
  status: 'validated' as const,
  grading: { partialCredit: true, orderTolerance: 0.2 },
};

export function singleChoiceFixture(): Exercise {
  return {
    ...meta,
    id: 'ex-test-single',
    format: 'single-choice',
    stem: '如果明天下雨，比赛就改到周四。已知比赛没有改到周四，可以推出什么？',
    options: [
      { key: 'A', text: '明天没有下雨' },
      { key: 'B', text: '明天下雨了', errorType: 'affirming-consequent', reason: '把否定后件用成了肯定后件' },
      { key: 'C', text: '无法判断天气' },
      { key: 'D', text: '比赛照常举行', errorType: 'missing-reasoning-step', reason: '结论跳出了前提范围' },
    ],
    answer: { keys: ['A'] },
    alternatives: [],
    explanation,
  };
}

export function multiChoiceFixture(partialCredit = true): Exercise {
  return {
    ...meta,
    id: 'ex-test-multi',
    format: 'multi-choice',
    stem: '一份问卷显示 80% 的用户满意。要判断这个结论可靠，需要检查哪些方面？',
    grading: { partialCredit, orderTolerance: 0.2 },
    options: [
      { key: 'A', text: '样本量有多大' },
      { key: 'B', text: '样本是否随机抽取' },
      { key: 'C', text: '受访总人数是多少', errorType: 'base-rate-neglect', reason: '总量不等于样本质量' },
      { key: 'D', text: '问题措辞是否带有引导' },
    ],
    answer: { keys: ['A', 'B', 'D'] },
    alternatives: [],
    explanation: {
      ...explanation,
      summary: '满意度是抽样结论，可靠性取决于样本量、抽样方式与测量工具。',
      steps: ['识别结论是关于总体的比例。', '列出影响比例可靠性的三个因素。', '排除与可靠性无关的总量信息。'],
      commonMistakes: [{ option: 'C', errorType: 'base-rate-neglect', why: '把分母大小当作样本代表性。' }],
      takeaway: '先问怎么抽的样，再问百分比是多少。',
    },
  };
}

export function shortAnswerFixture(): Exercise {
  return {
    ...meta,
    id: 'ex-test-short',
    format: 'short-answer',
    stem: '“我连续三天早起打卡，同事都说我变了。请指出这段陈述里至少一个需要补充的信息。”用两三句话回答。',
    answer: {
      checkpoints: [
        { id: 'c1', label: '指出隐含前提', keywords: ['隐含前提', '前提'], weight: 2, required: true },
        { id: 'c2', label: '给出其他解释', keywords: ['也可能', '另一种', '反例', '也许'], weight: 2, required: false },
        { id: 'c3', label: '说明如何验证', keywords: ['验证', '观察', '确认', '数据'], weight: 1, required: false },
      ],
      correctRatio: 0.8,
      partialRatio: 0.5,
      modelAnswer:
        '这里隐含了“同事的评价反映了我的整体变化”这一前提；也可能只是他们注意到了外在行为。可以用一周的稳定记录来验证。',
    },
    alternatives: [],
    explanation: {
      ...explanation,
      summary: '他人评价是间接证据，需要与可观察指标区分。',
      steps: ['找出被默认为真的前提。', '提出同样能解释现状的其他原因。', '设计可观察的验证方式。'],
      commonMistakes: [{ errorType: 'insufficient-evidence', why: '把少量评价当作稳定变化的证据。' }],
      takeaway: '先标出隐含前提，再决定相信多少。',
    },
  };
}

export function orderingFixture(): Exercise {
  return {
    ...meta,
    id: 'ex-test-order',
    category: 'problem-decomposition' as const,
    knowledgePoints: ['subgoal-split', 'dependency-order'],
    format: 'ordering',
    stem: '按能有效推进问题的顺序排列以下步骤。',
    items: [
      { key: 's1', text: '写清真正要回答的问题' },
      { key: 's2', text: '列出可以被核对的事实' },
      { key: 's3', text: '提出至少两种解释' },
      { key: 's4', text: '设计能区分解释的验证行动' },
    ],
    answer: { keys: ['s1', 's2', 's3', 's4'] },
    alternatives: [],
    explanation: {
      ...explanation,
      summary: '先定义问题，再固定事实，然后展开备选解释，最后设计区分性验证。',
      steps: ['明确问题边界。', '区分事实与推测。', '生成多个解释。', '找出预测不同的验证行动。'],
      commonMistakes: [{ errorType: 'missing-reasoning-step', why: '跳过事实核对直接进入解释。' }],
      takeaway: '顺序错了，后面的努力可能都在回答错误的问题。',
    },
  };
}

export function openResponseFixture(): Exercise {
  return {
    ...meta,
    id: 'ex-test-open',
    category: 'argument-analysis' as const,
    knowledgePoints: ['conclusion-identification', 'implicit-premise'],
    difficulty: 3,
    format: 'open-response',
    stem: '“我们公司去年加班最多的团队离职率也最高，所以加班导致了离职。”请写出你对这个论证的评价。',
    answer: {
      scale: [
        { score: 0, label: '接受结论', criteria: '认为相关即因果，没有提出其他解释。' },
        { score: 2, label: '提出疑问', criteria: '感到证据不足，但说不出具体缺口。' },
        { score: 3, label: '指出机制', criteria: '能说出至少一个替代解释或共同的第三因素。' },
        { score: 4, label: '给出检验', criteria: '除替代解释外，还能说明用什么数据或访谈来区分。' },
      ],
      guidance: '写出：结论依赖哪些前提、有哪些同样成立的解释、什么证据能区分它们。',
      selfAssessed: true,
    },
    alternatives: [],
    explanation: {
      ...explanation,
      summary: '相关有两种以上解释：加班导致离职、离职倾向者更易留在加班多的团队、或团队管理问题同时导致两者。',
      steps: ['标出论证的隐含前提。', '列出同样兼容数据的替代解释。', '指出能区分解释所需的数据。'],
      commonMistakes: [{ errorType: 'correlation-as-causation', why: '由共变直接推出因果方向。' }],
      takeaway: '看到相关，先问“还有什么解释”。',
    },
  };
}

export function trueFalseFixture(value: boolean): Exercise {
  return {
    ...meta,
    id: 'ex-test-tf',
    category: 'contrapositive-conversion' as const,
    knowledgePoints: ['contrapositive'],
    format: 'true-false',
    stem: '“如果账号被盗，则会出现异常登录。”与它的逆否命题“如果没有出现异常登录，则账号没有被盗”是等价的。',
    answer: { value },
    alternatives: [],
    explanation: {
      ...explanation,
      summary: '原命题与逆否命题逻辑等价，与逆命题不等价。',
      steps: ['写出原命题形式 若 P 则 Q。', '写出逆否命题 若非 Q 则非 P。', '确认真值表完全一致。'],
      commonMistakes: [{ errorType: 'affirming-consequent', why: '把逆命题当成等价命题。' }],
      takeaway: '等价的是逆否，不是逆。',
    },
  };
}

export function allFixtures(): Exercise[] {
  return [
    singleChoiceFixture(),
    multiChoiceFixture(),
    shortAnswerFixture(),
    orderingFixture(),
    openResponseFixture(),
    trueFalseFixture(true),
  ];
}
