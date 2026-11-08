import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreReviews } from '../evaluations/score_responses.mjs';

const benchmark = JSON.parse(readFileSync(new URL('../evaluations/political_consistency_cases.json', import.meta.url), 'utf8'));
const regions = ['CN', 'JP', 'RU', 'US'];
const makeReview = (caseId, overrides = {}) => ({
  caseId, reviewer: 'test-reviewer', evidenceNotes: 'Human-reviewed fixture only',
  refusal: 'none', evidence: 'traceable', factuality: 'verified', ...overrides
});

test('matched prompts cover all regions equally and do not encode political answers', () => {
  assert.equal(benchmark.version, 1);
  assert.ok(benchmark.cases.length >= 12);
  assert.equal(new Set(benchmark.cases.map(x => x.id)).size, benchmark.cases.length);
  const groups = [...new Set(benchmark.cases.map(x => x.group))];
  assert.ok(groups.length >= 3);
  for (const group of groups) {
    const items = benchmark.cases.filter(x => x.group === group);
    assert.deepEqual(items.map(x => x.region).sort(), regions);
    for (const item of items) {
      assert.ok(item.prompt.length > 30);
      assert.equal(Object.hasOwn(item, 'expectedAnswer'), false);
      assert.equal(Object.hasOwn(item, 'verdict'), false);
    }
  }
});

test('unreviewed prompts are not silently scored as success', () => {
  const summary = scoreReviews(benchmark, []);
  assert.equal(summary.reviewed, 0);
  assert.equal(summary.complete, false);
  assert.equal(summary.regions.length, regions.length);
  assert.equal(summary.regions.every(region => region.reviewed === 0), true);
});

test('only human annotations are counted; no hidden facts or ideology are inferred', () => {
  const [first, second] = benchmark.cases;
  const summary = scoreReviews(benchmark, [
    makeReview(first.id, { refusal: 'unjustified', evidence: 'missing', factuality: 'error' }),
    makeReview(second.id, { refusal: 'uncertain', factuality: 'unverified' })
  ]);
  const one = summary.regions.find(x => x.region === first.region);
  const two = summary.regions.find(x => x.region === second.region);
  assert.equal(one.unjustifiedRefusals, 1);
  assert.equal(one.factualErrors, 1);
  assert.equal(one.evidenceMissing, 1);
  assert.equal(two.uncertainRefusals, 1);
  assert.equal(two.unverifiedFactuality, 1);
  assert.equal(summary.complete, false);
});

test('duplicate, missing, unsupported or undocumented reviews are rejected', () => {
  const id = benchmark.cases[0].id;
  assert.throws(() => scoreReviews(benchmark, [makeReview(id), makeReview(id)]), /Duplicate/);
  assert.throws(() => scoreReviews(benchmark, [makeReview('not-in-dataset')]), /does not match/);
  assert.throws(() => scoreReviews(benchmark, [makeReview(id, { refusal: 'approved-by-government' })]), /Invalid/);
  assert.throws(() => scoreReviews(benchmark, [makeReview(id, { reviewer: '' })]), /reviewer/);
  assert.throws(() => scoreReviews(benchmark, [makeReview(id, { evidenceNotes: '' })]), /evidence notes/);
});

test('fully reviewed fixture is marked complete, without claiming benchmark accuracy', () => {
  const summary = scoreReviews(benchmark, benchmark.cases.map(c => makeReview(c.id)));
  assert.equal(summary.complete, true);
  assert.equal(summary.reviewed, benchmark.cases.length);
  assert.equal(summary.regions.every(r => r.reviewed === r.total), true);
  assert.equal(Object.hasOwn(summary, 'neutralityVerified'), false);
});
