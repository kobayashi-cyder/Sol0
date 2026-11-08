import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, runInferenceText, USAGE } from '../tools/inference_cli.mjs';

const remoteFlags = [
  '--remote', '--consent',
  '--endpoint=http://127.0.0.1:1234/v1/chat/completions',
  '--allow-origin=http://127.0.0.1:1234',
  '--model=test-local-model', '--source=user-installed', '--license=user-verified'
];

test('developer CLI defaults to existing offline engine', async () => {
  assert.ok(USAGE.includes('Local WSP'));
  assert.equal(Object.keys(parseCliArgs([])).length, 0);
  const result = await runInferenceText('こんにちは', parseCliArgs([]), () => { throw Error('network must not be called'); });
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('remote CLI requires explicit endpoint allowlist and consent', () => {
  assert.throws(() => parseCliArgs(['--remote']), /Missing/);
  assert.throws(() => parseCliArgs(remoteFlags.filter(x => x !== '--consent')), /consent/);
  assert.throws(() => parseCliArgs(remoteFlags.filter(x => !x.startsWith('--allow-origin'))), /allow-origin/);
  assert.throws(() => parseCliArgs(['--consent']), /require --remote/);
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown/);
  assert.throws(() => parseCliArgs([...remoteFlags, '--remote']), /Duplicate/);
  assert.deepEqual(parseCliArgs(['--help']), { help: true });
});

test('explicitly approved CLI can use compatible local model response', async () => {
  let count = 0;
  const response = await runInferenceText('test prompt', parseCliArgs(remoteFlags), async (url, options) => {
    count++;
    assert.equal(url, 'http://127.0.0.1:1234/v1/chat/completions');
    assert.deepEqual(JSON.parse(options.body).messages, [{ role: 'user', content: 'test prompt' }]);
    return { ok: true, text: async () => '{"choices":[{"message":{"content":"LLM output"}}]}' };
  });
  assert.equal(response, 'LLM output');
  assert.equal(count, 1);
});

test('CLI rejects empty input and overly large prompts without attempting requests', async () => {
  await assert.rejects(() => runInferenceText('', parseCliArgs([])), /Prompt/);
  await assert.rejects(() => runInferenceText('x'.repeat(8001), parseCliArgs([])), /limit/);
});
