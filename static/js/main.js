// static/js/main.js
import { dom } from "./dom.js";
import { setupWebSocket } from "./ws.js";
import { loadComponent } from "./component_loader.js";

import {
  onGenerate,
  onAdminDraw,
  onPullTicket,
  onVerifyTicket,
  onMultiCheck,
  onLocustStart,
  onLocustStop,
  tickSystemStats,
  tickLocustStats,

  // Run Demo
  onRunDemo,

  // Race / tabs
  initControlTabs,
  onRaceRun,
  onRaceReset,

  // UI scenarios
  onBurst5000,
  onBurst2000,
  onSteady2000,
  onScenarioStop,
} from "./controllers.js";

import { renderTicketPairs, setTicketStatus, setWinnerDisplay } from "./ui.js";

function bind() {
  // generation
  dom.btnGenPython()?.addEventListener("click", () => onGenerate("python"));
  dom.btnGenLua()?.addEventListener("click", () => onGenerate("lua"));

  // demo
  dom.btnRunDemo()?.addEventListener("click", onRunDemo);

  // admin draw
  dom.btnDraw()?.addEventListener("click", onAdminDraw);

  // ticket flow
  dom.btnPull()?.addEventListener("click", onPullTicket);
  dom.btnVerify()?.addEventListener("click", onVerifyTicket);

  // multi-check
  dom.btnMulti()?.addEventListener("click", onMultiCheck);

  // locust manual control
  dom.btnLocustStart()?.addEventListener("click", onLocustStart);
  dom.btnLocustStop()?.addEventListener("click", onLocustStop);

  // race
  dom.btnRaceRun?.()?.addEventListener("click", onRaceRun);
  dom.btnRaceReset?.()?.addEventListener("click", onRaceReset);

  // scenario buttons
  dom.btnBurst5000()?.addEventListener("click", onBurst5000);
  dom.btnBurst2000()?.addEventListener("click", onBurst2000);
  dom.btnSteady()?.addEventListener("click", onSteady2000);
  dom.btnScenarioStop()?.addEventListener("click", onScenarioStop);

  // tabs
  initControlTabs?.();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent("control-panel-slot", "/static/components/control_panel.html");

  bind();
  setupWebSocket();

  renderTicketPairs(null);
  setTicketStatus("", "#888");
  setWinnerDisplay("NOT DRAWN", "idle");

  setInterval(tickSystemStats, 2000);
  setInterval(tickLocustStats, 2000);
});