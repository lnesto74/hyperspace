/**
 * Resolve main vs demo KPI database/calculator from request query or header.
 */
export function getDemoSessionId(req) {
  const raw = req.query.demoSession || req.headers['x-demo-session'];
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

export function resolveKpiContext(req, mainDb, mainKpiCalculator, mainTrajectoryStorage, demoSessionService) {
  const sessionId = getDemoSessionId(req);
  if (!sessionId || !demoSessionService) {
    return {
      db: mainDb,
      kpiCalculator: mainKpiCalculator,
      trajectoryStorage: mainTrajectoryStorage,
      isDemo: false,
      sessionId: null,
      venueId: null,
    };
  }

  const session = demoSessionService.getSession(sessionId);
  if (!session) {
    return {
      db: mainDb,
      kpiCalculator: mainKpiCalculator,
      trajectoryStorage: mainTrajectoryStorage,
      isDemo: false,
      sessionId: null,
      venueId: null,
    };
  }

  return {
    db: demoSessionService.demoDb,
    kpiCalculator: session.kpiCalculator,
    trajectoryStorage: session.trajectoryStorage,
    isDemo: true,
    sessionId,
    venueId: session.venueId,
  };
}

export function demoCacheSuffix(req, demoSessionService) {
  const sessionId = getDemoSessionId(req);
  if (!sessionId || !demoSessionService?.getSession(sessionId)) return '';
  return `:demo:${sessionId}`;
}
