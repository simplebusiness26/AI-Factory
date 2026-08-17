const TRUTH_STATES = new Set(['idea', 'planned', 'in_progress', 'tested', 'completed', 'published']);
const PRIVACY_LEVELS = new Set(['private', 'internal', 'content_eligible']);

function text(value, max = 5000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeText(value, max = 12000) {
  return redactSecrets(text(value, max))
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function redactSecrets(input) {
  let value = String(input || '');
  const rules = [
    [/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, 'Bearer [REDACTED]'],
    [/\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
    [/\bsbp_[A-Za-z0-9]{20,}\b/g, '[REDACTED_SUPABASE_TOKEN]'],
    [/\b(?:password|passwd|api[_-]?key|secret|access[_-]?token|database[_-]?url)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi, '[REDACTED_SECRET_ASSIGNMENT]'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
    [/https?:\/\/[^\s]+[?&](?:token|key|secret|signature|sig|auth)=[^\s&]+/gi, '[REDACTED_SENSITIVE_URL]']
  ];
  for (const [pattern, replacement] of rules) value = value.replace(pattern, replacement);
  return value;
}

function cleanEvidence(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 30).map((item) => ({
    kind: text(item?.kind, 80) || 'evidence',
    title: normalizeText(item?.title, 300),
    text: normalizeText(item?.text, 5000),
    reference: text(item?.reference, 1500),
    occurredAt: text(item?.occurredAt, 100)
  })).filter((item) => item.title || item.text || item.reference);
}

function truthState(value, fallback = 'in_progress') {
  return TRUTH_STATES.has(value) ? value : fallback;
}

function privacyLevel(value) {
  return PRIVACY_LEVELS.has(value) ? value : 'internal';
}

export function buildGhostWriterPacket(input) {
  const projectId = text(input?.projectId, 100);
  const source = text(input?.source, 120);
  const body = normalizeText(input?.text, 12000);
  if (!projectId) throw new Error('Ghost Writer bridge requires projectId.');
  if (!source) throw new Error('Ghost Writer bridge requires source.');
  if (!body) throw new Error('Ghost Writer bridge requires evidence text.');

  const privacy = privacyLevel(input?.privacy);
  const contentEligible = privacy === 'content_eligible' && input?.contentEligible === true;
  const occurredAt = text(input?.occurredAt, 100) || new Date().toISOString();
  const sessionId = text(input?.sessionId, 500) || `ai-factory:${projectId}:${stableHash(`${source}\n${occurredAt}\n${body}`)}`;

  return {
    projectId,
    source,
    sessionId,
    title: normalizeText(input?.title, 500),
    text: body,
    evidence: cleanEvidence(input?.evidence),
    sourceReference: text(input?.sourceReference, 1500) || undefined,
    occurredAt,
    truthState: truthState(input?.truthState),
    privacy,
    contentEligible
  };
}

export function packetDedupeKey(packet) {
  return `ghostwriter:${stableHash([
    packet.projectId,
    packet.source,
    packet.sessionId,
    packet.truthState,
    packet.privacy,
    packet.text
  ].join('\n'))}`;
}

export function buildGitHubBridgePacket(project) {
  const github = project?.github || {};
  const commit = github.latestCommit;
  if (!commit?.sha) return null;

  const build = github.build || {};
  const truth = build.conclusion === 'success' ? 'tested' : 'in_progress';
  const evidence = [{
    kind: 'github_commit',
    title: commit.shortSha ? `Commit ${commit.shortSha}` : 'Latest commit',
    text: `${commit.message || 'Commit'}${commit.author ? ` — ${commit.author}` : ''}`,
    reference: commit.url || github.url || '',
    occurredAt: commit.date || github.pushedAt || ''
  }];
  if (build.url || build.name || build.conclusion) {
    evidence.push({
      kind: 'github_actions',
      title: build.name || 'Latest build',
      text: `Build status: ${build.status || 'unknown'}${build.conclusion ? `; conclusion: ${build.conclusion}` : ''}`,
      reference: build.url || '',
      occurredAt: github.updatedAt || ''
    });
  }

  return buildGhostWriterPacket({
    projectId: project.id,
    source: 'github',
    sessionId: `github:${project.repo}:${commit.sha}`,
    title: `${project.name}: ${commit.message || 'GitHub activity'}`,
    text: [
      `Repository: ${project.repo}`,
      `Branch: ${github.defaultBranch || 'unknown'}`,
      `Latest commit: ${commit.shortSha || commit.sha}`,
      `Commit message: ${commit.message || 'unknown'}`,
      `Build: ${build.conclusion || build.status || 'not checked'}`,
      `Project state: ${project.brain?.currentState || 'not recorded'}`
    ].join('\n'),
    evidence,
    sourceReference: commit.url || github.url || '',
    occurredAt: commit.date || github.pushedAt || new Date().toISOString(),
    truthState: truth,
    privacy: 'internal',
    contentEligible: false
  });
}

export function buildKnowledgeBridgePacket(item) {
  const contentAngle = text(item?.contentAngle ?? item?.content_angle, 3000);
  const eligible = Boolean(contentAngle);
  return buildGhostWriterPacket({
    projectId: text(item?.projectId ?? item?.project_id, 100) || 'ai-factory',
    source: 'ai-factory:knowledge-mine',
    sessionId: `knowledge:${item?.id || stableHash(`${item?.title || ''}\n${item?.lesson || ''}`)}`,
    title: text(item?.title, 300) || 'Knowledge Mine lesson',
    text: [
      item?.problem ? `What happened: ${item.problem}` : '',
      item?.lesson ? `Lesson: ${item.lesson}` : '',
      item?.principle ? `Reusable principle: ${item.principle}` : '',
      contentAngle ? `Content angle: ${contentAngle}` : ''
    ].filter(Boolean).join('\n'),
    occurredAt: item?.createdAt ?? item?.created_at,
    truthState: 'in_progress',
    privacy: eligible ? 'content_eligible' : 'internal',
    contentEligible: eligible
  });
}

export function buildDecisionBridgePacket(item) {
  const finalDecision = text(item?.finalDecision ?? item?.final_decision, 3000);
  return buildGhostWriterPacket({
    projectId: text(item?.projectId ?? item?.project_id, 100) || 'ai-factory',
    source: 'ai-factory:decision-engine',
    sessionId: `decision:${item?.id || stableHash(`${item?.title || ''}\n${item?.problem || ''}\n${finalDecision}`)}`,
    title: text(item?.title, 300) || 'Decision Engine record',
    text: [
      item?.problem ? `Problem: ${item.problem}` : '',
      Array.isArray(item?.options) && item.options.length ? `Options: ${item.options.join(' | ')}` : '',
      item?.recommendation ? `Recommendation: ${item.recommendation}` : '',
      finalDecision ? `Final decision: ${finalDecision}` : '',
      item?.reason ? `Reason: ${item.reason}` : ''
    ].filter(Boolean).join('\n'),
    occurredAt: item?.createdAt ?? item?.created_at,
    truthState: finalDecision ? 'completed' : 'in_progress',
    privacy: 'internal',
    contentEligible: false
  });
}

export function buildProjectBrainBridgePacket(project, brain) {
  return buildGhostWriterPacket({
    projectId: project.id,
    source: 'ai-factory:project-brain',
    sessionId: `brain:${project.id}:${stableHash(JSON.stringify(brain || {}))}`,
    title: `${project.name}: Project Brain updated`,
    text: [
      brain?.currentState ? `Current state: ${brain.currentState}` : '',
      Array.isArray(brain?.nextActions) && brain.nextActions.length ? `Next actions: ${brain.nextActions.join(' | ')}` : '',
      Array.isArray(brain?.blockers) && brain.blockers.length ? `Blockers: ${brain.blockers.join(' | ')}` : 'Blockers: none recorded'
    ].filter(Boolean).join('\n'),
    occurredAt: new Date().toISOString(),
    truthState: 'in_progress',
    privacy: 'internal',
    contentEligible: false
  });
}

export function makeContentEligible(packet) {
  return {
    ...packet,
    privacy: 'content_eligible',
    contentEligible: true
  };
}

function stableHash(value) {
  return `${fnv1a64(value)}${fnv1a64([...String(value)].reverse().join(''))}`;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const character of String(value)) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
