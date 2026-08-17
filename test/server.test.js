'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activityStatus, daysSince, cleanList, cleanString, makeSummary } = require('../server');

test('cleanString trims and caps input', () => {
  assert.equal(cleanString('  hello  ', 10), 'hello');
  assert.equal(cleanString('abcdefgh', 4), 'abcd');
  assert.equal(cleanString(null), '');
});

test('cleanList removes empty values and enforces item limits', () => {
  assert.deepEqual(cleanList([' one ', '', 'two', null], 10, 20), ['one', 'two']);
  assert.deepEqual(cleanList(['a', 'b', 'c'], 2, 20), ['a', 'b']);
});

test('daysSince handles current and invalid dates', () => {
  assert.equal(daysSince(new Date().toISOString()), 0);
  assert.equal(daysSince('not-a-date'), null);
  assert.equal(daysSince(null), null);
});

test('activityStatus classifies repository activity', () => {
  assert.equal(activityStatus({ pushedAt: new Date().toISOString() }), 'active');
  assert.equal(activityStatus({ pushedAt: new Date(Date.now() - 8 * 86400000).toISOString() }), 'warm');
  assert.equal(activityStatus({ pushedAt: new Date(Date.now() - 30 * 86400000).toISOString() }), 'stale');
  assert.equal(activityStatus({ error: 'nope' }), 'unavailable');
});

test('makeSummary counts active, attention and blockers', () => {
  const summary = makeSummary([
    { github: { activity: 'active', build: { conclusion: 'success' } }, brain: { blockers: [] } },
    { github: { activity: 'stale', build: { conclusion: 'failure' } }, brain: { blockers: ['Need key'] } },
    { github: { activity: 'unavailable', build: {} }, brain: { blockers: [] } }
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.active, 1);
  assert.equal(summary.attention, 2);
  assert.equal(summary.blockers, 1);
  assert.equal(summary.buildsFailing, 1);
});
