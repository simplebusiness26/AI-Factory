const SEVERITY_SCORE = { critical: 100, high: 80, medium: 60, low: 30, healthy: 0 };

export function releaseState(project) {
  const github = project?.github || {};
  const build = github.build || {};
  const release = github.latestRelease || null;
  const apk = release?.assets?.find((asset) => String(asset.name || '').toLowerCase().endsWith('.apk')) || null;
  const state = build.conclusion || build.status || 'unknown';
  return {
    projectId: project?.id,
    projectName: project?.name,
    buildState: state,
    buildName: build.name || null,
    buildUrl: build.url || null,
    releaseName: release?.name || release?.tag || null,
    releaseUrl: release?.url || null,
    releaseDate: release?.publishedAt || null,
    apk: apk ? { name: apk.name, url: apk.url, size: apk.size || null } : null
  };
}

export function buildReleaseFactory(projects) {
  const items = (projects || []).map(releaseState);
  return {
    projects: items,
    passing: items.filter((item) => item.buildState === 'success').length,
    failing: items.filter((item) => item.buildState === 'failure').length,
    running: items.filter((item) => ['queued', 'in_progress'].includes(item.buildState)).length,
    withRelease: items.filter((item) => item.releaseUrl).length,
    withApk: items.filter((item) => item.apk).length,
    checkedAt: new Date().toISOString()
  };
}

export function buildToday(projects, watchtower) {
  const projectById = new Map((projects || []).map((project) => [project.id, project]));
  const tasks = [];

  for (const incident of watchtower?.incidents || []) {
    if (!['critical', 'high', 'medium'].includes(incident.severity)) continue;
    tasks.push({
      id: `incident:${incident.projectId}:${incident.code}`,
      projectId: incident.projectId,
      projectName: incident.projectName,
      priority: incident.severity === 'critical' ? 1 : incident.severity === 'high' ? 2 : 3,
      score: SEVERITY_SCORE[incident.severity] || 0,
      source: 'watchtower',
      title: incident.message,
      detail: Array.isArray(incident.detail) ? incident.detail.join(' · ') : incident.detail || null
    });
  }

  for (const project of projects || []) {
    const blockers = project?.brain?.blockers || [];
    blockers.forEach((blocker, index) => tasks.push({
      id: `blocker:${project.id}:${index}`,
      projectId: project.id,
      projectName: project.name,
      priority: 2,
      score: 75 - index,
      source: 'project-brain',
      title: `Unblock ${project.name}`,
      detail: blocker
    }));
  }

  for (const project of projects || []) {
    const first = project?.brain?.nextActions?.[0];
    if (!first) continue;
    const hasHigher = tasks.some((item) => item.projectId === project.id && item.priority <= 2);
    tasks.push({
      id: `next:${project.id}`,
      projectId: project.id,
      projectName: project.name,
      priority: hasHigher ? 4 : 3,
      score: hasHigher ? 35 : 55,
      source: 'next-action',
      title: first,
      detail: project?.brain?.currentState || null
    });
  }

  const deduped = [];
  const seen = new Set();
  for (const task of tasks.sort((a, b) => a.priority - b.priority || b.score - a.score || a.projectName.localeCompare(b.projectName))) {
    const key = `${task.projectId}:${task.title}:${task.detail || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(task);
  }

  const selected = deduped.slice(0, 10).map((task, index) => ({ ...task, rank: index + 1 }));
  return {
    generatedAt: new Date().toISOString(),
    topCount: selected.length,
    criticalCount: selected.filter((item) => item.priority === 1).length,
    tasks: selected,
    quietProjects: (projects || []).filter((project) => !selected.some((task) => task.projectId === project.id)).map((project) => ({ id: project.id, name: project.name })),
    projectCount: projectById.size
  };
}
