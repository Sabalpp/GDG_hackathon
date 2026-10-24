import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const expressBase = process.env.EXPRESS_BASE_URL ?? 'http://127.0.0.1:3001';
const pythonBase = process.env.GEOMETRY_BASE_URL ?? 'http://127.0.0.1:8000';
const pythonPath = process.env.GEOMETRY_PROPOSE_PATH ?? '/api/v1/proposals/generate';
async function post(url, request) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
for (const file of ['sample-proposal-request.json', 'impossible-request.json']) {
  const request = JSON.parse(await readFile(new URL(`../../../data/${file}`, import.meta.url), 'utf8'));
  const raw = await post(`${pythonBase}${pythonPath}`, request);
  const enriched = await post(`${expressBase}/api/v1/proposals/generate`, request);
  assert.equal(enriched.proposals.length, raw.proposals.length);
  for (const [index, proposal] of enriched.proposals.entries()) {
    const original = raw.proposals[index];
    for (const key of ['id', 'originalLayoutId', 'resultLayout', 'modifications', 'findingsBefore', 'findingsAfter']) {
      assert.deepEqual(proposal[key], original[key], `${file}: ${key} changed`);
    }
    assert.deepEqual(proposal.unresolvedQuestions.slice(0, original.unresolvedQuestions.length), original.unresolvedQuestions);
    assert.equal(proposal.costs.length, proposal.modifications.length);
    assert(proposal.costs.every((line) => line.status === 'illustrative'));
    assert.equal(proposal.costEstimate.status, 'illustrative');
    assert(proposal.unresolvedQuestions.some((question) => question.includes('not construction-ready')));
    if (file === 'sample-proposal-request.json') {
      assert(proposal.modifications.length > 0);
      assert(proposal.findingsBefore.some((finding) => finding.verdict === 'fail'));
      assert(proposal.findingsAfter.every((finding) => finding.verdict === 'pass'));
    } else {
      assert(proposal.findingsAfter.some((finding) => finding.verdict !== 'pass'));
    }
    console.log(JSON.stringify({ fixture: file, proposalId: proposal.id, modifications: proposal.modifications.length,
      remainingFailures: proposal.findingsAfter.filter((finding) => finding.verdict === 'fail').length,
      remainingUnknowns: proposal.findingsAfter.filter((finding) => finding.verdict === 'unknown').length,
      illustrativeTotal: proposal.costEstimate.total }));
  }
}
console.log('Real Express → Python proposal generation and catalog enrichment passed; geometric results and original questions preserved.');
