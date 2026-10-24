import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Real HTTP smoke test. Start Express and Python first; no mocks or credentials.
const base = process.env.EXPRESS_BASE_URL ?? 'http://127.0.0.1:3001';
const original = JSON.parse(await readFile(new URL('../../../data/sample-validation-request.json', import.meta.url), 'utf8'));
async function validate(label, request) {
  const response = await fetch(`${base}/api/v1/layouts/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(result)}`);
  console.log(JSON.stringify({ label, summary: result.summary, doors: result.findings.filter((finding) => finding.goalId === 'goal-doors') }));
  return result;
}
const before = await validate('sample-before', original);
assert(before.findings.some((finding) => finding.goalId === 'goal-doors' && finding.affectedElementIds.includes('door-bedroom') && finding.verdict === 'fail' && finding.measuredMm === 800 && finding.requiredMm === 900));
assert.equal(before.summary.allPassed, false);

// Isolate door clearance from route goals; keep the same apartment and cabinet.
const passing = structuredClone(original);
passing.goals = passing.goals.filter((goal) => goal.type === 'minimum-door-width');
passing.layout.doors.find((door) => door.id === 'door-bedroom').clearWidth = 920;
const after = await validate('door-clearance-after-920mm', passing);
assert.equal(after.summary.allPassed, true);
assert(after.findings.some((finding) => finding.affectedElementIds.includes('door-bedroom') && finding.verdict === 'pass' && finding.measuredMm === 920));

const uncertain = structuredClone(passing);
uncertain.layout.doors.find((door) => door.id === 'door-bedroom').clearWidth = null;
const unknown = await validate('unmeasured-door', uncertain);
assert.equal(unknown.summary.allPassed, false);
assert(unknown.findings.some((finding) => finding.verdict === 'unknown' && finding.affectedElementIds.includes('door-bedroom') && finding.measuredMm === undefined));
console.log('Real Express → Python door fail/pass/unknown checks passed. Door-only success does not assert route clearance or code compliance.');
