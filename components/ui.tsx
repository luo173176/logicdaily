'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="row-between mt-6 mb-2">
      <h2 className="text-[0.9375rem] font-semibold tracking-wide text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function StatusBadge({ tone, children, symbol }: { tone: 'ok' | 'warn' | 'bad' | 'neutral'; children: ReactNode; symbol?: string }) {
  return (
    <span className={`status-badge status-${tone}`}>
      {symbol ? <span aria-hidden>{symbol}</span> : null}
      <span>{children}</span>
    </span>
  );
}

export function ProgressBar({ value, total, label }: { value: number; total: number; label?: string }) {
  const percent = total === 0 ? 0 : Math.min(100, Math.round((value / total) * 100));
  return (
    <div>
      <div className="row-between mb-1">
        <span className="label">{label ?? '今日进度'}</span>
        <span className="text-sm tabular-nums">
          {value}/{total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={label ?? '今日进度'}
        className="h-2 w-full overflow-hidden rounded-full bg-inset"
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Chip({ children, pressed, onPress }: { children: ReactNode; pressed?: boolean; onPress?: () => void }) {
  if (!onPress) return <span className="chip">{children}</span>;
  return (
    <button type="button" className="chip chip-toggle" aria-pressed={pressed ?? false} onClick={onPress}>
      {children}
    </button>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="stack gap-1.5">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="faint">{hint}</p> : null}
    </div>
  );
}

export function Note({ tone = 'neutral', title, children }: { tone?: 'ok' | 'warn' | 'bad' | 'neutral'; title?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-line px-4 py-3 text-sm status-${tone}`}>
      {title ? <p className="mb-1 font-semibold text-ink">{title}</p> : null}
      <div className="text-ink/90">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card stack items-start gap-3">
      <p className="font-semibold">{title}</p>
      {children ? <div className="text-sm muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="stack gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded-lg bg-inset" style={{ width: `${92 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Button({
  children,
  href,
  variant = 'primary',
  size,
  ...rest
}: {
  children: ReactNode;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const className = `btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''}`;
  if (href) {
    return (
      <Link href={href} className={className} data-pressable>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} data-pressable {...rest}>
      {children}
    </button>
  );
}

/** 信心程度选择：1～5，用于判因与复习调度。 */
export function ConfidencePicker({ value, onChange, disabled }: { value: number; onChange: (next: number) => void; disabled?: boolean }) {
  const labels = ['完全没把握', '不太确定', '一般', '比较确定', '非常确定'];
  return (
    <div role="radiogroup" aria-label="你对这个答案的信心程度" className="row wrap gap-2">
      {labels.map((label, index) => {
        const next = index + 1;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={value === next}
            disabled={disabled}
            className={`chip chip-toggle ${value === next ? 'border-brand' : ''}`}
            onClick={() => onChange(next)}
          >
            {next} · {label}
          </button>
        );
      })}
    </div>
  );
}

export function DifficultyPips({ level }: { level: number }) {
  return (
    <span aria-label={`难度 ${level} / 5`} className="row gap-1 text-xs faint">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} aria-hidden className={`inline-block h-2 w-2 rounded-full ${i < level ? 'bg-brand' : 'bg-line-strong'}`} />
      ))}
    </span>
  );
}
