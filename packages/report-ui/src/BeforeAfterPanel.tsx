import { useId } from 'react';
import { describeModification, goalLabel, VERDICT_ORDER } from './format';
import type { ConstraintFinding, Goal, Layout, Proposal, Verdict } from './types';
import { VerdictBadge } from './VerdictBadge';

/** A goal is only as good as its worst finding (fail > unknown > pass). */
export function worstVerdict(findings: ConstraintFinding[]): Verdict | undefined {
  if (findings.length === 0) return undefined;
  return VERDICT_ORDER.find((verdict) => findings.some((f) => f.verdict === verdict));
}

export interface BeforeAfterPanelProps {
  proposal: Proposal;
  goals: Goal[];
  originalLayout?: Layout;
}

export function BeforeAfterPanel({ proposal, goals, originalLayout }: BeforeAfterPanelProps) {
  const headingId = useId();
  const goalIds = [...new Set([...proposal.findingsBefore, ...proposal.findingsAfter].map((f) => f.goalId))];

  return (
    <section className="adapt-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="adapt-panel__title">Before and after</h2>
      <table className="adapt-table">
        <caption className="adapt-visually-hidden">Each goal's worst result before and after the proposal</caption>
        <thead>
          <tr><th scope="col">Goal</th><th scope="col">Before</th><th scope="col">After</th></tr>
        </thead>
        <tbody>
          {goalIds.map((goalId) => {
            const before = worstVerdict(proposal.findingsBefore.filter((f) => f.goalId === goalId));
            const after = worstVerdict(proposal.findingsAfter.filter((f) => f.goalId === goalId));
            return (
              <tr key={goalId}>
                <th scope="row">{goalLabel(goals.find((g) => g.id === goalId), originalLayout)}</th>
                <td>{before ? <VerdictBadge verdict={before} /> : '—'}</td>
                <td>{after ? <VerdictBadge verdict={after} /> : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3 className="adapt-panel__subtitle">Proposed changes</h3>
      {proposal.modifications.length === 0 ? (
        <p>No permitted change was found. The remaining failures are listed above.</p>
      ) : (
        <ol className="adapt-mods">
          {proposal.modifications.map((mod) => (
            <li key={mod.id}>
              {describeModification(mod, originalLayout)}
              {mod.requiresProfessionalReview && (
                <span className="adapt-tag">Needs professional review</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
