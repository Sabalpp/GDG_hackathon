import type { ReactElement } from 'react';
import { VERDICT_TEXT } from './format';
import type { Verdict } from './types';

// Shape + text + color: the verdict never depends on color alone.
const ICON: Record<Verdict, ReactElement> = {
  pass: <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />,
  fail: <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />,
  unknown: (
    <>
      <path d="M7.2 7.4a2.9 2.9 0 1 1 4.1 2.6c-.8.4-1.3 1-1.3 1.9v.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="10" cy="15.6" r="1.3" fill="currentColor" />
    </>
  ),
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`adapt-badge adapt-badge--${verdict}`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        {ICON[verdict]}
      </svg>
      {VERDICT_TEXT[verdict]}
    </span>
  );
}
