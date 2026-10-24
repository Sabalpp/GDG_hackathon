import { BeforeAfterPanel } from './BeforeAfterPanel';
import { CostWorksheet } from './CostWorksheet';
import { FindingsPanel } from './FindingsPanel';
import type { Budget, Goal, Layout, Proposal } from './types';

export function Disclaimer() {
  return (
    <aside className="adapt-disclaimer" aria-label="Important limitations">
      <strong>Concept proposal only.</strong> ADAPT is not an architectural drawing, a
      structural or code-compliance determination, a cost quote, or medical advice. Every change
      that involves construction must be reviewed by qualified professionals. A geometric
      “pass” means only that the simplified 2D model meets the target you set.
    </aside>
  );
}

export interface AdaptReportProps {
  proposal: Proposal;
  goals: Goal[];
  originalLayout?: Layout;
  budget?: Budget | null;
  description?: string;
  /** Exact model name that interpreted the request, e.g. gemma-4-26b-a4b-it. */
  model?: string;
  generatedAt?: Date;
  onSelectElement?: (elementId: string) => void;
}

/** Full printable report. Browser print-to-PDF is the export path (spec P0). */
export function AdaptReport({
  proposal,
  goals,
  originalLayout,
  budget,
  description,
  model,
  generatedAt = new Date(),
  onSelectElement,
}: AdaptReportProps) {
  return (
    <article className="adapt-report" aria-label="ADAPT accessibility concept report">
      <header className="adapt-report__header">
        <div>
          <h1 className="adapt-report__title">ADAPT concept report</h1>
          <p className="adapt-muted">
            Generated {generatedAt.toLocaleString('en-US')}
            {model ? ` · Requirements interpreted by ${model}, then confirmed by the user` : ''}
          </p>
        </div>
        <button type="button" className="adapt-button adapt-no-print" onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </header>

      <Disclaimer />

      {description && (
        <section className="adapt-panel">
          <h2 className="adapt-panel__title">What was asked</h2>
          <p>{description}</p>
        </section>
      )}

      <BeforeAfterPanel proposal={proposal} goals={goals} originalLayout={originalLayout} />
      <FindingsPanel
        title="Findings after the proposal"
        findings={proposal.findingsAfter}
        goals={goals}
        layout={proposal.resultLayout}
        onSelectElement={onSelectElement}
      />
      <CostWorksheet costs={proposal.costs} budget={budget} />

      {proposal.unresolvedQuestions.length > 0 && (
        <section className="adapt-panel">
          <h2 className="adapt-panel__title">Still unresolved</h2>
          <ul>
            {proposal.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </section>
      )}
    </article>
  );
}
