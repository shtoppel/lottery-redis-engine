import { state } from "./state.js";
import { renderTopStats, renderProgress, renderGenerationBenchmark, uiLog } from "./ui.js";

export function setupWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => console.log("[WS] connected");
  ws.onclose = () => console.log("[WS] closed");
  ws.onerror = (e) => console.log("[WS] error", e);

  ws.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }

    const total = parseInt(data.total || 0, 10);
    const status = data.status || "idle";

    const rps = (state.lastTotal > 0 && total > state.lastTotal)
      ? (total - state.lastTotal)
      : 0;

    state.lastTotal = total;
    renderTopStats(total, rps);

    if (state.targetCount > 0) {
      const percent = Math.min((total / state.targetCount) * 100, 100);
      renderProgress(percent);
    }

    if (status === "idle" && state.startTime) {
      const seconds = (performance.now() - state.startTime) / 1000;
      state.startTime = null;

      const effRps = state.targetCount > 0 && seconds > 0
        ? (state.targetCount / seconds)
        : 0;

      renderGenerationBenchmark(seconds, effRps);
      uiLog("Pool generation complete.", "success");
    }
  };
}