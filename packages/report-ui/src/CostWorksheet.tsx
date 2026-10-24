import { useId } from 'react';
import { budgetFit, totalCosts } from './costs';
import { formatUsd } from './format';
import type { Budget, CostLine } from './types';

const FIT_MESSAGE = {
  within: 'The illustrative range fits within the stated budget.',
  'may-exceed': 'The high end of the illustrative range is over budget. Real costs could exceed it.',
  exceeds: 'Even the low end of the illustrative range is over budget.',
  'no-budget': 'No budget was given.',
  'no-costs': 'No cost lines are attached to this proposal yet, so budget fit is not evaluated.',
} as const;

export function CostWorksheet({ costs, budget }: { costs: CostLine[]; budget?: Budget | null }) {
  const headingId = useId();
  const total = totalCosts(costs);
  const fit = budgetFit(costs, budget?.max);

  return (
    <section className="adapt-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="adapt-panel__title">
        Cost worksheet <span className="adapt-tag">Illustrative only</span>
      </h2>
      <p className="adapt-muted">
        Placeholder ranges from a fixed demo catalog, not quotes. Structural work, permits and local
        labor can change real costs substantially.
      </p>
      {costs.length > 0 && (
        <table className="adapt-table">
          <caption className="adapt-visually-hidden">Illustrative cost range for each proposed change</caption>
          <thead>
            <tr><th scope="col">Change</th><th scope="col">Range</th><th scope="col">Basis</th></tr>
          </thead>
          <tbody>
            {costs.map((line) => (
              <tr key={line.modificationId}>
                <th scope="row">{line.title}</th>
                <td>{formatUsd(line.lowUsd)}–{formatUsd(line.highUsd)}</td>
                <td className="adapt-muted">{line.basis}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{formatUsd(total.lowUsd)}–{formatUsd(total.highUsd)}</td>
              <td>{budget ? `Budget ${formatUsd(budget.max)}` : ''}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <p className={fit === 'exceeds' || fit === 'may-exceed' ? 'adapt-alert adapt-alert--warn' : ''}>
        {FIT_MESSAGE[fit]}
      </p>
    </section>
  );
}
