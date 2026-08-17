import test from 'node:test';
import assert from 'node:assert/strict';
import { assessProject, buildWatchtower } from '../src/watchtower.mjs';

test('healthy project stays healthy', () => {
  const result = assessProject({
    github: { activity: 'active', openItems: 1, build: { conclusion: 'success' } },
    brain: { blockers: [] }
  });
  assert.equal(result.severity, 'healthy');
  assert.equal(result.needsAttention, false);
  assert.equal(result.incidents.length, 0);
});

test('failed build is critical', () => {
  const result = assessProject({
    github: { activity: 'active', build: { conclusion: 'failure', name: 'Android build' } },
    brain: { blockers: [] }
  });
  assert.equal(result.severity, 'critical');
  assert.equal(result.needsAttention, true);
  assert.equal(result.incidents[0].code, 'build_failed');
});

test('blockers and stale activity produce attention', () => {
  const result = assessProject({
    github: { activity: 'stale', openItems: 0, build: { conclusion: 'success' } },
    brain: { blockers: ['Waiting for database'] }
  });
  assert.equal(result.severity, 'medium');
  assert.equal(result.needsAttention, true);
  assert.deepEqual(result.incidents.map((item) => item.code), ['stale_activity', 'project_blocked']);
});

test('portfolio watchtower sorts critical incidents first', () => {
  const result = buildWatchtower([
    { id: 'a', name: 'A', github: { activity: 'stale', build: { conclusion: 'success' } }, brain: { blockers: [] } },
    { id: 'b', name: 'B', github: { activity: 'active', build: { conclusion: 'failure' } }, brain: { blockers: [] } }
  ]);
  assert.equal(result.status, 'critical');
  assert.equal(result.projectsChecked, 2);
  assert.equal(result.projectsNeedingAttention, 2);
  assert.equal(result.incidents[0].projectId, 'b');
  assert.equal(result.incidents[0].severity, 'critical');
});
