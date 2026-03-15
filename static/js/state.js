export const state = {
  lastTotal: 0,
  latestLocustStats: null,
  liveScenarioStatsSnapshot: null,
  isScenarioRunning: false,
  targetCount: 0,
  startTime: null,
  currentTicket: "", // 16-char string

  myCheckResult: null,
  myCheckLatencyMs: null,
  myCheckExists: null,
  myCheckIsWinner: null,
  currentScenarioName: "",
  winningTicket: "",
  ws: null,
};
