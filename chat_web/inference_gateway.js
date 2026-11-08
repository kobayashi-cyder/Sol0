/**
 * Opt-in inference boundary for Sol0. This module is deliberately NOT wired into
 * the production chat UI yet. Default behavior remains the existing offline WSP.
 * No model weights, credentials, telemetry, or remote calls are bundled here.
 */

export const INFERENCE_LIMITS = Object.freeze({
  inputChars: 8000,
  outputChars: 20000,
  responseChars: 256000,
  timeoutMs: 30000
});

function requiredText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new TypeError(label + ' must be nonempty text of at most ' + max + ' characters');
  }
  return value.trim();
}

function checkPrompt(value) {
  return requiredText(value, 'prompt', INFERENCE_LIMITS.inputChars);
}

function checkOutput(value) {
  if (typeof value !== 'string' || value.length > INFERENCE_LIMITS.outputChars) {
    throw new Error('Inference output is not bounded text');
  }
  return value;
}

/**
 * Provenance is descriptive, not a claim that an unknown model has been audited.
 * An absent sha256 is recorded as null rather than presented as verified.
 */
export function validateModelRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('Model record is required');
  }
  const modelId = requiredText(record.modelId, 'modelId', 120);
  const source = requiredText(record.source, 'source', 500);
  const license = requiredText(record.license, 'license', 120);
  const sha256 = record.sha256 == null ? null : requiredText(record.sha256, 'sha256', 64).toLowerCase();
  if (sha256 !== null && !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new TypeError('sha256 must be 64 hexadecimal characters');
  }
  return Object.freeze({ modelId, source, license, sha256, hashVerified: false });
}

function parseUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new TypeError('Invalid endpoint or origin URL'); }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError('Credentials, query strings and fragments are not allowed in inference URLs');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('Only HTTP(S) inference URLs are supported');
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !isLoopback) {
    throw new TypeError('Unencrypted HTTP is permitted only on loopback');
  }
  return url;
}

/** Explicit, immutable allowlist. Empty or disabled policies prohibit all egress. */
export function createNetworkPolicy({ enabled = false, allowedOrigins = [] } = {}) {
  if (typeof enabled !== 'boolean' || !Array.isArray(allowedOrigins)) {
    throw new TypeError('Invalid network policy');
  }
  const origins = allowedOrigins.map(origin => {
    const value = requiredText(origin, 'origin', 300);
    const url = parseUrl(value);
    if (value !== url.origin) throw new TypeError('Allowlist entry must be an exact origin');
    return url.origin;
  });
  return Object.freeze({ enabled, allowedOrigins: Object.freeze([...new Set(origins)]) });
}

export function createLocalProvider(generate, id = 'sol0-wsp') {
  if (typeof generate !== 'function') throw new TypeError('Local provider requires generate(text)');
  const providerId = requiredText(id, 'provider id', 80);
  return Object.freeze({
    id: providerId,
    async generate(prompt, options = {}) {
      checkPrompt(prompt);
      return checkOutput(await generate(prompt, options));
    }
  });
}

/** Adapts the existing synchronous SolZeroEngine.reply() without changing it. */
export function createWSPProvider(engine, { getState, getContext } = {}) {
  if (!engine || typeof engine.reply !== 'function') {
    throw new TypeError('Existing WSP engine must provide reply()');
  }
  if (getState !== undefined && typeof getState !== 'function') throw new TypeError('getState must be a function');
  if (getContext !== undefined && typeof getContext !== 'function') throw new TypeError('getContext must be a function');
  return createLocalProvider(
    prompt => engine.reply(prompt, getState ? getState() : undefined, getContext ? getContext() : undefined)
  );
}

/**
 * OpenAI-compatible chat-completions transport, usable with a user-run local
 * server or explicitly approved HTTPS server. No credentials are supported.
 * A caller must set BOTH networkPolicy.enabled and per-request consent=true.
 */
export function createHTTPChatProvider({
  endpoint,
  modelRecord,
  networkPolicy = createNetworkPolicy(),
  fetchImpl = globalThis.fetch
}) {
  const url = parseUrl(requiredText(endpoint, 'endpoint', 600));
  if (!url.pathname.endsWith('/v1/chat/completions')) {
    throw new TypeError('Only /v1/chat/completions endpoints are supported');
  }
  const metadata = validateModelRecord(modelRecord);
  if (!networkPolicy || networkPolicy.enabled !== true && networkPolicy.enabled !== false
      || !Array.isArray(networkPolicy.allowedOrigins)) {
    throw new TypeError('Invalid network policy');
  }
  const allowlist = createNetworkPolicy(networkPolicy);
  return Object.freeze({
    id: 'http:' + metadata.modelId,
    model: metadata,
    async generate(prompt, { consent = false, signal } = {}) {
      const text = checkPrompt(prompt);
      if (!allowlist.enabled || !allowlist.allowedOrigins.includes(url.origin)) {
        throw new Error('External inference is disabled or endpoint is not allowlisted');
      }
      if (consent !== true) {
        throw new Error('Explicit consent is required for every external inference');
      }
      if (typeof fetchImpl !== 'function') throw new Error('No HTTP transport is available');
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) throw new Error('Inference cancelled');
      signal?.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, INFERENCE_LIMITS.timeoutMs);
      try {
        const response = await fetchImpl(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: metadata.modelId,
            messages: [{ role: 'user', content: text }],
            max_tokens: 768,
            stream: false
          }),
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: controller.signal
        });
        if (!response || response.ok !== true) throw new Error('Model server rejected the request');
        const raw = await response.text();
        if (raw.length > INFERENCE_LIMITS.responseChars) {
          throw new Error('Model server response exceeds allowed size');
        }
        let payload;
        try { payload = JSON.parse(raw); } catch { throw new Error('Model server response is not JSON'); }
        return checkOutput(payload?.choices?.[0]?.message?.content);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
      }
    }
  });
}

/**
 * Remote inference is never selected implicitly. Audit events contain metadata
 * only; prompts, replies and document bodies are deliberately omitted.
 */
export class InferenceRouter {
  constructor({ localProvider, remoteProvider = null, onAudit = () => {} } = {}) {
    if (!localProvider || typeof localProvider.generate !== 'function') {
      throw new TypeError('A local provider is mandatory');
    }
    if (remoteProvider !== null && typeof remoteProvider.generate !== 'function') {
      throw new TypeError('Invalid remote provider');
    }
    if (typeof onAudit !== 'function') throw new TypeError('onAudit must be a function');
    this.localProvider = localProvider;
    this.remoteProvider = remoteProvider;
    this.onAudit = onAudit;
  }

  audit(event, provider, outcome) {
    try { this.onAudit(Object.freeze({ event, provider: String(provider.id), outcome })); }
    catch { /* Audit diagnostics must not leak content or break local inference. */ }
  }

  async generate(prompt, { route = 'local', consent = false, fallbackOnError = false, signal } = {}) {
    checkPrompt(prompt);
    if (route !== 'local' && route !== 'remote') throw new TypeError('Unknown inference route');
    if (route === 'remote' && consent !== true) {
      throw new Error('Remote inference requires per-request consent');
    }
    const provider = route === 'remote' ? this.remoteProvider : this.localProvider;
    if (!provider) throw new Error('Requested inference provider is unavailable');
    try {
      const answer = checkOutput(await provider.generate(prompt, { consent, signal }));
      this.audit('inference', provider, 'success');
      return Object.freeze({ text: answer, providerId: provider.id, fallback: false });
    } catch (error) {
      this.audit('inference', provider, 'failure');
      if (route !== 'remote' || fallbackOnError !== true || signal?.aborted) throw error;
      const text = checkOutput(await this.localProvider.generate(prompt, { signal }));
      this.audit('inference', this.localProvider, 'fallback-success');
      return Object.freeze({ text, providerId: this.localProvider.id, fallback: true });
    }
  }
}
