// static/js/controllers.js
let revealTimer = null;
let noiseTimer = null;


import { state } from "./state.js";
import { dom } from "./dom.js";
import { api } from "./api.js";
import {
  uiLog,
  renderTicketPairs,
  setTicketStatus,
  setWinnerDisplay,
  renderMultiResult,
  renderSystemStats,
  renderLocustStats,
  renderRaceStats,
  renderSummaryTerminal,
  clearSummaryTerminal,
  appendSummaryLine,
  renderRevealFrame,
  showHiddenWinner,
} from "./ui.js";

// --------------------
// helpers
// --------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTicket(ticket) {
  if (!ticket) return "-";
  return String(ticket).match(/.{1,2}/g)?.join(" ") || String(ticket);
}

function resetPersonalScenarioState() {
  state.myCheckResult = null;
  state.myCheckLatencyMs = null;
  state.myCheckExists = null;
  state.myCheckIsWinner = null;

  state.latestLocustStats = null;
  state.liveScenarioStatsSnapshot = null;
}

function buildScenarioVerdict(stats) {
  if (!stats) return "unknown";

  const p95 = Number(stats?.p95 ?? 0);
  const failRatio = Number(stats?.fail_ratio ?? 0);

  if (failRatio > 0) return "errors detected under load";
  if (p95 > 1000) return "high latency under heavy load";
  if (p95 > 300) return "stable, but latency is rising";
  return "system stable under live traffic";
}

async function showPersonalScenarioSummary() {
  const stats = state.liveScenarioStatsSnapshot || null;

  const peakRps =
  stats?.rps !== undefined && stats?.rps !== null
    ? Number(stats.rps).toFixed(1)
    : "-";

const worstP95 =
  stats?.p95 !== undefined && stats?.p95 !== null
    ? Math.round(Number(stats.p95))
    : "-";

const failRate =
  stats?.fail_ratio !== undefined && stats?.fail_ratio !== null
    ? `${(Number(stats.fail_ratio) * 100).toFixed(1)}%`
    : "-";

  const myResult =
    state.myCheckIsWinner === true
      ? "jackpot"
      : state.myCheckExists === true
      ? "no match"
      : state.myCheckExists === false
      ? "not found"
      : "not checked";

  await renderSummaryTerminal([
    "generating final report...",
    `scenario: ${state.currentScenarioName || "-"}`,
    `winning ticket: ${state.winningTicket || "-"}`,
    `your ticket: ${formatTicket(state.currentTicket)}`,
    `your result: ${myResult}`,
    `your request latency: ${state.myCheckLatencyMs ?? "-"} ms`,
    `peak rps: ${peakRps}`,
    `worst p95: ${worstP95} ms`,
    `fail rate: ${failRate}`,
    `verdict: ${buildScenarioVerdict(stats)}`
  ]);
}

let presetAbort = false;

async function stopLoadNow(message = "Scenario stopped.") {
  presetAbort = true;
  await captureLiveScenarioSnapshot(); // снять live stats до stop
  await api.locustStop();
  stopWinnerReveal(true);
  state.isScenarioRunning = false;
  uiLog(message, "success");
  appendSummaryLine("scenario finished");
  appendSummaryLine("full winning ticket revealed");

  await showPersonalScenarioSummary();
}

function hasMeaningfulLocustStats(stats) {
  if (!stats) return false;

  const rps = Number(stats?.rps ?? 0);
  const p95 = Number(stats?.p95 ?? 0);
  const failRatio = Number(stats?.fail_ratio ?? 0);

  const hasFullStats =
    Array.isArray(stats?.full_stats) && stats.full_stats.some((x) => Number(x?.num_requests ?? 0) > 0);

  return rps > 0 || p95 > 0 || failRatio > 0 || hasFullStats;
}

async function captureLiveScenarioSnapshot() {
  const { res, data } = await api.locustStats();

  if (res?.ok && hasMeaningfulLocustStats(data)) {
    state.latestLocustStats = data;
    state.liveScenarioStatsSnapshot = data;
    return data;
  }

  return null;
}

// --------------------
// UI Scenario buttons (index.html)
// --------------------
export async function onScenarioStop() {
  await stopLoadNow("Scenario stop requested.");
}

export async function onBurst5000() {
  presetAbort = false;
  await runBurstAfterDraw({ users: 5000, spawn: 5000, holdMs: 20000, idleMs: 10000 });
}

export async function onBurst2000() {
  presetAbort = false;
  await runBurstAfterDraw({ users: 2000, spawn: 2000, holdMs: 20000, idleMs: 10000 });
}

export async function onSteady2000() {
  presetAbort = false;
  await runSteadyTraffic({ users: 2000, spawn: 200, holdMs: 60000 });
}

// --------------------
// Scenario implementations
// --------------------
async function runBurstAfterDraw({ users, spawn, holdMs, idleMs }) {
  state.currentScenarioName = `burst ${users}`;
  state.isScenarioRunning = false;
  resetPersonalScenarioState();

  clearSummaryTerminal();
  appendSummaryLine(`scenario selected: burst ${users}`);
  appendSummaryLine("waiting for idle phase...");

  uiLog(`Scenario started: Burst after draw (${users}).`, "info");

  await captureLiveScenarioSnapshot();
  await api.locustStop();
  await sleep(800);

  uiLog(`Idle phase: waiting ${Math.round(idleMs / 1000)}s (no load)...`, "info");
  await sleep(idleMs);
  if (presetAbort) return;

  uiLog("Performing admin draw...", "info");
  appendSummaryLine("performing official draw...");

  const draw = await api.adminDraw();
  if (!draw?.res?.ok) {
    uiLog(draw?.data?.detail || "Draw failed. Burst cancelled.", "error");
    appendSummaryLine(`draw failed: ${draw?.data?.detail || "unknown error"}`);
    return;
  }

  const winner = String(draw?.data?.winner || "");
  state.winningTicket = winner;

  appendSummaryLine("official draw completed");
  appendSummaryLine(`winning ticket: ${winner || "-"}`);

  uiLog(`Draw OK. Winner: ${winner || "-"}`, "success");
  if (presetAbort) return;

  uiLog(`BURST NOW -> users=${users}, spawn_rate=${spawn}`, "info");
  appendSummaryLine("live traffic spike started");
  appendSummaryLine("you can verify your ticket during load");

  state.isScenarioRunning = true;
  await api.locustStart(users, spawn);
  startWinnerReveal(holdMs);
  await sleep(holdMs);

  if (presetAbort) return;
  await api.locustStop();
  stopWinnerReveal(true);
  state.isScenarioRunning = false;
  uiLog("Scenario completed: Burst finished.", "success");
  appendSummaryLine("scenario finished");
  appendSummaryLine("full winning ticket revealed");

await showPersonalScenarioSummary();
}

async function runSteadyTraffic({ users, spawn, holdMs }) {
  state.currentScenarioName = `steady ${users}`;
  state.isScenarioRunning = false;
  resetPersonalScenarioState();

  clearSummaryTerminal();
  appendSummaryLine(`scenario selected: steady ${users}`);
  appendSummaryLine("starting sustained live traffic...");

  uiLog(`Scenario started: Steady traffic (${users}).`, "info");

  await api.locustStop();
  await sleep(800);

  if (presetAbort) return;

  uiLog(`Ramp to steady -> users=${users}, spawn_rate=${spawn}`, "info");
  appendSummaryLine("live traffic started");
  appendSummaryLine("you can verify your ticket during load");

  state.isScenarioRunning = true;
  await api.locustStart(users, spawn);
  startWinnerReveal(holdMs);

  await sleep(holdMs);
  if (presetAbort) return;

  await api.locustStop();
  stopWinnerReveal(true);
  state.isScenarioRunning = false;
  uiLog("Scenario completed: Steady finished.", "success");
  appendSummaryLine("scenario finished");
  appendSummaryLine("full winning ticket revealed");

  await showPersonalScenarioSummary();
}

export function initControlTabs() {
  const tabLocust = dom.tabLocust?.();
  const tabRace = dom.tabRace?.();
  const panelLocust = dom.panelLocust?.();
  const panelRace = dom.panelRace?.();
  const metricsLocust = dom.metricsLocust?.();
  const metricsRace = dom.metricsRace?.();

  if (!tabLocust || !tabRace || !panelLocust || !panelRace || !metricsLocust || !metricsRace) {
    console.warn("initControlTabs: some tab elements not found");
    return;
  }

  function showLocust() {
    tabLocust.classList.add("active");
    tabRace.classList.remove("active");

    panelLocust.classList.add("active");
    panelRace.classList.remove("active");

    metricsLocust.classList.add("active");
    metricsRace.classList.remove("active");
  }

  function showRace() {
    tabRace.classList.add("active");
    tabLocust.classList.remove("active");

    panelRace.classList.add("active");
    panelLocust.classList.remove("active");

    metricsRace.classList.add("active");
    metricsLocust.classList.remove("active");
  }

  tabLocust.onclick = showLocust;
  tabRace.onclick = showRace;

  showLocust();
}

export async function onRaceRun() {
  const mode = dom.raceMode?.().value || "unsafe";
  const concurrency = parseInt(dom.raceConcurrency?.().value || "200", 10) || 200;

  uiLog(`Running race test: mode=${mode}, concurrency=${concurrency}`, "info");

  const { res, data } = await api.raceRun(mode, concurrency);

  if (!res?.ok) {
    const msg = data?.detail || "Race test failed";
    uiLog(msg, "error");

    renderRaceStats({
      stored_success_count: 0,
      duplicate_bug: false,
      duration_ms: 0,
      final_claimed_by: "-",
      winners: [],
      mode,
      concurrency,
    });

    return;
  }

  renderRaceStats(data);

  const timeline = Array.isArray(data?.race_timeline) ? data.race_timeline : [];
  const winnerEvent = timeline.find((e) => e?.status === "SUCCESS") || null;

  await renderSummaryTerminal([
    "booting analyzer...",
    "collecting race metrics...",
    `mode: ${data.mode}`,
    `concurrency: ${data.concurrency}`,
    `winning ticket: ${state.winningTicket || "-"}`,
    `expected winners: ${data.expected_winners ?? 1}`,
    `actual winners: ${data.actual_winners ?? data.stored_success_count}`,
    `consistency: ${data.consistency || (data.duplicate_bug ? "BROKEN" : "OK")}`,
    `first successful request: ${data.first_successful_request || data.final_claimed_by || "-"}`,
    `winner latency: ${winnerEvent ? `${winnerEvent.latency_ms} ms` : "-"}`,
    `race window: ${Number(data.race_window_ms ?? 0).toFixed(2)} ms`,
    data.duplicate_bug
      ? "verdict: race condition reproduced"
      : "verdict: atomic protection works"
  ]);

  if (data?.duplicate_bug) {
    uiLog("Race condition detected: duplicate claim occurred.", "warning");
  } else {
    uiLog("Race test completed safely.", "success");
  }
}

export async function onRaceReset() {
  const { res, data } = await api.raceReset();

  if (!res?.ok) {
    uiLog(data?.detail || "Race reset failed", "error");
    return;
  }

  renderRaceStats({
    stored_success_count: 0,
    duplicate_bug: false,
    duration_ms: 0,
    final_claimed_by: "-",
    winners: [],
    mode: "-",
    concurrency: 0,
  });

  uiLog("Race state reset.", "info");
}

// --------------------
// Legacy preset controls (optional)
// --------------------
export async function stopPreset() {
  await stopLoadNow("Preset stopped.");
}

export async function runPreset() {
  presetAbort = false;

  const preset = dom.presetSelect?.()?.value || "gradual";
  if (preset === "gradual") return runGradualRamp();
  if (preset === "burst") {
    return runBurstAfterDraw({ users: 5000, spawn: 5000, holdMs: 20000, idleMs: 10000 });
  }

  uiLog("Unknown preset.", "error");
}

async function runGradualRamp() {
  uiLog("Preset started: Gradual ramp.", "info");

  const steps = [
    { users: 0, spawn: 1, holdMs: 3000 },
    { users: 500, spawn: 100, holdMs: 10000 },
    { users: 1000, spawn: 150, holdMs: 10000 },
    { users: 2000, spawn: 250, holdMs: 10000 },
    { users: 3000, spawn: 300, holdMs: 10000 },
  ];

  state.currentScenarioName = "gradual ramp";
  state.isScenarioRunning = false;
  resetPersonalScenarioState();

  clearSummaryTerminal();
  appendSummaryLine("scenario selected: gradual ramp");

  await api.locustStop();
  await sleep(800);

  for (const step of steps) {
    if (presetAbort) return;

    if (step.users === 0) {
      uiLog(`Hold idle for ${Math.round(step.holdMs / 1000)}s...`, "info");
      appendSummaryLine("idle phase...");
      await sleep(step.holdMs);
      continue;
    }

    uiLog(`Swarm -> users=${step.users}, spawn_rate=${step.spawn}`, "info");
    appendSummaryLine(`step: users=${step.users}, spawn=${step.spawn}`);

    state.isScenarioRunning = true;
    await api.locustStart(step.users, step.spawn);
    await sleep(step.holdMs);
  }

  state.isScenarioRunning = false;
  uiLog("Preset completed: ramp finished.", "success");
  appendSummaryLine("scenario finished");
  await showPersonalScenarioSummary();
}

// --------------------
// Core UI actions
// --------------------
export async function onGenerate(type) {
  const count = parseInt(dom.participantsInput().value || "0", 10) || 100000;

  state.targetCount = count;
  state.lastTotal = 0;
  state.startTime = performance.now();

  uiLog(`Starting ${String(type).toUpperCase()} generation...`, "info");

  const { res, data } = await api.generate(type, count);
  if (!res?.ok) {
    uiLog(data?.detail || "Generation failed", "error");
    state.startTime = null;
  }
}

export async function onAdminDraw() {
  const btn = dom.btnDraw();

  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  }

  setWinnerDisplay("DRAWING...", "loading");
  uiLog("Starting official draw...", "info");
  appendSummaryLine("performing official draw...");

  try {
    const { res, data } = await api.adminDraw();
    if (!res?.ok) {
      setWinnerDisplay("FAILED", "error");
      uiLog(data?.detail || "Draw failed", "error");
      appendSummaryLine(`draw failed: ${data?.detail || "unknown error"}`);
      return;
    }

    const winner = String(data?.winner || "");
    state.winningTicket = winner;
    const pairs = winner.match(/.{1,2}/g) || [];
    showHiddenWinner(pairs.length);

uiLog(`Draw successful. Winner locked.`, "success");

appendSummaryLine("official draw completed");
appendSummaryLine("winning ticket locked");
appendSummaryLine("winner reveal will run during live scenario");
  } catch (e) {
    console.error(e);
    setWinnerDisplay("ERROR", "error");
    uiLog("Draw failed (network error).", "error");
    appendSummaryLine("draw failed: network error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }
}

export async function onPullTicket() {
  if (!state.winningTicket) {
    uiLog("Run admin draw first.", "error");
    renderTicketPairs(null);
    state.currentTicket = "";
    setTicketStatus("DRAW REQUIRED", "#ff4444");
    appendSummaryLine("cannot pull ticket: official draw not completed");
    return;
  }

  const { res, data } = await api.pullTicket();

  if (!res?.ok || data?.status !== "ok") {
    uiLog("Ticket pool is empty. Generate first.", "error");
    renderTicketPairs(null);
    state.currentTicket = "";
    setTicketStatus("No ticket loaded.", "#ff4444");
    return;
  }

  const pairs = data.ticket_pairs || [];
  state.currentTicket = pairs.join("");

  renderTicketPairs(pairs);
  setTicketStatus("Ticket pulled. Ready to verify.", "#888");
  uiLog("Ticket loaded.", "success");
  appendSummaryLine("personal ticket pulled from pool");
  appendSummaryLine(`your ticket: ${formatTicket(state.currentTicket)}`);
}

export async function onPullAndVerifyTicket() {
  await onPullTicket();

  if (!state.currentTicket) {
    return;
  }

  await onVerifyTicket();
}

export async function onVerifyTicket() {
  if (!state.currentTicket) {
    uiLog("Pull a ticket first.", "error");
    appendSummaryLine("cannot verify: no ticket loaded");
    return;
  }

  if (state.isScenarioRunning) {
    appendSummaryLine("joining live traffic...");
  }

  appendSummaryLine("verifying your ticket...");

  const started = performance.now();
  const { res, data } = await api.checkTicket(state.currentTicket);
  const latency = Math.round(performance.now() - started);

  state.myCheckLatencyMs = latency;
  state.myCheckResult = data;

  if (!res?.ok) {
    uiLog(data?.detail || "Verification failed", "error");
    appendSummaryLine(`request failed: ${data?.detail || "verification error"}`);
    return;
  }

  if (data?.status !== "ok") {
    uiLog("Draw not ready. Run admin draw first.", "error");
    setTicketStatus("DRAW NOT READY", "#ff4444");
    appendSummaryLine("draw not ready");
    return;
  }

  state.myCheckExists = data?.exists ?? false;
  state.myCheckIsWinner = data?.is_winner ?? false;

  appendSummaryLine(`your response time: ${latency} ms`);

  if (!data.exists) {
    uiLog("Ticket not found in pool.", "info");
    setTicketStatus("NOT FOUND", "#ff4444");
    appendSummaryLine("result: ticket not found");
    return;
  }

  if (data.is_winner) {
    setTicketStatus("JACKPOT!", "var(--neon-green)");
    uiLog("Winner confirmed.", "success");
    appendSummaryLine("result: jackpot");
    appendSummaryLine("prize claim available");
  } else {
    setTicketStatus("NO MATCH", "#ff4444");
    uiLog("No match.", "info");
    appendSummaryLine("result: no match");
  }
}

export async function onMultiCheck() {
  const totalInDb =
    parseInt((dom.totalCounter().textContent || "0").replace(/[^0-9]/g, ""), 10) || 0;

  if (totalInDb < 10000) {
    uiLog("Pool too small or empty (min 10,000).", "error");
    return;
  }

  let countVal = parseInt(dom.multiCountInput().value || "0", 10);
  if (!countVal || countVal < 10000) countVal = 10000;
  if (countVal > totalInDb) countVal = totalInDb;

  dom.multiCountInput().value = String(countVal);
  uiLog(`Running multi-check for ${countVal.toLocaleString()}...`, "info");

  const { res, data } = await api.multiCheck(countVal);
  if (!res?.ok) {
    uiLog(data?.detail || "Multi-check rejected", "error");
    return;
  }

  renderMultiResult(data);
  uiLog("Multi-check completed.", "success");
}

// --------------------
// Polling
// --------------------
export async function tickSystemStats() {
  const { res, data } = await api.systemStats();
  if (!res?.ok) return;
  renderSystemStats(data.redis_mem, data.sys_mem_bytes, data.sys_total_bytes);
}

export async function tickLocustStats() {
  const { res, data } = await api.locustStats();
  if (!res?.ok) return;

  state.latestLocustStats = data;

  if (state.isScenarioRunning && hasMeaningfulLocustStats(data)) {
    state.liveScenarioStatsSnapshot = data;
  }

  renderLocustStats(data);
}

// --------------------
// Locust manual control
// --------------------
export async function onLocustStart() {
  const u = parseInt(dom.locustUsersInput().value || "0", 10) || 100;
  const s = parseInt(dom.locustSpawnInput().value || "0", 10) || 10;

  state.currentScenarioName = "manual locust load";
  state.isScenarioRunning = true;
  resetPersonalScenarioState();

  clearSummaryTerminal();
  appendSummaryLine("scenario selected: manual locust load");
  appendSummaryLine(`target users: ${u}`);
  appendSummaryLine(`spawn rate: ${s}`);
  if (state.winningTicket) {
    appendSummaryLine(`winning ticket: ${state.winningTicket}`);
  }
  appendSummaryLine("live traffic started");
  appendSummaryLine("you can verify your ticket during load");

  await api.locustStart(u, s);
  uiLog(`Locust start requested: users=${u}, spawn=${s}`, "info");
}

export async function onLocustStop() {
  await captureLiveScenarioSnapshot();
  await api.locustStop();
  state.isScenarioRunning = false;
  uiLog("Locust stop requested.", "info");
  appendSummaryLine("live traffic stopped");
  await showPersonalScenarioSummary();
}

// --------------------
// Demo Ramp Scenario
// --------------------
export async function onRunDemo() {
  uiLog("Demo started: clear -> generate -> draw -> ramp -> report", "info");

  const btn = dom.btnRunDemo?.();
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  }

  clearSummaryTerminal();
  appendSummaryLine("ramp test requested");
  appendSummaryLine("preparing pool and starting automated flow...");
  appendSummaryLine("official draw will run automatically");

  const startedAt = performance.now();
  const spin = ["|", "/", "-", "\\"];
  let spinIdx = 0;
  const progressTimer = setInterval(() => {
    const sec = Math.floor((performance.now() - startedAt) / 1000);
    appendSummaryLine(`ramp in progress ${spin[spinIdx]} (${sec}s)`);
    spinIdx = (spinIdx + 1) % spin.length;
  }, 2500);

  try {
    const { res, data } = await api.runDemo();

    if (!res?.ok || data?.status !== "ok") {
      uiLog(data?.detail || "Demo failed", "error");
      appendSummaryLine(`ramp failed: ${data?.detail || "unknown error"}`);
      return;
    }

    const report = data?.report || null;
    const winner = report?.winner ? String(report.winner) : "";
    if (winner) {
      state.winningTicket = winner;
      setWinnerDisplay(winner, "winner");
      appendSummaryLine(`official draw completed: ${winner}`);
    } else {
      appendSummaryLine("official draw completed");
    }

    uiLog("Demo finished successfully.", "success");

    const reportRes = await api.latestDemoReport();
    const s = reportRes?.data?.summary || null;

    await renderSummaryTerminal([
      "ramp test complete.",
      `winner: ${winner || "-"}`,
      `steps executed: ${s?.steps_executed ?? report?.steps?.length ?? "-"}`,
      `peak rps: ${s?.peak_rps ?? "-"}`,
      `worst p95: ${s?.worst_p95 ?? "-"} ms`,
      `stable up to: ${s?.stable_users ?? "-"} users`,
      `fail rate at last step: ${s?.last_fail_rate ?? "-"}%`,
      `bottleneck: ${s?.bottleneck ?? "unknown"}`,
      `verdict: ${s?.verdict ?? "no verdict"}`
    ]);

    if (data?.report_path) {
      uiLog(`Report saved: ${data.report_path}`, "success");
    }
  } catch (e) {
    console.error(e);
    uiLog("Demo failed (network/server error).", "error");
    appendSummaryLine("ramp failed: network/server error");
  } finally {
    clearInterval(progressTimer);

    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }
}

// --------------------
// RESET SIMULATION BUTTON
// --------------------
export async function onClearDatabase() {
  if (!confirm("Reset simulation state?")) return;

  try {
    // 1. stop load engine first
    await api.locustStop();

    // маленькая пауза, чтобы locust успел схлопнуться
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 2. clear redis state
    const { res, data } = await api.clearDatabase();

    if (!res?.ok) {
      uiLog(data?.detail || "State reset failed", "error");
      return;
    }

    // 3. локально сразу обнулим UI, чтобы не видеть старые цифры
    state.latestLocustStats = null;
    state.liveScenarioStatsSnapshot = null;
    state.isScenarioRunning = false;
    state.currentTicket = "";
    state.winningTicket = "";
    state.myCheckResult = null;
    state.myCheckLatencyMs = null;
    state.myCheckExists = null;
    state.myCheckIsWinner = null;

    renderLocustStats({
      rps: 0,
      p95: 0,
      fail_ratio: 0,
      full_stats: [],
    });

    renderTicketPairs(null);
    setTicketStatus("No ticket loaded.", "#888");
    setWinnerDisplay("NOT DRAWN", "idle");
    clearSummaryTerminal();

    uiLog("Simulation state cleared.", "success");

    // если хочешь оставить reload — можно,
    // но после локального сброса он уже не обязателен
    location.reload();
  } catch (e) {
    console.error(e);
    uiLog("Reset failed (network/server error).", "error");
  }
}

//TICKET ANIMATION

function startWinnerReveal(durationMs) {

  if (!state.winningTicket) return;

  const pairs = state.winningTicket.match(/.{1,2}/g) || [];
  const stepMs = durationMs / pairs.length;

  let revealed = 0;

  renderRevealFrame(pairs, 0);

  // красный шум 20 fps
  noiseTimer = setInterval(() => {
    renderRevealFrame(pairs, revealed);
  }, 50);

  // постепенное раскрытие
  revealTimer = setInterval(() => {
    revealed++;

    if (revealed >= pairs.length) {
      stopWinnerReveal(true);
    }

  }, stepMs);
}

function stopWinnerReveal(revealAll = false) {

  if (noiseTimer) {
    clearInterval(noiseTimer);
    noiseTimer = null;
  }

  if (revealTimer) {
    clearInterval(revealTimer);
    revealTimer = null;
  }

  if (revealAll && state.winningTicket) {
    const pairs = state.winningTicket.match(/.{1,2}/g) || [];
    renderRevealFrame(pairs, pairs.length);
  }
}
