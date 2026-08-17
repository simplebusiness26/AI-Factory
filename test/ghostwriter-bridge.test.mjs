import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGhostWriterPacket,
  buildGitHubBridgePacket,
  buildKnowledgeBridgePacket,
  buildDecisionBridgePacket,
  makeContentEligible,
  packetDedupeKey,
  redactSecrets
} from '../src/ghostwriter-bridge.mjs';

test('bridge packet matches Ghost Writer UniversalSessionInput shape', () => {
  const packet = buildGhostWriterPacket({
    projectId: 'xplorer',
    source: 'ai-factory:test',
    sessionId: 'session-1',
    title: 'Test packet',
    text: 'Implemented and tested one small change.',
    evidence: [{ kind: 'github', title: 'Commit', reference: 'https://example.test/commit/1', text: 'abc123' }],
    truthState: 'tested',
    privacy: 'internal',
    contentEligible: false,
    occurredAt: '2026-08-17T05:00:00.000Z'
  });

  assert.equal(packet.projectId, 'xplorer');
  assert.equal(packet.source, 'ai-factory:test');
  assert.equal(packet.truthState, 'tested');
  assert.equal(packet.privacy, 'internal');
  assert.equal(packet.contentEligible, false);
  assert.equal(packet.evidence.length, 1);
  assert.ok(packet.sessionId);
});

test('internal packets cannot accidentally claim content eligibility', () => {
  const packet = buildGhostWriterPacket({
    projectId: 'livepark',
    source: 'manual',
    text: 'Internal note',
    privacy: 'internal',
    contentEligible: true
  });
  assert.equal(packet.contentEligible, false);
});

test('GitHub bridge never treats a successful build as completed project work', () => {
  const packet = buildGitHubBridgePacket({
    id: 'clipmine',
    name: 'ClipMine',
    repo: 'simplebusiness26/ClipMine',
    brain: { currentState: 'MVP work is active.' },
    github: {
      defaultBranch: 'main',
      latestCommit: { sha: 'abcdef123456', shortSha: 'abcdef1', message: 'add upload flow', author: 'Craig', date: '2026-08-17T04:00:00Z', url: 'https://example.test/commit' },
      build: { status: 'completed', conclusion: 'success', name: 'Test', url: 'https://example.test/build' }
    }
  });
  assert.equal(packet.truthState, 'tested');
  assert.equal(packet.privacy, 'internal');
  assert.equal(packet.contentEligible, false);
});

test('Knowledge Mine only becomes content eligible when a content angle is explicit', () => {
  const internal = buildKnowledgeBridgePacket({ id: 1, projectId: 'designlab', title: 'Lesson', lesson: 'Keep variants isolated.' });
  const eligible = buildKnowledgeBridgePacket({ id: 2, projectId: 'designlab', title: 'Lesson', lesson: 'Keep variants isolated.', contentAngle: 'Explain why branches prevent design experiments breaking main.' });
  assert.equal(internal.contentEligible, false);
  assert.equal(internal.privacy, 'internal');
  assert.equal(eligible.contentEligible, true);
  assert.equal(eligible.privacy, 'content_eligible');
});

test('Decision Engine records are internal and final decisions describe a completed decision event', () => {
  const packet = buildDecisionBridgePacket({ id: 9, projectId: 'ai-factory', title: 'Hosting', problem: 'Where should it run?', options: ['VPS', 'Cloudflare'], finalDecision: 'Use Cloudflare', reason: 'No server bill.' });
  assert.equal(packet.truthState, 'completed');
  assert.equal(packet.contentEligible, false);
  assert.match(packet.text, /Use Cloudflare/);
});

test('queue action explicitly marks an existing packet content eligible', () => {
  const original = buildGhostWriterPacket({ projectId: 'xplorer', source: 'github', text: 'A factual event.' });
  const queued = makeContentEligible(original);
  assert.equal(queued.privacy, 'content_eligible');
  assert.equal(queued.contentEligible, true);
  assert.equal(queued.truthState, original.truthState);
});

test('bridge dedupe key is stable for the same packet', () => {
  const packet = buildGhostWriterPacket({ projectId: 'xplorer', source: 'github', sessionId: 'same', text: 'Same evidence.' });
  assert.equal(packetDedupeKey(packet), packetDedupeKey({ ...packet }));
});

test('obvious secrets are redacted before a bridge packet can be stored', () => {
  const redacted = redactSecrets('password=supersecretvalue Bearer abcdefghijklmnopqrstuvwxyz123456');
  assert.doesNotMatch(redacted, /supersecretvalue/);
  assert.match(redacted, /REDACTED/);
});
