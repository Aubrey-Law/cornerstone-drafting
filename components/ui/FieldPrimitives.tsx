import React from 'react';

function humanize(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
export function StatusBadge({ value }: { value?: string | null }) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  let colorClasses: string;

  if (['executed', 'complete', 'funded'].includes(normalized)) {
    colorClasses = 'bg-success/15 text-success border-success/30';
  } else if (['drafted', 'in_progress', 'expedited', 'significant'].includes(normalized)) {
    colorClasses = 'bg-warning/15 text-warning border-warning/30';
  } else {
    colorClasses = 'bg-muted text-muted-foreground border-border';
  }

  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${colorClasses}`}>
      {humanize(value)}
    </span>
  );
}

// ── TaxExposureBadge ─────────────────────────────────────────────────────────
export function TaxExposureBadge({ value }: { value?: string | null }) {
  let colorClasses: string;
  if (!value || value === 'None') {
    colorClasses = 'bg-muted text-muted-foreground border-border';
  } else if (value.includes('Low')) {
    colorClasses = 'bg-success/15 text-success border-success/30';
  } else {
    colorClasses = 'bg-warning/15 text-warning border-warning/30';
  }
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${colorClasses}`}>
      {value ?? '—'}
    </span>
  );
}

// ── BoolField ────────────────────────────────────────────────────────────────
export function BoolField({ value, date }: { value?: boolean | null; date?: string | null }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (value) {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7l3 3 5-5.5" />
        </svg>
        <span>Yes</span>
        {date && <span className="text-muted-foreground font-normal ml-0.5">· {date}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4l6 6M10 4l-6 6" />
      </svg>
      <span>No</span>
    </span>
  );
}

// ── FieldItem ────────────────────────────────────────────────────────────────
export function FieldItem({ label, children, hideIfEmpty, forceEmpty }: { label: string; children?: React.ReactNode; hideIfEmpty?: boolean; forceEmpty?: boolean }) {
  const isEmpty = forceEmpty || children === null || children === undefined || children === '';
  if (isEmpty && hideIfEmpty) return null;
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground mb-0.5">
        {label}
      </div>
      <div className="text-sm text-foreground">
        {isEmpty ? <span className="text-muted-foreground">—</span> : children}
      </div>
    </div>
  );
}

// ── FieldGrid ────────────────────────────────────────────────────────────────
export function FieldGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 }) {
  const gridClass = cols === 1
    ? 'grid grid-cols-1 gap-x-8 gap-y-4'
    : 'grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4';
  return <div className={gridClass}>{children}</div>;
}

// ── GroupDivider ─────────────────────────────────────────────────────────────
export function GroupDivider() {
  return <hr className="border-0 border-t border-border my-5" />;
}

// ── GroupLabel ───────────────────────────────────────────────────────────────
export function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-3.5">
      {children}
    </div>
  );
}

// ── EmDash ───────────────────────────────────────────────────────────────────
export function EmDash() {
  return <span className="text-muted-foreground">—</span>;
}
