import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INFERENCE_LIMITS, InferenceRouter, createLocalProvider, createWSPProvider,
  createNetworkPolicy, createHTTPChatProvider, validateModelRecord
} from '../chat_web/inference_gateway.js';

const record = { modelId: 'locally-hosted-model', source: 'user supplied local server', license: 'user-verified license', sha256: null };
const endpoint = 'http://127.0.0.1:1234/v1/chat/completions';
const policy = () => createNetworkPolicy({ enabled: true, allowedOrigins: ['http://127.0.0.1:1234'] });

test('local route is the default, and no network provider is consulted', async () => {
  const calls = [], audit = [];
  const router = new InferenceRouter({
    localProvider: createLocalProvider(text => 'WSP:' + text),
    remoteProvider: { id: 'remote', generate: () => { calls.push('remote'); throw Error('network'); } },
    onAudit: event => audit.push(event)
  });
  const answer = await router.generate('こんにちは');
  assert.deepEqual(answer, { text: 'WSP:こんにちは', providerId: 'sol0-wsp', fallback: false });
  assert.deepEqual(calls, []);
  assert.deepEqual(audit, [{ event: 'inference', provider: 'sol0-wsp', outcome: 'success' }]);
  assert.equal(JSON.stringify(audit).includes('こんにちは'), false);
});

test('existing SolZeroEngine.reply can be wrapped without altering engine behavior', async () => {
  const state = { messages: [] }, context = { knowledge: [] };
  const engine = { reply(text, s, c) {
    assert.equal(s, state); assert.equal(c, context);
    return 'legacy:' + text;
  } };
  const router = new InferenceRouter({
    localProvider: createWSPProvider(engine, { getState: () => state, getContext: () => context })
  });
  assert.equal((await router.generate('既存')).text, 'legacy:既存');
});

test('explicit route and per-request consent are mandatory', async () => {
  let remoteCalls = 0;
  const router = new InferenceRouter({
    localProvider: createLocalProvider(() => 'local'),
    remoteProvider: { id: 'remote', generate: async () => { remoteCalls++; return 'remote'; } }
  });
  await assert.rejects(() => router.generate('test', { route: 'remote' }), /consent/);
  await assert.rejects(() => router.generate('test', { route: 'auto', consent: true }), /route/);
  assert.equal(remoteCalls, 0);
  assert.equal((await router.generate('test', { route: 'remote', consent: true })).text, 'remote');
  assert.equal(remoteCalls, 1);
});

test('HTTP transport denies all traffic by default and rejects non-allowlisted hosts', async () => {
  let sent = 0;
  const fakeFetch = async () => { sent++; return { ok: true, text: async () => '{"choices":[{"message":{"content":"ok"}}]}' }; };
  const disabled = createHTTPChatProvider({ endpoint, modelRecord: record, fetchImpl: fakeFetch });
  await assert.rejects(() => disabled.generate('test', { consent: true }), /disabled/);
  const differentHost = createHTTPChatProvider({
    endpoint, modelRecord: record,
    networkPolicy: createNetworkPolicy({ enabled: true, allowedOrigins: ['http://localhost:1234'] }),
    fetchImpl: fakeFetch
  });
  await assert.rejects(() => differentHost.generate('test', { consent: true }), /allowlisted/);
  const allowed = createHTTPChatProvider({ endpoint, modelRecord: record, networkPolicy: policy(), fetchImpl: fakeFetch });
  await assert.rejects(() => allowed.generate('test'), /consent/);
  assert.equal(sent, 0);
});

test('approved HTTP request is bounded, has no credentials and rejects redirects', async () => {
  let called = 0;
  const provider = createHTTPChatProvider({
    endpoint, modelRecord: record, networkPolicy: policy(),
    fetchImpl: async (url, options) => {
      called++;
      assert.equal(url, endpoint);
      assert.equal(options.method, 'POST');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.equal(options.referrerPolicy, 'no-referrer');
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.messages, [{ role: 'user', content: 'hello' }]);
      assert.equal(payload.model, record.modelId);
      return { ok: true, text: async () => '{"choices":[{"message":{"content":"hello world"}}]}' };
    }
  });
  assert.equal(await provider.generate('hello', { consent: true }), 'hello world');
  assert.equal(called, 1);
  assert.equal(provider.model.hashVerified, false);
});

test('HTTPS remote is permitted only when explicitly allowlisted', () => {
  assert.deepEqual(createNetworkPolicy(), { enabled: false, allowedOrigins: [] });
  assert.throws(() => createNetworkPolicy({ enabled: true, allowedOrigins: ['http://example.org'] }), /loopback/);
  assert.throws(() => createNetworkPolicy({ enabled: true, allowedOrigins: ['https://example.org/path'] }), /origin/);
  assert.throws(() => createHTTPChatProvider({ endpoint: 'http://example.org/v1/chat/completions', modelRecord: record }), /loopback/);
  assert.throws(() => createHTTPChatProvider({ endpoint: 'https://user:secret@example.org/v1/chat/completions', modelRecord: record }), /Credentials/);
  assert.throws(() => createHTTPChatProvider({ endpoint: 'https://example.org/v1/chat/completions?token=secret', modelRecord: record }), /Credentials/);
  assert.throws(() => createHTTPChatProvider({ endpoint: 'https://example.org/other', modelRecord: record }), /completions/);
  assert.equal(createNetworkPolicy({ enabled: true, allowedOrigins: ['https://example.org'] }).allowedOrigins[0], 'https://example.org');
});

test('remote failures do not silently fall back unless explicitly requested', async () => {
  const local = createLocalProvider(() => 'local');
  const remote = { id: 'remote', generate: async () => { throw new Error('transport failure'); } };
  const router = new InferenceRouter({ localProvider: local, remoteProvider: remote, onAudit() { throw Error('audit callback failed'); } });
  await assert.rejects(() => router.generate('test', { route: 'remote', consent: true }), /transport failure/);
  assert.deepEqual(await router.generate('test', { route: 'remote', consent: true, fallbackOnError: true }),
    { text: 'local', providerId: 'sol0-wsp', fallback: true });
  await assert.rejects(() => router.generate('test', { route: 'remote', consent: false, fallbackOnError: true }), /consent/);
});

test('no unbounded input, output, model metadata or response payloads', async () => {
  assert.throws(() => validateModelRecord({ ...record, sha256: 'no' }), /sha256/);
  assert.deepEqual(validateModelRecord({ ...record, sha256: 'A'.repeat(64) }).sha256, 'a'.repeat(64));
  assert.throws(() => validateModelRecord({ ...record, license: '' }), /license/);
  const router = new InferenceRouter({ localProvider: createLocalProvider(() => 'ok') });
  await assert.rejects(() => router.generate('x'.repeat(INFERENCE_LIMITS.inputChars + 1)), /prompt/);
  const huge = new InferenceRouter({ localProvider: createLocalProvider(() => 'x'.repeat(INFERENCE_LIMITS.outputChars + 1)) });
  await assert.rejects(() => huge.generate('test'), /bounded/);
  const excessive = createHTTPChatProvider({
    endpoint, modelRecord: record, networkPolicy: policy(),
    fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(INFERENCE_LIMITS.responseChars + 1) })
  });
  await assert.rejects(() => excessive.generate('test', { consent: true }), /exceeds/);
  const malformed = createHTTPChatProvider({
    endpoint, modelRecord: record, networkPolicy: policy(),
    fetchImpl: async () => ({ ok: true, text: async () => '{}' })
  });
  await assert.rejects(() => malformed.generate('test', { consent: true }), /bounded/);
});
