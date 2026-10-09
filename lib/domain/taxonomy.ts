export const EXERCISE_CATEGORIES = [
  'deductive-reasoning',
  'inductive-reasoning',
  'conditional-reasoning',
  'truth-teller-puzzles',
  'necessary-sufficient-conditions',
  'contrapositive-conversion',
  'causal-reasoning',
  'correlation-vs-causation',
  'statistical-intuition',
  'logical-fallacies',
  'argument-analysis',
  'counterexample-rebuttal',
  'problem-decomposition',
  'decision-analysis',
] as const;

export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  'deductive-reasoning': '演绎推理',
  'inductive-reasoning': '归纳推理',
  'conditional-reasoning': '条件推理',
  'truth-teller-puzzles': '真假话问题',
  'necessary-sufficient-conditions': '充分条件与必要条件',
  'contrapositive-conversion': '逆否命题与错误逆推',
  'causal-reasoning': '因果推理',
  'correlation-vs-causation': '相关性与因果性辨析',
  'statistical-intuition': '统计与概率直觉',
  'logical-fallacies': '常见逻辑谬误',
  'argument-analysis': '论据与结论识别',
  'counterexample-rebuttal': '反例与反驳',
  'problem-decomposition': '多步骤问题拆解',
  'decision-analysis': '决策分析与权衡',
};

export const CATEGORY_DESCRIPTIONS: Record<ExerciseCategory, string> = {
  'deductive-reasoning': '从给定前提出发，判断结论是否被必然推出。',
  'inductive-reasoning': '从有限事例得出一般性结论，并评估结论的强度。',
  'conditional-reasoning': '处理“如果……那么……”式命题的推理规则。',
  'truth-teller-puzzles': '在若干陈述中根据真假约束重建事实。',
  'necessary-sufficient-conditions': '区分“有它足够”与“没它不行”。',
  'contrapositive-conversion': '原命题、逆命题、否命题、逆否命题之间的等价关系。',
  'causal-reasoning': '识别原因、结果、共同原因与中介机制。',
  'correlation-vs-causation': '两件事同时发生，不等于一件事导致另一件。',
  'statistical-intuition': '基础概率、样本量、比率与平均数的常见直觉陷阱。',
  'logical-fallacies': '识别论证中结构或内容上的缺陷。',
  'argument-analysis': '拆出结论、前提、隐含假设与支撑关系。',
  'counterexample-rebuttal': '用一个反例削弱全称结论，并判断反驳是否击中要害。',
  'problem-decomposition': '把复杂问题拆成可分别处理的子问题。',
  'decision-analysis': '在多个方案之间比较目标、证据、代价与不确定性。',
};

export const LOGIC_ERROR_TYPES = [
  'affirming-consequent',
  'denying-antecedent',
  'hasty-generalization',
  'correlation-as-causation',
  'ignoring-counterexample',
  'equivocation',
  'false-dilemma',
  'circular-reasoning',
  'ad-hominem',
  'appeal-to-majority',
  'insufficient-evidence',
  'conclusion-overreach',
  'base-rate-neglect',
  'premise-misidentification',
  'missing-reasoning-step',
] as const;

export type LogicErrorType = (typeof LOGIC_ERROR_TYPES)[number];

export const LOGIC_ERROR_LABELS: Record<LogicErrorType, string> = {
  'affirming-consequent': '肯定后件',
  'denying-antecedent': '否定前件',
  'hasty-generalization': '以偏概全',
  'correlation-as-causation': '混淆相关性与因果性',
  'ignoring-counterexample': '忽略反例',
  equivocation: '偷换概念',
  'false-dilemma': '错误二分',
  'circular-reasoning': '循环论证',
  'ad-hominem': '人身攻击',
  'appeal-to-majority': '诉诸多数',
  'insufficient-evidence': '证据不足',
  'conclusion-overreach': '结论超出证据范围',
  'base-rate-neglect': '忽略基础概率',
  'premise-misidentification': '前提识别错误',
  'missing-reasoning-step': '推理步骤缺失',
};

export const LOGIC_ERROR_EXPLANATIONS: Record<LogicErrorType, string> = {
  'affirming-consequent': '由“若 P 则 Q”和 Q 成立，推出 P 成立。例：如果下雨地会湿；地湿了，所以下过雨。（可能是洒水车）',
  'denying-antecedent': '由“若 P 则 Q”和 P 不成立，推出 Q 不成立。例：如果努力就会进步；他没努力，所以他不会进步。',
  'hasty-generalization': '由少量或不具代表性的样本得出普遍结论。',
  'correlation-as-causation': '因为两者同时变化或同时出现，就断定存在因果关系。',
  'ignoring-counterexample': '全称结论已经存在可用反例，仍把它当作成立。',
  equivocation: '同一个词在论证前后含义发生变化，结论因此失去支撑。',
  'false-dilemma': '把多种可能压缩成非此即彼的两个选项。',
  'circular-reasoning': '把待证明的结论放进前提里。',
  'ad-hominem': '用论证者的身份或品行代替对论证本身的评估。',
  'appeal-to-majority': '用相信的人多来证明结论为真。',
  'insufficient-evidence': '证据数量或质量不足以支撑所给结论。',
  'conclusion-overreach': '证据只支持较弱结论，却给出了更强或更远的结论。',
  'base-rate-neglect': '只看个案特征，忽略总体基础概率。',
  'premise-misidentification': '把背景信息当结论，或漏掉真正起作用的前提。',
  'missing-reasoning-step': '结论与前提之间存在未说明的中间环节。',
};

export const CAUSE_TYPES = ['none', 'logic-skill', 'knowledge-gap', 'carelessness', 'misread-question', 'ambiguous-question', 'unknown'] as const;

export type CauseType = (typeof CAUSE_TYPES)[number];

export const CAUSE_LABELS: Record<CauseType, string> = {
  none: '作答正确，无需归因',
  'logic-skill': '推理方式需要调整',
  'knowledge-gap': '相关知识或术语不熟悉',
  carelessness: '作答过快或笔误',
  'misread-question': '读题理解偏差',
  'ambiguous-question': '题目表述存在歧义',
  unknown: '暂时无法判断',
};

export const CAUSE_MEANINGS: Record<CauseType, string> = {
  none: '本次作答与标准答案一致，仅记录表现用于复习调度。',
  'logic-skill': '答错来自一种可命名的推理错误，值得针对性练习。',
  'knowledge-gap': '题目所需的事实或概念暂时缺失，补知识比刷题更有效。',
  carelessness: '能力可能足够，但作答过程太快或选错选项。',
  'misread-question': '对题干的理解与题目设定不同，重读题干即可。',
  'ambiguous-question': '题目本身可能存在多个合理答案，已记入题库复核队列。',
  unknown: '信息不足，不做归因，只记录事实。',
};

export const KNOWLEDGE_POINTS: ReadonlyArray<{
  id: string;
  label: string;
  category: ExerciseCategory;
  note: string;
}> = [
  { id: 'modus-ponens', label: '肯定前件式', category: 'conditional-reasoning', note: '若 P 则 Q；P；所以 Q。' },
  { id: 'modus-tollens', label: '否定后件式', category: 'conditional-reasoning', note: '若 P 则 Q；非 Q；所以非 P。' },
  { id: 'affirming-consequent', label: '肯定后件谬误', category: 'conditional-reasoning', note: '由 Q 推 P 无效。' },
  { id: 'denying-antecedent', label: '否定前件谬误', category: 'conditional-reasoning', note: '由非 P 推非 Q 无效。' },
  { id: 'necessary-condition', label: '必要条件', category: 'necessary-sufficient-conditions', note: '没它不行。' },
  { id: 'sufficient-condition', label: '充分条件', category: 'necessary-sufficient-conditions', note: '有它足够。' },
  { id: 'only-if', label: '“只有……才……”的翻译', category: 'necessary-sufficient-conditions', note: '只有 P 才 Q 等价于 若 Q 则 P。' },
  { id: 'contrapositive', label: '逆否命题等价', category: 'contrapositive-conversion', note: '若 P 则 Q 等价于 若非 Q 则非 P。' },
  { id: 'converse-error', label: '逆命题不等价', category: 'contrapositive-conversion', note: '若 Q 则 P 不必然成立。' },
  { id: 'validity-vs-truth', label: '有效性与真理性', category: 'deductive-reasoning', note: '形式有效不等于前提为真。' },
  { id: 'syllogism', label: '三段论', category: 'deductive-reasoning', note: '大前提、小前提、结论。' },
  { id: 'exhaustive-cases', label: '穷尽情形', category: 'deductive-reasoning', note: '分类讨论需要互斥且穷尽。' },
  { id: 'inductive-strength', label: '归纳强度', category: 'inductive-reasoning', note: '样本量、代表性、多样性。' },
  { id: 'analogical-reasoning', label: '类比推理', category: 'inductive-reasoning', note: '相关相似点决定类比强度。' },
  { id: 'falsification', label: '可检验性', category: 'inductive-reasoning', note: '能设想反证才更有意义。' },
  { id: 'truth-table', label: '真假值约束', category: 'truth-teller-puzzles', note: '用假设与矛盾排除。' },
  { id: 'self-reference', label: '自指与矛盾', category: 'truth-teller-puzzles', note: '“我说的都是假话”类结构。' },
  { id: 'causal-mechanism', label: '因果机制', category: 'causal-reasoning', note: '原因如何产生结果。' },
  { id: 'common-cause', label: '共同原因', category: 'causal-reasoning', note: '第三变量同时导致两者。' },
  { id: 'reverse-causation', label: '因果倒置', category: 'causal-reasoning', note: '方向可能相反。' },
  { id: 'confounder', label: '混淆变量', category: 'causal-reasoning', note: '控制变量后才能比较。' },
  { id: 'correlation-scenarios', label: '相关不等于因果', category: 'correlation-vs-causation', note: '共变有四种以上解释。' },
  { id: 'spurious-correlation', label: '伪相关', category: 'correlation-vs-causation', note: '巧合或时间趋势造成的相关。' },
  { id: 'base-rate', label: '基础概率', category: 'statistical-intuition', note: '总体中先有的比例。' },
  { id: 'conditional-probability', label: '条件概率', category: 'statistical-intuition', note: '在已知条件下重新计算。' },
  { id: 'sample-size', label: '样本量与波动', category: 'statistical-intuition', note: '小样本更容易出现极端比例。' },
  { id: 'survivorship-bias', label: '幸存者偏差', category: 'statistical-intuition', note: '看不见的样本同样重要。' },
  { id: 'average-vs-distribution', label: '平均数与分布', category: 'statistical-intuition', note: '平均数掩盖分布形态。' },
  { id: 'ad-hominem', label: '人身攻击', category: 'logical-fallacies', note: '针对人而非论证。' },
  { id: 'straw-man', label: '稻草人', category: 'logical-fallacies', note: '歪曲对方立场再反驳。' },
  { id: 'appeal-to-authority', label: '诉诸权威', category: 'logical-fallacies', note: '权威是否该领域的可靠来源。' },
  { id: 'slippery-slope', label: '滑坡', category: 'logical-fallacies', note: '未经论证的连锁推断。' },
  { id: 'false-dilemma', label: '错误二分', category: 'logical-fallacies', note: '隐藏第三种可能。' },
  { id: 'conclusion-identification', label: '结论识别', category: 'argument-analysis', note: '哪一句是被支持的主张。' },
  { id: 'implicit-premise', label: '隐含前提', category: 'argument-analysis', note: '论证依赖但未说出的假设。' },
  { id: 'evidence-relevance', label: '证据相关性', category: 'argument-analysis', note: '证据是否真的支持该结论。' },
  { id: 'counterexample-form', label: '反例的形式', category: 'counterexample-rebuttal', note: '满足前提但不满足结论。' },
  { id: 'rebuttal-target', label: '反驳的落点', category: 'counterexample-rebuttal', note: '削弱前提、推理还是结论。' },
  { id: 'subgoal-split', label: '子目标拆解', category: 'problem-decomposition', note: '把目标分成可独立验证的部分。' },
  { id: 'dependency-order', label: '步骤依赖顺序', category: 'problem-decomposition', note: '先做能排除最多可能的步骤。' },
  { id: 'variable-control', label: '变量控制', category: 'problem-decomposition', note: '一次只改变一个因素。' },
  { id: 'criteria-weighting', label: '评价标准与权重', category: 'decision-analysis', note: '先定标准再比较方案。' },
  { id: 'opportunity-cost', label: '机会成本', category: 'decision-analysis', note: '选择放弃了什么。' },
  { id: 'reversibility', label: '可逆性与不可逆代价', category: 'decision-analysis', note: '不可逆决策需要更强证据。' },
  { id: 'sunk-cost', label: '沉没成本', category: 'decision-analysis', note: '已付出且无法收回的不应主导选择。' },
] as const;

export const KNOWLEDGE_POINT_IDS = KNOWLEDGE_POINTS.map((k) => k.id);

export const KNOWLEDGE_POINT_LABELS: Record<string, string> = Object.fromEntries(KNOWLEDGE_POINTS.map((k) => [k.id, k.label]));

export const JOURNAL_STEPS = [
  {
    id: 'define-problem',
    index: 1,
    title: '明确真正要解决的问题',
    hint: '用一句话写出你要回答的问题，并检查它是否是你真正关心的那个问题。',
    prompt: '如果只能改变一件事，你希望改变什么？把它写成一个可以被回答的问题。',
  },
  {
    id: 'separate-kinds',
    index: 2,
    title: '区分事实、感受、推测与价值判断',
    hint: '事实可以被第三方验证；感受是你的体验；推测还没有足够证据；价值判断涉及应该与否。',
    prompt: '把上面提到的内容分成四类，标出你其实无法验证的那些。',
  },
  {
    id: 'multiple-explanations',
    index: 3,
    title: '提出至少两个可能的解释',
    hint: '只有一个解释时，你无法判断它是最好还是唯一。',
    prompt: '写出至少两个同样能说明现状的解释，包括一个让你不舒服的。',
  },
  {
    id: 'evidence-both-ways',
    index: 4,
    title: '分析支持证据与反对证据',
    hint: '对每个解释分别问：什么支持它，什么与它冲突。',
    prompt: '为每个解释列出支持与反对的证据，注明证据来源和你的可信度评价。',
  },
  {
    id: 'check-structure',
    index: 5,
    title: '检查因果关系、隐藏前提与可能的谬误',
    hint: '常见漏洞：将相关当因果、把假设当事实、结论比证据走得更远。',
    prompt: '你的推理依赖哪些没说出口的前提？如果其中一个前提不成立，结论还在吗？',
  },
  {
    id: 'discriminating-evidence',
    index: 6,
    title: '寻找能区分不同假设的证据',
    hint: '好的验证行动能让不同解释给出不同的预测。',
    prompt: '哪个观察结果会让解释 A 和解释 B 给出不同的预测？',
  },
  {
    id: 'provisional-conclusion',
    index: 7,
    title: '给出当前最合理的结论并说明不确定性',
    hint: '结论可以是暂时的，但要写清它有多可靠、什么会推翻它。',
    prompt: '用“目前我更倾向……，因为……，但有 ___ 不确定”写下结论和信心程度。',
  },
  {
    id: 'next-action-review',
    index: 8,
    title: '决定下一步验证行动，并在未来回顾结果',
    hint: '行动结束后回到这里复盘：预测与现实的差距在哪里。',
    prompt: '写下具体、可完成、有时间的验证行动，以及你打算什么时候回来复盘。',
  },
] as const;

export const ACTIVITY_TYPES = [
  'exercise',
  'fact-vs-inference',
  'causal-analysis',
  'argument-analysis',
  'real-problem-decomposition',
  'free-journal',
  'error-review',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  exercise: '逻辑推理题',
  'fact-vs-inference': '事实与推测辨析',
  'causal-analysis': '因果关系分析',
  'argument-analysis': '论证结构分析',
  'real-problem-decomposition': '现实问题拆解',
  'free-journal': '自由思考日志',
  'error-review': '错题复习',
};
