import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { interpretResponseSchema } from '../src/schemas/requirements.js';
import { generateWithGemma, type GenerateInterpretation } from '../src/services/requirements.js';

const draft = {
  goals: [{ category: 'bathroom_access', priority: 'high', room: 'bathroom' }],
  missingInformation: ['mobility', 'budget'],
};

async function withApi(generate: GenerateInterpretation, run: (url: string) => Promise<void>) {
  const server = createApp(generate).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

const post = (url: string, body: unknown) => fetch(`${url}/api/v1/requirements/interpret`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('POST returns a validated draft, questions, and server-authored warnings', async () => {
  await withApi(async (text) => {
    assert.equal(text, 'I need help accessing my bathroom.');
    return JSON.stringify(draft);
  }, async (url) => {
    const response = await post(url, { text: '  I need help accessing my bathroom.  ' });
    assert.equal(response.status, 200);
    const body = interpretResponseSchema.parse(await response.json());
    assert.equal(body.status, 'draft');
    assert.equal(body.goals[0]?.description, 'Explore more accessible bathroom use.');
    assert(body.questions.some((question) => question.includes('measurements')));
    assert(body.questions.some((question) => question.includes('budget')));
    assert(body.warnings.some((warning) => warning.includes('compliance has not been assessed')));
    assert(body.warnings.some((warning) => warning.includes('Information is missing')));
  });
});

test('rejects invalid inputs before calling the model', async () => {
  await withApi(async () => { throw new Error('Must not call model'); }, async (url) => {
    for (const body of [{}, { text: ' ' }, { text: 5 }, { text: 'x'.repeat(8001) }, { text: 'help', apiKey: 'secret' }]) {
      const response = await post(url, body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
    }
    const nullBody = await post(url, null);
    assert.equal(nullBody.status, 400);
    assert.equal((await nullBody.json()).error.code, 'INVALID_JSON');
  });
});

test('invalid JSON, oversized bodies, and unsupported media types return JSON errors', async () => {
  await withApi(async () => { throw new Error('Must not call model'); }, async (url) => {
    const endpoint = `${url}/api/v1/requirements/interpret`;
    const malformed = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
    const oversized = await post(url, { text: 'x'.repeat(1_100_000) });
    assert.equal(oversized.status, 413);
    const unsupported = await fetch(endpoint, { method: 'POST', body: 'help' });
    assert.equal(unsupported.status, 415);
  });
});

test('rejects malformed, empty, or unsafe model output without returning it', async () => {
  for (const raw of [undefined, '', 'not JSON', '{}', JSON.stringify({ ...draft, measurements: { width: 900 } }),
    JSON.stringify({ ...draft, goals: [{ ...draft.goals[0], description: 'Code compliant at 900 mm' }] }),
    JSON.stringify({ ...draft, goals: [{ category: 'code_compliant', priority: 'high', room: null }] })]) {
    await withApi(async () => raw, async (url) => {
      const response = await post(url, { text: 'Help me use my bathroom' });
      assert.equal(response.status, 502);
      const body = await response.json();
      assert.equal(body.error.code, 'INVALID_AI_RESPONSE');
      assert(!JSON.stringify(body).includes('900'));
    });
  }
});

test('unclear needs produce clarification questions even if model omits them', async () => {
  await withApi(async () => JSON.stringify({ goals: [], missingInformation: [] }), async (url) => {
    const response = await post(url, { text: 'help' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.goals, []);
    assert(body.questions.some((question: string) => question.includes('daily activities')));
    assert(body.questions.some((question: string) => question.includes('measurements')));
  });
});

test('provider failures are sanitized', async () => {
  await withApi(async () => { throw new Error('secret-api-key and private user text'); }, async (url) => {
    const response = await post(url, { text: 'help' });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: {
      code: 'AI_UNAVAILABLE', message: 'Interpretation service is unavailable. Please try again.',
    } });
  });
});

test('missing server credentials return 503 without attempting a provider request', async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    await withApi(generateWithGemma, async (url) => {
      const response = await post(url, { text: 'help' });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'AI_NOT_CONFIGURED');
    });
  } finally {
    if (previous !== undefined) process.env.GEMINI_API_KEY = previous;
  }
});

test('health endpoint remains available', async () => {
  await withApi(async () => undefined, async (url) => {
    const response = await fetch(`${url}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });
});
