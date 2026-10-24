// Standalone preview of the report panels using real geometry fixtures.
//   npm run dev --workspace @adapt/report-ui
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import catalog from '../../../data/sample-cost-catalog.json';
import impossible from '../test/fixtures/impossible-proposal.json';
import sample from '../test/fixtures/sample-proposal.json';
import { AdaptReport, costLinesFromCatalog, FindingsPanel, type CostCatalogItem, type Goal, type Proposal } from '../src';
import '../src/styles.css';

type View = 'sample' | 'impossible' | 'unavailable';

function attachCosts(proposal: Proposal): Proposal {
  return { ...proposal, costs: costLinesFromCatalog(proposal.modifications, catalog.items as CostCatalogItem[]) };
}

function Demo() {
  const [view, setView] = useState<View>('sample');
  const [selected, setSelected] = useState<string>();
  const data = view === 'impossible' ? impossible : sample;
  const proposal = attachCosts(data.proposal as unknown as Proposal);
  const goals = data.goals as Goal[];

  return (
    <main>
      <nav className="demo-nav adapt-no-print" aria-label="Preview scenario">
        {(['sample', 'impossible', 'unavailable'] as const).map((v) => (
          <button key={v} type="button" className="adapt-chip" aria-pressed={view === v} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        {selected && <span className="adapt-muted">Selected element: {selected}</span>}
      </nav>
      {view === 'unavailable' ? (
        <FindingsPanel findings={proposal.findingsAfter} goals={goals} status="unavailable" />
      ) : (
        <AdaptReport
          proposal={proposal}
          goals={goals}
          budget={view === 'sample' ? { currency: 'USD', max: 12_000 } : null}
          description="Make it easier to move between the bedroom, bathroom, and kitchen using a mobility device, with a $12,000 budget."
          model="gemma-4-26b-a4b-it"
          onSelectElement={setSelected}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Demo /></StrictMode>);
