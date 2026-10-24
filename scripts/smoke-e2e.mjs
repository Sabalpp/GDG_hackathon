#!/usr/bin/env node
// End-to-end smoke test of the judged demo path over real HTTP (Dev D).
// Works against Express (default) or the geometry service directly, because both
// serve the same /api/v1 paths. Express-only checks run with --express.
//
//   node scripts/smoke-e2e.mjs                                   # local Express
//   node scripts/smoke-e2e.mjs --base-url http://127.0.0.1:8000/api/v1
//   node scripts/smoke-e2e.mjs --base-url https://<run-url>/api/v1 --express

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const base = option('--base-url', process.env.API_BASE_URL ?? 'http://localhost:8080/api/v1').replace(/\/$/, '');
const express = flag('--express');
const dataDir = new URL('../data/', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, dataDir), 'utf8'));

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name} — ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'adapt-dev-d-smoke' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON (HTTP ${response.status})`);
  }
  return { status: response.status, json };
}

const proposalRequest = await readJson('sample-proposal-request.json');
const goals = proposalRequest.goals;
const impossible = await readJson('impossible-request.json');
const clone = (value) => structuredClone(value);
let layout = proposalRequest.layout;
let proposal;

console.log(`ADAPT smoke test against ${base}${express ? ' (Express mode)' : ''}\n`);

await check('health', async () => {
  const { status, json } = await call('/health');
  assert(status === 200 && json.status === 'ok', `unexpected ${status} ${JSON.stringify(json)}`);
});

await check('sample layout loads', async () => {
  const { status, json } = await call('/samples/apartment');
  assert(status === 200 && json.layout?.units === 'mm', `HTTP ${status}`);
  layout = json.layout;
  return `${json.layout.rooms.length} rooms, ${json.layout.doors.length} doors`;
});

await check('original layout has measured failures', async () => {
  const { status, json } = await call('/layouts/validate', { layout, goals });
  assert(status === 200, `HTTP ${status}`);
  assert(json.summary.failCount > 0 && json.summary.allPassed === false, 'expected failing findings before the proposal');
  return `pass ${json.summary.passCount} / fail ${json.summary.failCount} / unknown ${json.summary.unknownCount}`;
});

await check('proposal generated with modifications', async () => {
  const { status, json } = await call('/proposals/generate', { ...proposalRequest, layout });
  assert(status === 200 && json.proposals?.length > 0, `HTTP ${status}`);
  proposal = json.proposals[0];
  assert(proposal.modifications.length > 0, 'no modifications');
  return proposal.modifications.map((m) => `${m.type}:${m.targetElementId}`).join(', ');
});

await check('revalidated result layout passes (before → after flip)', async () => {
  assert(proposal, 'no proposal from previous step');
  const { status, json } = await call('/layouts/validate', { layout: proposal.resultLayout, goals });
  assert(status === 200 && json.summary.allPassed === true, `allPassed=${json.summary?.allPassed}`);
  assert(JSON.stringify(json.findings) === JSON.stringify(proposal.findingsAfter), 'findingsAfter does not match a fresh validation');
});

await check('impossible request is never labelled feasible', async () => {
  const { status, json } = await call('/proposals/generate', impossible);
  assert(status === 200, `HTTP ${status}`);
  const after = json.proposals[0].findingsAfter;
  assert(after.some((f) => f.verdict === 'fail'), 'expected at least one failed finding');
});

await check('missing door width becomes unknown, not pass', async () => {
  const unmeasured = clone(layout);
  delete unmeasured.doors[0].clearWidth;
  const { status, json } = await call('/layouts/validate', { layout: unmeasured, goals });
  assert(status === 200 && json.summary.unknownCount > 0, `unknownCount=${json.summary?.unknownCount}`);
  const door = json.findings.find((f) => f.affectedElementIds.includes(unmeasured.doors[0].id) && f.goalId === 'goal-doors');
  assert(!door || door.verdict === 'unknown', `unmeasured door verdict was ${door?.verdict}`);
});

await check('draft (unconfirmed) goals are rejected', async () => {
  const draft = clone(goals);
  draft[0].status = 'draft';
  const { status } = await call('/layouts/validate', { layout, goals: draft });
  assert(status === 422 || status === 400, `expected 4xx, got ${status}`);
});

await check('malformed layout is rejected, not crashed', async () => {
  const broken = clone(layout);
  broken.doors[0].clearWidth = -5;
  const { status } = await call('/layouts/validate', { layout: broken, goals });
  assert(status >= 400 && status < 500, `expected 4xx, got ${status}`);
});

if (express) {
  await check('cost catalog is illustrative', async () => {
    const { status, json } = await call('/catalog/costs');
    assert(status === 200 && Array.isArray(json.items), `HTTP ${status}`);
    assert(Array.isArray(json.limitations) && json.limitations.length > 0, 'catalog has no limitations text');
  });

  await check('proposal cost lines come from the catalog', async () => {
    assert(proposal, 'no proposal');
    assert(proposal.costs.length > 0, 'Express did not attach cost lines');
    assert(proposal.costs.every((c) => c.status === 'illustrative' && c.lowUsd <= c.highUsd), 'bad cost line');
    const ids = new Set(proposal.modifications.map((m) => m.id));
    assert(proposal.costs.every((c) => ids.has(c.modificationId)), 'cost line references unknown modification');
  });

  await check('Gemma returns draft goals (real model call)', async () => {
    const { status, json } = await call('/requirements/interpret', {
      description: 'Make it easier to move between the bedroom, bathroom, and kitchen using a wheelchair. Budget $12,000.',
      layout,
    });
    assert(status === 200, `HTTP ${status} ${JSON.stringify(json.error ?? {})}`);
    assert(Array.isArray(json.goals) && json.goals.length > 0, 'no goals');
    assert(json.goals.every((g) => g.status === 'draft'), 'AI goals must come back as draft');
    return `model ${json.model}`;
  });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = failed ? 1 : 0;
