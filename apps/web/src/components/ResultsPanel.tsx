import type { ConstraintFinding, Goal, Layout, Modification, Proposal } from '../contracts';
import './ResultsPanel.css';

export type ResultsPanelProps = {
  goals: Goal[];
  findingsBefore?: ConstraintFinding[];
  proposal?: Proposal;
  layout?: Layout;
  selectedFindingId?: string;
  onSelectFinding?: (id: string) => void;
  loading?: boolean;
  error?: string;
  projectName?: string;
  className?: string;
};

const verdictSections = [
  { verdict: 'fail', title: 'Needs attention', marker: '!', description: 'Goals the model found unmet.' },
  { verdict: 'unknown', title: 'Unknown / not measured', marker: '?', description: 'Information the model cannot verify.' },
  { verdict: 'pass', title: 'Passed in this model', marker: '✓', description: 'Goals met in the supplied model only.' },
] as const;

const goalNames: Record<Goal['type'], string> = {
  'minimum-door-width': 'Minimum door width',
  'minimum-path-width': 'Minimum path width',
  'reachable-route': 'Reachable route',
};

const modificationNames: Record<Modification['type'], string> = {
  'move-furniture': 'Move furniture',
  'resize-demo-door': 'Resize demo door',
  'move-demo-partition': 'Move demo partition',
};

function elementLabel(id: string, layouts: (Layout | undefined)[]): string {
  for (const layout of layouts) {
    if (!layout) continue;
    const object = layout.objects.find((item) => item.id === id);
    if (object) return `${object.label} (${id})`;
    const room = layout.rooms.find((item) => item.id === id);
    if (room) return `${room.label} (${id})`;
    if (layout.doors.some((item) => item.id === id)) return `Door ${id}`;
    if (layout.walls.some((item) => item.id === id)) return `Wall ${id}`;
  }
  return id;
}

function measurementText(finding: ConstraintFinding): string | null {
  const details: string[] = [];
  if (finding.measuredMm !== undefined) details.push(`Measured ${finding.measuredMm.toLocaleString()} mm`);
  if (finding.requiredMm !== undefined) details.push(`Goal ${finding.requiredMm.toLocaleString()} mm`);
  return details.length ? details.join(' · ') : null;
}

function FindingGroups({
  findings,
  layouts,
  selectedFindingId,
  onSelectFinding,
}: {
  findings: ConstraintFinding[] | undefined;
  layouts: (Layout | undefined)[];
  selectedFindingId?: string;
  onSelectFinding?: (id: string) => void;
}) {
  if (!findings) return <p className="results-panel__empty">Findings have not been supplied yet.</p>;
  if (findings.length === 0) return <p className="results-panel__empty">No findings are available for this layout.</p>;

  return (
    <div className="results-panel__finding-groups">
      {verdictSections.map(({ verdict, title, marker, description }) => {
        const items = findings.filter((finding) => finding.verdict === verdict);
        return (
          <section className={`results-panel__group results-panel__group--${verdict}`} key={verdict} aria-label={title}>
            <div className="results-panel__group-heading">
              <span className="results-panel__verdict-mark" aria-hidden="true">{marker}</span>
              <div>
                <h4>{title} <span className="results-panel__count">{items.length}</span></h4>
                <p>{description}</p>
              </div>
            </div>
            {items.length ? (
              <ul className="results-panel__findings">
                {items.map((finding) => {
                  const content = (
                    <>
                      <span className="results-panel__finding-title">{finding.explanation || `Finding ${finding.id}`}</span>
                      {measurementText(finding) && <span className="results-panel__measurement">{measurementText(finding)}</span>}
                      {finding.affectedElementIds.length > 0 && (
                        <span className="results-panel__elements">
                          Affects: {finding.affectedElementIds.map((id) => elementLabel(id, layouts)).join(', ')}
                        </span>
                      )}
                    </>
                  );
                  return (
                    <li key={finding.id}>
                      {onSelectFinding ? (
                        <button
                          type="button"
                          className="results-panel__finding-button"
                          aria-pressed={selectedFindingId === finding.id}
                          onClick={() => onSelectFinding(finding.id)}
                        >
                          {content}
                        </button>
                      ) : <div className="results-panel__finding-static">{content}</div>}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="results-panel__none">None reported.</p>}
          </section>
        );
      })}
    </div>
  );
}

function GoalList({ goals, layout }: { goals: Goal[]; layout?: Layout }) {
  if (goals.length === 0) return <p className="results-panel__empty">No goals have been entered.</p>;
  return (
    <ol className="results-panel__goals">
      {goals.map((goal) => (
        <li key={goal.id}>
          <span>
            <strong>{goalNames[goal.type] ?? goal.type}</strong>
            {goal.targetMm !== undefined && <span> · {goal.targetMm.toLocaleString()} mm goal</span>}
            {goal.fromRoomId && goal.toRoomId && (
              <span> · {elementLabel(goal.fromRoomId, [layout])} to {elementLabel(goal.toRoomId, [layout])}</span>
            )}
          </span>
          <span className="results-panel__goal-status">{goal.status === 'confirmed' ? 'Confirmed' : 'Draft'}</span>
        </li>
      ))}
    </ol>
  );
}

function ModificationList({ proposal, layouts }: { proposal?: Proposal; layouts: (Layout | undefined)[] }) {
  if (!proposal) return <p className="results-panel__empty">No proposal has been selected.</p>;
  if (proposal.modifications.length === 0) return <p className="results-panel__empty">No modifications are listed for this proposal.</p>;
  return (
    <ol className="results-panel__modifications">
      {proposal.modifications.map((modification) => (
        <li key={modification.id}>
          <div>
            <strong>{modificationNames[modification.type] ?? modification.type}</strong>
            <p>{elementLabel(modification.targetElementId, layouts)}</p>
            {Object.keys(modification.params).length > 0 && (
              <dl className="results-panel__parameters">
                {Object.entries(modification.params).map(([key, value]) => (
                  <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ')}</dt><dd>{String(value)}</dd></div>
                ))}
              </dl>
            )}
          </div>
          <span className="results-panel__review-tag">
            {modification.requiresProfessionalReview ? 'Professional review required' : 'Concept change'}
          </span>
        </li>
      ))}
    </ol>
  );
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ResultsPanel({
  goals,
  findingsBefore,
  proposal,
  layout,
  selectedFindingId,
  onSelectFinding,
  loading = false,
  error,
  projectName = 'Sample apartment',
  className = '',
}: ResultsPanelProps) {
  const before = findingsBefore ?? proposal?.findingsBefore;
  const layouts = [proposal?.resultLayout, layout];

  return (
    <article className={`results-panel ${className}`.trim()} aria-labelledby="results-panel-title" aria-busy={loading}>
      <header className="results-panel__header">
        <div>
          <p className="results-panel__eyebrow">ADAPT / Concept report</p>
          <h2 id="results-panel-title">What the model found</h2>
          <p className="results-panel__intro">A record of supplied goals, model findings, and open questions for {projectName}.</p>
        </div>
        <button className="results-panel__print" type="button" onClick={() => window.print()} disabled={loading}>
          Print summary
        </button>
      </header>

      {loading && <div className="results-panel__notice" role="status">Preparing findings and proposal…</div>}
      {error && <div className="results-panel__notice results-panel__notice--error" role="alert">Results unavailable: {error}</div>}

      <section className="results-panel__section" aria-labelledby="results-goals-title">
        <div className="results-panel__section-head"><span>01</span><h3 id="results-goals-title">Your goals</h3></div>
        <GoalList goals={goals} layout={layout} />
      </section>

      <details className="results-panel__section results-panel__disclosure" open>
        <summary className="results-panel__section-head"><span>02</span><h3 id="results-before-title">Before · model findings</h3></summary>
        <FindingGroups findings={before} layouts={[layout]} selectedFindingId={selectedFindingId} onSelectFinding={onSelectFinding} />
      </details>

      <details className="results-panel__section results-panel__disclosure" open>
        <summary className="results-panel__section-head"><span>03</span><h3 id="results-after-title">After · proposed model</h3></summary>
        <FindingGroups findings={proposal?.findingsAfter} layouts={layouts} selectedFindingId={selectedFindingId} onSelectFinding={onSelectFinding} />
      </details>

      <details className="results-panel__section results-panel__disclosure" open>
        <summary className="results-panel__section-head"><span>04</span><h3 id="results-changes-title">Proposed changes</h3></summary>
        <ModificationList proposal={proposal} layouts={layouts} />
        {proposal && (
          <div className="results-panel__questions">
            <h4>Unresolved questions</h4>
            {proposal.unresolvedQuestions.length ? (
              <ul>{proposal.unresolvedQuestions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul>
            ) : <p>None listed. Real-home conditions still need professional review.</p>}
          </div>
        )}
      </details>

      <details className="results-panel__section results-panel__disclosure" open>
        <summary className="results-panel__section-head"><span>05</span><h3 id="results-costs-title">Illustrative costs</h3></summary>
        <p className="results-panel__cost-note">Example-only catalog ranges · USD · not a quote</p>
        {proposal?.costs?.length ? (
          <ul className="results-panel__costs">
            {proposal.costs.map((cost) => (
              <li key={cost.modificationId}>
                <div><strong>{cost.title}</strong><p>{cost.basis}</p></div>
                <span>{money.format(cost.lowUsd)}–{money.format(cost.highUsd)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="results-panel__empty">No cost estimate available.</p>}
      </details>

      <aside className="results-panel__limitations" aria-labelledby="results-limitations-title">
        <p className="results-panel__eyebrow">Read before acting</p>
        <h3 id="results-limitations-title">Concept only. Professional review needed.</h3>
        <p>ADAPT produces concept proposals from the supplied demo layout. Model measurements describe that layout, not conditions verified in a real home. ADAPT does not determine code compliance, structural safety, medical suitability, construction feasibility, or contractor pricing. Qualified professionals must review construction-related work.</p>
      </aside>
      <footer className="results-panel__footer">{projectName} · {layout ? `Original layout ${layout.id}` : 'Original layout unavailable'}{proposal ? ` · Proposal ${proposal.id}` : ''}</footer>
    </article>
  );
}

export default ResultsPanel;
