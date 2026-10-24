// Fixtures are real responses from the geometry service for data/sample-proposal-request.json
// and data/impossible-request.json, so these tests catch contract drift.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import catalog from '../../../data/sample-cost-catalog.json';
import impossible from './fixtures/impossible-proposal.json';
import sample from './fixtures/sample-proposal.json';
import {
  AdaptReport,
  budgetFit,
  costLinesFromCatalog,
  CostWorksheet,
  FindingsPanel,
  summarize,
  type ConstraintFinding,
  type CostCatalogItem,
  type Goal,
  type Proposal,
} from '../src';

const proposal = sample.proposal as unknown as Proposal;
const goals = sample.goals as Goal[];
const items = catalog.items as CostCatalogItem[];

describe('summarize', () => {
  it('never reports allPassed while anything is unknown', () => {
    const findings: ConstraintFinding[] = [
      { id: 'a', goalId: 'g', verdict: 'pass', affectedElementIds: [], explanation: '' },
      { id: 'b', goalId: 'g', verdict: 'unknown', affectedElementIds: [], explanation: '' },
    ];
    expect(summarize(findings)).toMatchObject({ passCount: 1, unknownCount: 1, allPassed: false });
  });

  it('never reports allPassed for an empty finding list', () => {
    expect(summarize([]).allPassed).toBe(false);
  });
});

describe('FindingsPanel', () => {
  it('shows verdicts as text, not only color, with failures first', () => {
    render(<FindingsPanel findings={proposal.findingsBefore} goals={goals} layout={proposal.resultLayout} />);
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]!).getByText('Fails')).toBeInTheDocument();
    expect(screen.getAllByText('Fails')).toHaveLength(3);
    expect(screen.getByText('800 mm (31.5 in)')).toBeInTheDocument();
  });

  it('shows no passes when validation is unavailable', () => {
    render(<FindingsPanel findings={proposal.findingsAfter} goals={goals} status="unavailable" />);
    expect(screen.getByRole('status')).toHaveTextContent(/validation unavailable/i);
    expect(screen.queryByText('Passes')).not.toBeInTheDocument();
  });

  it('lets keyboard users select an affected element', async () => {
    const onSelect = vi.fn();
    render(
      <FindingsPanel
        findings={proposal.findingsBefore}
        goals={goals}
        layout={proposal.resultLayout}
        onSelectElement={onSelect}
      />,
    );
    const user = userEvent.setup();
    const cabinet = screen.getAllByRole('button', { name: /cabinet/i })[0]!;
    cabinet.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('cabinet');
  });
});

describe('costs', () => {
  it('builds illustrative lines only from the catalog', () => {
    const lines = costLinesFromCatalog(proposal.modifications, items);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.status === 'illustrative')).toBe(true);
    expect(budgetFit(lines, 12_000)).toBe('within');
    expect(budgetFit(lines, 2_000)).toBe('may-exceed');
    expect(budgetFit(lines, 500)).toBe('exceeds');
    expect(budgetFit([], 12_000)).toBe('no-costs');
  });

  it('does not claim budget fit when no cost lines are attached', () => {
    render(<CostWorksheet costs={[]} budget={{ currency: 'USD', max: 12_000 }} />);
    expect(screen.getByText(/budget fit is not evaluated/i)).toBeInTheDocument();
  });
});

describe('AdaptReport', () => {
  it('renders the demo before/after flip and disclaimers', () => {
    const withCosts = { ...proposal, costs: costLinesFromCatalog(proposal.modifications, items) };
    render(<AdaptReport proposal={withCosts} goals={goals} budget={sample.budget as never} model="gemma-4-26b-a4b-it" />);
    const rows = within(screen.getByRole('table', { name: /before and after/i })).getAllByRole('row').slice(1);
    for (const row of rows) expect(within(row).getAllByText(/Fails|Passes/).at(-1)).toHaveTextContent('Passes');
    expect(screen.getByLabelText(/important limitations/i)).toHaveTextContent(/concept proposal only/i);
    expect(screen.getByRole('button', { name: /print or save as pdf/i })).toBeInTheDocument();
    expect(screen.getByText(/needs professional review/i)).toBeInTheDocument();
  });

  it('keeps the impossible request visibly failing', () => {
    render(<AdaptReport proposal={impossible.proposal as unknown as Proposal} goals={impossible.goals as Goal[]} />);
    expect(screen.getAllByText('Fails').length).toBeGreaterThan(0);
    expect(screen.queryByText(/every modeled check passes/i)).not.toBeInTheDocument();
  });
});
