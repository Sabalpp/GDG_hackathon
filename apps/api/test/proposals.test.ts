import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type RequestListener } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { generateProposalResponseSchema } from '../src/schemas/proposals.js';

const input = {
  layout: {
    id: 'layout', units: 'mm',
    walls: [{ id: 'wall', start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thickness: 100, editable: true, source: 'sample' }],
    doors: [{ id: 'door', wallId: 'wall', center: { x: 1500, y: 0 }, clearWidth: 800, editable: true, source: 'sample' }],
    objects: [], rooms: [{ id: 'room', label: 'Room', polygon: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }] }],
  },
  goals: [{ id: 'goal', type: 'minimum-door-width', targetMm: 900, status: 'confirmed' }],
  budget: { currency: 'USD', max: 5000 },
};
const integrity = { id: 'integrity:clear', goalId: 'layout-integrity', verdict: 'pass', affectedElementIds: [], explanation: 'No object collisions.' };
const before = { id: 'goal:door', goalId: 'goal', verdict: 'fail', measuredMm: 800, requiredMm: 900, affectedElementIds: ['door'], explanation: 'Narrow door.' };
function fixture() {
  const resultLayout = structuredClone(input.layout);
  resultLayout.id = 'redesign';
  resultLayout.doors[0]!.clearWidth = 920;
  return { proposals: [{
    id: 'proposal', originalLayoutId: 'layout', resultLayout,
    modifications: [{ id: 'resize', type: 'resize-demo-door', targetElementId: 'door', params: { clearWidth: 920 }, requiresProfessionalReview: true }],
    findingsBefore: [integrity, before], findingsAfter: [integrity, { ...before, verdict: 'pass', measuredMm: 920, explanation: 'Wider demo door.' }],
    costs: [], unresolvedQuestions: ['Keep this Python warning.'],
  }] };
}
async function start(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function withServices(handler: RequestListener, run: (url: string) => Promise<void>, timeoutMs = 1000) {
  const python = createServer(handler);
  const baseUrl = await start(python);
  const api = createServer(createApp(undefined, {}, { baseUrl, timeoutMs }));
  try { await run(await start(api)); } finally { await close(api); await close(python); }
}
const respond = (body: unknown): RequestListener => (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
};
const post = (url: string, body: unknown = input) => fetch(`${url}/api/v1/proposals/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('proposal route forwards actual Python contract and enriches every proposal with catalog costs', async () => {
  const python = fixture();
  python.proposals.push({ ...structuredClone(python.proposals[0]!), id: 'second' });
  await withServices(async (req, res) => {
    assert.equal(req.url, '/api/v1/proposals/generate');
    assert.equal(req.method, 'POST');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), input);
    respond(python)(req, res);
  }, async (url) => {
    const response = await post(url);
    assert.equal(response.status, 200);
    const body = generateProposalResponseSchema.parse(await response.json());
    assert.equal(body.proposals.length, 2);
    for (const [i, proposal] of body.proposals.entries()) {
      const original = python.proposals[i]!;
      for (const key of ['resultLayout', 'findingsBefore', 'findingsAfter', 'modifications'] as const) assert.deepEqual(proposal[key], original[key]);
      assert.deepEqual(proposal.costs.map((line) => [line.modificationId, line.lowUsd, line.highUsd, line.status]), [['resize', 800, 3500, 'illustrative']]);
      assert.deepEqual(proposal.costEstimate.total, { lowUsd: 800, highUsd: 3500, status: 'illustrative' });
      assert(proposal.unresolvedQuestions.includes('Keep this Python warning.'));
      assert(proposal.unresolvedQuestions.some((text) => text.includes('not construction-ready')));
      assert(proposal.unresolvedQuestions.some((text) => text.includes('budget')));
      assert.equal(proposal.costEstimate.professionalEstimates[0]?.modificationId, 'resize');
    }
  });
});

test('draft goals, invalid budget, bad layout references and unknown fields never reach Python', async () => {
  let calls = 0;
  const variants: any[] = [null, {}, { ...input, budget: { currency: 'EUR', max: 20 } }, { ...input, budget: { currency: 'USD', max: -1 } }];
  const draft = structuredClone(input); draft.goals[0]!.status = 'draft'; variants.push(draft);
  const refs = structuredClone(input); refs.layout.doors[0]!.wallId = 'missing'; variants.push(refs);
  variants.push({ ...input, geometryBaseUrl: 'http://attacker' });
  await withServices((_req, res) => { calls++; res.end(); }, async (url) => {
    for (const variant of variants) assert.equal((await post(url, variant)).status, 400);
    const response = await fetch(`${url}/api/v1/proposals/generate`, { method: 'POST', body: 'text' });
    assert.equal(response.status, 415);
    assert.equal(calls, 0);
  });
});

test('unknown and failed results remain honest; no-edit proposals get zero costs', async () => {
  const body = fixture();
  const proposal = body.proposals[0]!;
  proposal.modifications = [];
  proposal.resultLayout.doors[0]!.clearWidth = 800;
  proposal.findingsAfter = [integrity, { ...before, verdict: 'unknown', measuredMm: undefined } as any];
  const noBudget = { layout: input.layout, goals: input.goals };
  await withServices(respond(body), async (url) => {
    const response = await post(url, noBudget);
    assert.equal(response.status, 200);
    const result = (await response.json()).proposals[0];
    assert.equal(result.findingsAfter[1].verdict, 'unknown');
    assert.equal(result.findingsAfter[1].measuredMm, undefined);
    assert.equal(result.findingsBefore[1].verdict, 'fail');
    assert.deepEqual(result.costs, []);
    assert.equal(result.costEstimate.total.highUsd, 0);
  });
});

test('malformed or inconsistent engine responses are rejected', async () => {
  const variants: unknown[] = [{}, { proposals: [] }];
  const change = (fn: (body: any) => void) => { const body = fixture(); fn(body); variants.push(body); };
  change((b) => b.proposals[0].originalLayoutId = 'wrong');
  change((b) => b.proposals[0].resultLayout.units = 'in');
  change((b) => b.proposals[0].findingsAfter[1].goalId = 'missing');
  change((b) => b.proposals[0].findingsAfter[1].measuredMm = 800);
  change((b) => b.proposals[0].findingsBefore = []);
  change((b) => b.proposals[0].modifications[0].targetElementId = 'missing');
  change((b) => b.proposals[0].modifications.push(b.proposals[0].modifications[0]));
  change((b) => b.proposals.push(b.proposals[0]));
  for (const body of variants) await withServices(respond(body), async (url) => {
    const response = await post(url);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_GEOMETRY_RESPONSE');
  });
});

test('proposal endpoint handles unavailable engine, invalid JSON, rejection and timeout safely', async () => {
  const scenarios: [RequestListener, number, string][] = [
    [(req) => req.socket.destroy(), 502, 'GEOMETRY_UNAVAILABLE'],
    [(_req, res) => { res.writeHead(422); res.end('private data'); }, 422, 'INVALID_GEOMETRY_REQUEST'],
    [(_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); }, 502, 'INVALID_GEOMETRY_RESPONSE'],
    [() => {}, 504, 'GEOMETRY_TIMEOUT'],
  ];
  for (const [handler, status, code] of scenarios) await withServices(handler, async (url) => {
    const result = await post(url); assert.equal(result.status, status);
    const body = await result.json(); assert.equal(body.error.code, code);
    assert.equal(body.proposals, undefined);
    assert(!JSON.stringify(body).includes('private data'));
  }, 100);
});

test('unavailable catalog does not return proposals with fabricated prices', async () => {
  const previous = process.env.ADAPT_DATA_DIR;
  process.env.ADAPT_DATA_DIR = '/private/tmp/adapt-missing-proposal-catalog';
  try {
    await withServices(respond(fixture()), async (url) => {
      const response = await post(url); assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'COST_CATALOG_UNAVAILABLE');
    });
  } finally {
    if (previous === undefined) delete process.env.ADAPT_DATA_DIR;
    else process.env.ADAPT_DATA_DIR = previous;
  }
});
