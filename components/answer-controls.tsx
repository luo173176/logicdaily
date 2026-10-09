'use client';

import { useMemo } from 'react';

import type { Exercise } from '@/lib/domain/exercise-schema';
import type { AnswerInput } from '@/lib/domain/grading';
import { presentationKeyOrder } from '@/lib/domain/catalog';
import { Chip } from '@/components/ui';

export type AnswerValue = AnswerInput;

export function emptyAnswer(exercise: Exercise): AnswerValue {
  switch (exercise.format) {
    case 'single-choice':
      return { format: 'single-choice', keys: [] };
    case 'multi-choice':
      return { format: 'multi-choice', keys: [] };
    case 'true-false':
      return { format: 'true-false', value: null };
    case 'ordering':
      return { format: 'ordering', keys: [] };
    case 'short-answer':
      return { format: 'short-answer', text: '' };
    case 'open-response':
      return { format: 'open-response', text: '', score: 2 };
  }
}

export function isAnswered(exercise: Exercise, answer: AnswerValue): boolean {
  switch (answer.format) {
    case 'single-choice':
    case 'multi-choice':
    case 'ordering':
      return answer.keys.length > 0;
    case 'true-false':
      return answer.value !== null;
    case 'short-answer':
      return answer.text.trim().length > 0;
    case 'open-response':
      return answer.text.trim().length > 0;
  }
  void exercise;
  return false;
}

interface Props {
  exercise: Exercise;
  answer: AnswerValue;
  onChange: (next: AnswerValue) => void;
  disabled?: boolean;
  /** 提交后进入回看模式：展示哪些是正确项。 */
  revealed?: boolean;
  seedSuffix?: string;
}

export function AnswerControls({ exercise, answer, onChange, disabled, revealed, seedSuffix = '' }: Props) {
  const shuffledKeys = useMemo(
    () =>
      exercise.format === 'single-choice' || exercise.format === 'multi-choice'
        ? presentationKeyOrder(
            exercise.options.map((o) => o.key),
            `${exercise.id}:${seedSuffix}`,
          )
        : [],
    [exercise, seedSuffix],
  );

  if (exercise.format === 'single-choice' || exercise.format === 'multi-choice') {
    const selected = answer.format === 'single-choice' || answer.format === 'multi-choice' ? answer.keys : [];
    const multi = exercise.format === 'multi-choice';
    return (
      <div role={multi ? 'group' : 'radiogroup'} aria-label={multi ? '选择所有适用项' : '选择一个选项'} className="stack gap-2">
        {shuffledKeys.map((key) => {
          const option = exercise.options.find((o) => o.key === key);
          if (!option) return null;
          const isChecked = selected.includes(key);
          const isCorrectAnswer = exercise.answer.keys.includes(key);
          const tone = revealed
            ? isCorrectAnswer
              ? 'border-ok bg-ok-soft'
              : isChecked
                ? 'border-bad bg-bad-soft'
                : 'border-line'
            : isChecked
              ? 'border-brand bg-brand-soft'
              : 'border-line';
          return (
            <button
              key={key}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={isChecked}
              disabled={disabled}
              data-pressable
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${tone}`}
              onClick={() => {
                if (multi) {
                  const next = isChecked ? selected.filter((k) => k !== key) : [...selected, key];
                  onChange({ format: 'multi-choice', keys: next.sort() });
                } else {
                  onChange({ format: 'single-choice', keys: [key] });
                }
              }}
            >
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-line-strong bg-surface text-xs font-semibold">
                {key}
              </span>
              <span className="flex-1">
                <span>{option.text}</span>
                {revealed && isCorrectAnswer ? <span className="mt-1 block text-xs font-semibold text-ok">参考答案</span> : null}
                {revealed && isChecked && !isCorrectAnswer ? <span className="mt-1 block text-xs font-semibold text-bad">你选的</span> : null}
              </span>
            </button>
          );
        })}
        {multi ? <p className="faint">多选题：错选任一项即记为未答对，只漏选记为部分正确。</p> : null}
      </div>
    );
  }

  if (exercise.format === 'true-false') {
    const value = answer.format === 'true-false' ? answer.value : null;
    return (
      <div role="radiogroup" aria-label="判断正误" className="row gap-3">
        {[
          { label: '正确', v: true },
          { label: '错误', v: false },
        ].map((option) => {
          const checked = value === option.v;
          const tone = revealed
            ? exercise.answer.value === option.v
              ? 'border-ok bg-ok-soft'
              : checked
                ? 'border-bad bg-bad-soft'
                : 'border-line'
            : checked
              ? 'border-brand bg-brand-soft'
              : 'border-line';
          return (
            <button
              key={option.label}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              data-pressable
              className={`btn btn-secondary flex-1 ${tone}`}
              onClick={() => onChange({ format: 'true-false', value: option.v })}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (exercise.format === 'ordering') {
    const ordered = answer.format === 'ordering' ? answer.keys : [];
    const pool = presentationKeyOrder(
      exercise.items.map((i) => i.key),
      `${exercise.id}:pool:${seedSuffix}`,
    ).filter((key) => !ordered.includes(key));
    const textOf = (key: string) => exercise.items.find((i) => i.key === key)?.text ?? key;
    return (
      <div className="stack gap-3">
        <p className="label">你的顺序（点下方条目依次加入，点已加入条目可移除）</p>
        <ol className="stack gap-2">
          {(revealed ? exercise.answer.keys : ordered).map((key, index) => {
            const wrongPosition = revealed && exercise.answer.keys[index] !== key;
            return (
              <li key={`${key}-${index}`}>
                <button
                  type="button"
                  disabled={disabled || revealed}
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-2.5 text-left ${
                    wrongPosition ? 'border-bad bg-bad-soft' : revealed ? 'border-ok bg-ok-soft' : 'border-line bg-surface'
                  }`}
                  onClick={() => onChange({ format: 'ordering', keys: ordered.filter((k) => k !== key) })}
                >
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-inset text-xs font-semibold tabular-nums">
                    {index + 1}
                  </span>
                  <span className="flex-1">{textOf(key)}</span>
                  {wrongPosition ? <span className="text-xs text-bad">应在第 {exercise.answer.keys.indexOf(key) + 1} 位</span> : null}
                </button>
              </li>
            );
          })}
          {!revealed && ordered.length === 0 ? <li className="inset text-sm muted">还没有条目，先点下面的步骤。</li> : null}
        </ol>
        {pool.length > 0 ? (
          <div className="row wrap gap-2">
            {pool.map((key) => (
              <Chip key={key} onPress={disabled ? undefined : () => onChange({ format: 'ordering', keys: [...ordered, key] })}>
                {textOf(key)}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm muted">所有步骤都已排列。</p>
        )}
      </div>
    );
  }

  if (exercise.format === 'short-answer') {
    const text = answer.format === 'short-answer' ? answer.text : '';
    return (
      <div className="stack gap-2">
        <textarea
          id="answer-text"
          rows={5}
          value={text}
          disabled={disabled}
          placeholder="用你自己的话写出推理过程：你认为的前提、中间步骤、以及结论。"
          onChange={(event) => onChange({ format: 'short-answer', text: event.target.value })}
        />
        <p className="faint">提交后系统会按题目要点检查你写到了哪些环节。这是自动提示，不是评分，也不代表答案唯一。</p>
      </div>
    );
  }

  const openText = answer.format === 'open-response' ? answer.text : '';
  const openScore = answer.format === 'open-response' ? answer.score : 2;
  return (
    <div className="stack gap-3">
      <textarea
        id="answer-text"
        rows={6}
        value={openText}
        disabled={disabled}
        placeholder={exercise.answer.guidance}
        onChange={(event) => onChange({ format: 'open-response', text: event.target.value, score: openScore })}
      />
      <div className="stack gap-1.5">
        <p className="label">按量表自评：你现在的回答处于哪一级？</p>
        <div className="row wrap gap-2">
          {exercise.answer.scale.map((level) => (
            <button
              key={level.score}
              type="button"
              role="radio"
              aria-checked={openScore === level.score}
              disabled={disabled}
              className={`chip chip-toggle ${openScore === level.score ? 'border-brand' : ''}`}
              onClick={() => onChange({ format: 'open-response', text: openText, score: level.score })}
            >
              {level.score} · {level.label}
            </button>
          ))}
        </div>
        <p className="faint">{exercise.answer.scale.find((l) => l.score === openScore)?.criteria}</p>
      </div>
    </div>
  );
}
