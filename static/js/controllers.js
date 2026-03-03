// static/js/controllers.js
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
} from "./ui.js";

// --------------------
// helpers
// --------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let presetAbort = false;

async function stopLoadNow(message = "Scenario stopped.") {
  presetAbort = true;
  await api.locustStop();
  uiLog(message, "info");
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
  // Spawn rate can be high to simulate instant spike.
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
  uiLog(`Scenario started: Burst after draw (${users}).`, "info");

  // stop any current test
  await api.locustStop();
  await sleep(800);

  uiLog(`Idle phase: waiting ${Math.round(idleMs / 1000)}s (no load)...`, "info");
  await sleep(idleMs);
  if (presetAbort) return;

  uiLog("Performing admin draw...", "info");
  const draw = await api.adminDraw();
  if (!draw?.res?.ok) {
    uiLog(draw?.data?.detail || "Draw failed. Burst cancelled.", "error");
    return;
  }

  const winner = String(draw?.data?.winner || "");
  uiLog(`Draw OK. Winner: ${winner || "-"}`, "success");
  if (presetAbort) return;

  uiLog(`BURST NOW -> users=${users}, spawn_rate=${spawn}`, "info");
  await api.locustStart(users, spawn);

  await sleep(holdMs);
  if (presetAbort) return;

  await api.locustStop();
  uiLog("Scenario completed: Burst finished.", "success");
}

async function runSteadyTraffic({ users, spawn, holdMs }) {
  uiLog(`Scenario started: Steady traffic (${users}).`, "info");

  await api.locustStop();
  await sleep(800);

  if (presetAbort) return;

  uiLog(`Ramp to steady -> users=${users}, spawn_rate=${spawn}`, "info");
  await api.locustStart(users, spawn);

  await sleep(holdMs);
  if (presetAbort) return;

  await api.locustStop();
  uiLog("Scenario completed: Steady finished.", "success");
}

// --------------------
// Legacy preset controls (optional)
// If you removed preset UI from HTML, these are unused.
// --------------------
export async function stopPreset() {
  await stopLoadNow("Preset stopped.");
}

export async function runPreset() {
  presetAbort = false;

  const preset = dom.presetSelect?.()?.value || "gradual";
  if (preset === "gradual") return runGradualRamp();
  if (preset === "burst") return runBurstAfterDraw({ users: 5000, spawn: 5000, holdMs: 20000, idleMs: 10000 });

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

  await api.locustStop();
  await sleep(800);

  for (const step of steps) {
    if (presetAbort) return;

    if (step.users === 0) {
      uiLog(`Hold idle for ${Math.round(step.holdMs / 1000)}s...`, "info");
      await sleep(step.holdMs);
      continue;
    }

    uiLog(`Swarm -> users=${step.users}, spawn_rate=${step.spawn}`, "info");
    await api.locustStart(step.users, step.spawn);

    await sleep(step.holdMs);
  }

  uiLog("Preset completed: ramp finished.", "success");
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

  try {
    const { res, data } = await api.adminDraw();
    if (!res?.ok) {
      setWinnerDisplay("FAILED", "error");
      uiLog(data?.detail || "Draw failed", "error");
      return;
    }

    const winner = String(data?.winner || "");
    const formatted = winner.match(/.{1,2}/g)?.join(" ") || winner;
    setWinnerDisplay(formatted, "ok");
    uiLog(`Draw successful. Winner: ${winner}`, "success");
  } catch (e) {
    console.error(e);
    setWinnerDisplay("ERROR", "error");
    uiLog("Draw failed (network error).", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }
}

export async function onPullTicket() {
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
}

export async function onVerifyTicket() {
  if (!state.currentTicket) {
    uiLog("Pull a ticket first.", "error");
    return;
  }

  const { res, data } = await api.checkTicket(state.currentTicket);
  if (!res?.ok) {
    uiLog(data?.detail || "Verification failed", "error");
    return;
  }

  if (data?.status !== "ok") {
    uiLog("Draw not ready. Run admin draw first.", "error");
    setTicketStatus("DRAW NOT READY", "#ff4444");
    return;
  }

  if (!data.exists) {
    uiLog("Ticket not found in pool.", "info");
    setTicketStatus("NOT FOUND", "#ff4444");
    return;
  }

  if (data.is_winner) {
    setTicketStatus("JACKPOT!", "var(--neon-green)");
    uiLog("Winner confirmed.", "success");
  } else {
    setTicketStatus("NO MATCH", "#ff4444");
    uiLog("No match.", "info");
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
  renderLocustStats(data);
}

// --------------------
// Locust manual control
// --------------------
export async function onLocustStart() {
  const u = parseInt(dom.locustUsersInput().value || "0", 10) || 100;
  const s = parseInt(dom.locustSpawnInput().value || "0", 10) || 10;

  await api.locustStart(u, s);
  uiLog(`Locust start requested: users=${u}, spawn=${s}`, "info");
}

export async function onLocustStop() {
  await api.locustStop();
  uiLog("Locust stop requested.", "info");
}