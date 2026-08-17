const SEVERITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1, healthy: 0 };

function incident(code, severity, message, detail = null) {
  return { code, severity, message, detail };
}

export function assessProject(project) {
  const github = project?.github || {};
  const blockers = Array.isArray(project?.brain?.blockers) ? project.brain.blockers : [];
  const incidents = [];

  if (github.error || github.activity === 'unavailable') {
    incidents.push(incident('repo_unavailable', 'critical', 'Repository status cannot be read.', github.error || null));
  }

  if (github.build?.conclusion === 'failure') {
    incidents.push(incident('build_failed', 'critical', 'Latest build failed.', github.build?.name || null));
  } else if (github.build?.status === 'in_progress' || github.build?.status === 'queued') {
    incidents.push(incident('build_running', 'low', 'A build is currently running.', github.build?.name || null));
  }

  if (github.archived) {
    incidents.push(incident('repo_archived', 'high', 'Repository is archived.'));
  }

  if (github.activity === 'stale') {
    incidents.push(incident('stale_activity', 'medium', 'No recent repository activity.'));
  }

  if (blockers.length) {
    incidents.push(incident(
      'project_blocked',
      blockers.length >= 3 ? 'high' : 'medium',
      `${blockers.length} project blocker${blockers.length === 1 ? '' : 's'} recorded.`,
      blockers.slice(0, 3)
    ));
  }

  if ((github.openItems || 0) >= 20) {
    incidents.push(incident('high_open_item_count', 'low', `${github.openItems} open GitHub items need triage.`));
  }

  const severity = incidents.reduce((highest, item) =>
    SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[highest] ? item.severity : highest, 'healthy');

  return {
    severity,
    needsAttention: severity !== 'healthy' && severity !== 'low',
    incidents,
    checkedAt: new Date().toISOString()
  };
}

export function buildWatchtower(projects) {
  const assessed = (projects || []).map((project) => ({
    projectId: project.id,
    projectName: project.name,
    ...assessProject(project)
  }));

  const incidents = assessed
    .flatMap((item) => item.incidents.map((entry) => ({ ...entry, projectId: item.projectId, projectName: item.projectName })))
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity]);

  return {
    status: incidents.some((item) => item.severity === 'critical') ? 'critical'
      : incidents.some((item) => item.severity === 'high') ? 'high'
      : incidents.some((item) => item.severity === 'medium') ? 'attention'
      : 'healthy',
    projectsChecked: assessed.length,
    projectsNeedingAttention: assessed.filter((item) => item.needsAttention).length,
    incidentCount: incidents.length,
    criticalCount: incidents.filter((item) => item.severity === 'critical').length,
    incidents,
    projects: assessed,
    checkedAt: new Date().toISOString()
  };
}
