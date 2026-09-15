import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_TONES: Record<Tone, string> = {
  primary:
    "bg-chrono-500 text-ink-900 hover:bg-chrono-400 focus-visible:outline-chrono-300 disabled:bg-chrono-500/40 disabled:text-ink-900/60",
  secondary:
    "border border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 focus-visible:outline-violet-300 disabled:opacity-40",
  ghost:
    "border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:outline-white/40 disabled:opacity-40",
  danger:
    "border border-rose-500/50 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 focus-visible:outline-rose-300 disabled:opacity-40",
};

export function Button({
  tone = "primary",
  loading = false,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${BUTTON_TONES[tone]} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function Card({ className = "", children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-white/10 bg-ink-800/70 p-5 shadow-card backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-tight text-slate-100">{children}</h2>
      {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
    </div>
  );
}

export type BadgeTone = "neutral" | "cyan" | "violet" | "emerald" | "amber" | "rose";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-white/15 bg-white/5 text-slate-300",
  cyan: "border-chrono-400/40 bg-chrono-500/10 text-chrono-200",
  violet: "border-violet-400/40 bg-violet-500/10 text-violet-300",
  emerald: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-400/40 bg-amber-500/10 text-amber-300",
  rose: "border-rose-400/40 bg-rose-500/10 text-rose-300",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">
          {label}
        </span>
        {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-300">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-white/10 bg-ink-900/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-chrono-400/60 focus:outline-none focus:ring-2 focus:ring-chrono-400/20";

export function Callout({
  tone = "cyan",
  title,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${BADGE_TONES[tone]}`}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-slate-200/90">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/50 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}
