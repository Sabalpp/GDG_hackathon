import { useId } from 'react';
import { elementLabel, formatMm, goalLabel, summarize, VERDICT_ORDER } from './format';
import type { ConstraintFinding, Goal, Layout } from './types';
import { VerdictBadge } from './VerdictBadge';

export type ValidationStatus = 'ready' | 'loading' | 'unavailable';

export interface FindingsPanelProps {
  findings: ConstraintFinding[];
  goals: Goal[];
  layout?: Layout;
  title?: string;
  /** 'unavailable' when the geometry service failed: never render passes then. */
  status?: ValidationStatus;
  selectedElementId?: string;
  /** Lets the 2D/3D views highlight an element the user picks here. */
  onSelectElement?: (elementId: string) => void;
}

export function FindingsPanel({
  findings,
  goals,
  layout,
  title = 'Validation findings',
  status = 'ready',
  selectedElementId,
  onSelectElement,
}: FindingsPanelProps) {
  const headingId = useId();
  const summary = summarize(findings);
  const sorted = [...findings].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict),
  );

  return (
    <section className="adapt-panel" aria-labelledby={headingId} aria-busy={status === 'loading'}>
      <h2 id={headingId} className="adapt-panel__title">{title}</h2>

      <div role="status" aria-live="polite" className="adapt-summary">
        {status === 'loading' && <p>Checking the layout…</p>}
        {status === 'unavailable' && (
          <p className="adapt-alert adapt-alert--error">
            Validation unavailable. The geometry checker could not be reached, so no check is
            marked as passing. Try again, or continue editing goals.
          </p>
        )}
        {status === 'ready' && (
          <p>
            <strong>{summary.failCount}</strong> failing, <strong>{summary.unknownCount}</strong>{' '}
            unknown, <strong>{summary.passCount}</strong> passing.{' '}
            {summary.allPassed
              ? 'Every modeled check passes for this concept layout.'
              : summary.unknownCount > 0 && summary.failCount === 0
                ? 'Unknown checks are not passes; they need a real measurement.'
                : ''}
          </p>
        )}
      </div>

      {status === 'ready' && (
        <ul className="adapt-findings">
          {sorted.map((finding) => {
            const goal = goals.find((g) => g.id === finding.goalId);
            return (
              <li key={finding.id} className={`adapt-finding adapt-finding--${finding.verdict}`}>
                <div className="adapt-finding__head">
                  <VerdictBadge verdict={finding.verdict} />
                  <span className="adapt-finding__goal">{goalLabel(goal, layout)}</span>
                </div>
                {(finding.measuredMm != null || finding.requiredMm != null) && (
                  <dl className="adapt-finding__measure">
                    <div><dt>Measured</dt><dd>{formatMm(finding.measuredMm)}</dd></div>
                    <div><dt>Target</dt><dd>{formatMm(finding.requiredMm)}</dd></div>
                  </dl>
                )}
                <p className="adapt-finding__explanation">{finding.explanation}</p>
                {finding.affectedElementIds.length > 0 && (
                  <div className="adapt-finding__elements">
                    <span className="adapt-visually-hidden">Affected elements:</span>
                    {finding.affectedElementIds.map((id) =>
                      onSelectElement ? (
                        <button
                          key={id}
                          type="button"
                          className="adapt-chip"
                          aria-pressed={selectedElementId === id}
                          onClick={() => onSelectElement(id)}
                        >
                          {elementLabel(layout, id)}
                        </button>
                      ) : (
                        <span key={id} className="adapt-chip">{elementLabel(layout, id)}</span>
                      ),
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
