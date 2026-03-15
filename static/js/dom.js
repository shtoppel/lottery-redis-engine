// static/js/dom.js

export const $ = (id) => document.getElementById(id);

export const dom = {
  // top stats
  totalCounter: () => $("total-counter"),
  rpsCounter: () => $("rps-counter"),
  redisMemVal: () => $("redis-mem-val"),
  sysMemVal: () => $("sys-mem-val"),
  progressPercent: () => $("progress-percent"),
  progressBar: () => $("progress-bar"),
  timerVal: () => $("timer-val"),
  effRps: () => $("eff-rps"),

  // demo ramp test
  btnRunDemo: () => $("btnRunDemo"),

  // inputs
  participantsInput: () => $("participants"),
  multiCountInput: () => $("multi-count"),
  locustUsersInput: () => $("locust-users"),
  locustSpawnInput: () => $("locust-spawn"),

  // ui blocks
  userNumbers: () => $("user-numbers"),
  ticketStatus: () => $("ticket-status"),
  multiResults: () => $("multi-results"),
  gameStatus: () => $("game-status"),
  winnerDisplay: () => $("winner-display"),

  // generator buttons
  btnGenPython: () => $("btn-gen-python"),
  btnGenLua: () => $("btn-gen-lua"),
  btnDraw: () => $("btn-draw"),

  btnPullVerify: () => $("btn-pull-verify"),
  btnMulti: () => $("btn-multi"),

  // locust manual control
  btnLocustStart: () => $("btn-locust-start"),
  btnLocustStop: () => $("btn-locust-stop"),

  // locust stats
  statsBody: () => $("stats-body"),
  externalRps: () => $("external-rps"),
  p95Latency: () => $("p95-latency"),
  failRate: () => $("fail-rate"),

  // scenario UI buttons
  btnBurst5000: () => $("btn-burst-5000"),
  btnBurst2000: () => $("btn-burst-2000"),
  btnSteady: () => $("btn-steady"),
  btnScenarioStop: () => $("btn-scenario-stop"),

  // scenario status
  scenarioStatus: () => $("scenario-status"),
  scenarioStep: () => $("scenario-step"),
  scenarioMsg: () => $("scenario-msg"),

  // ---- control tabs ----
  tabLocust: () => $("tab-locust"),
  tabRace: () => $("tab-race"),

  panelLocust: () => $("panel-locust"),
  panelRace: () => $("panel-race"),

  metricsLocust: () => $("metrics-locust"),
  metricsRace: () => $("metrics-race"),

  // ---- race test controls ----
  raceMode: () => $("race-mode"),
  raceConcurrency: () => $("race-concurrency"),
  btnRaceRun: () => $("btn-race-run"),
  btnRaceReset: () => $("btn-race-reset"),

  // ---- race stats ----
  raceSuccessCount: () => $("race-success-count"),
  raceDuplicateBug: () => $("race-duplicate-bug"),
  raceDuration: () => $("race-duration"),
  raceResult: () => $("race-result"),


  btnClear: () => $("btn-clear"),

};