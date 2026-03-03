// static/js/main.js
import { dom } from "./dom.js";
import { setupWebSocket } from "./ws.js";

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

  // SCENARIO BUTTONS
  dom.btnBurst5000()?.addEventListener("click", onBurst5000);
  dom.btnBurst2000()?.addEventListener("click", onBurst2000);
  dom.btnSteady()?.addEventListener("click", onSteady2000);
  dom.btnScenarioStop()?.addEventListener("click", onScenarioStop);
}

document.addEventListener("DOMContentLoaded", () => {
  bind();
  setupWebSocket();

  // initial ui
  renderTicketPairs(null);
  setTicketStatus("", "#888");
  setWinnerDisplay("NOT DRAWN", "idle");

  // periodic metrics
  setInterval(tickSystemStats, 2000);
  setInterval(tickLocustStats, 2000);
});