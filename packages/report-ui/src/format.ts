import type { ConstraintFinding, Goal, Layout, Modification, Summary, Verdict } from './types';

export const VERDICT_TEXT: Record<Verdict, string> = {
  pass: 'Passes',
  fail: 'Fails',
  unknown: 'Unknown — not verified',
};

/** Fail first, then unknown, then pass: problems are what the user acts on. */
export const VERDICT_ORDER: Verdict[] = ['fail', 'unknown', 'pass'];

export function formatMm(mm: number | null | undefined): string {
  if (mm == null || !Number.isFinite(mm)) return 'not measured';
  const inches = mm / 25.4;
  return `${Math.round(mm).toLocaleString('en-US')} mm (${inches.toFixed(1)} in)`;
}

export function formatUsd(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/** Counts computed from findings, so a missing or stale summary can never claim more passes. */
export function summarize(findings: ConstraintFinding[]): Summary {
  const count = (verdict: Verdict) => findings.filter((f) => f.verdict === verdict).length;
  const failCount = count('fail');
  const unknownCount = count('unknown');
  return {
    passCount: count('pass'),
    failCount,
    unknownCount,
    // Unknown is not pass: everything must be measured and passing.
    allPassed: findings.length > 0 && failCount === 0 && unknownCount === 0,
  };
}

export function elementLabel(layout: Layout | undefined, id: string): string {
  if (!layout) return id;
  const object = layout.objects.find((o) => o.id === id);
  if (object) return object.label;
  const room = layout.rooms.find((r) => r.id === id);
  if (room) return room.label;
  return id.replace(/[-_:]+/g, ' ');
}

export function goalLabel(goal: Goal | undefined, layout?: Layout): string {
  if (!goal) return 'Layout integrity (no overlaps or collisions)';
  const target = goal.targetMm ? ` ≥ ${formatMm(goal.targetMm)}` : '';
  const route =
    goal.fromRoomId && goal.toRoomId
      ? ` from ${elementLabel(layout, goal.fromRoomId)} to ${elementLabel(layout, goal.toRoomId)}`
      : '';
  switch (goal.type) {
    case 'minimum-door-width':
      return `Door clear width${target}`;
    case 'minimum-path-width':
      return `Clear path${route}${target}`;
    case 'reachable-route':
      return `Reachable route${route}${target}`;
  }
}

export function describeModification(mod: Modification, layout?: Layout): string {
  const target = elementLabel(layout, mod.targetElementId);
  switch (mod.type) {
    case 'move-furniture':
      return `Move ${target} to x ${formatMm(Number(mod.params.x))}, y ${formatMm(Number(mod.params.y))}`;
    case 'resize-demo-door':
      return `Widen ${target} to ${formatMm(Number(mod.params.clearWidth))} clear (concept)`;
    case 'move-demo-partition':
      return `Move demo partition ${target} (concept)`;
  }
}
