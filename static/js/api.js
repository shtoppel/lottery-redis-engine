// static/js/api.js
const BASE_URL = "";

async function runDemo() {
  const res = await fetch("/demo/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function fetchJson(pathOrUrl, options = {}) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;

  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });

    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json")
      ? await res.json().catch(() => ({}))
      : { raw: await res.text().catch(() => "") };

    return { res, data };
  } catch (err) {
    console.error("[fetchJson] network error:", url, err);
    return {
      res: { ok: false, status: 0, statusText: "NETWORK_ERROR" },
      data: { detail: "Network error / backend unreachable", error: String(err) },
    };
  }
}

export const api = {
  runDemo,

  generate: (type, count) => {
    const url = type === "lua" ? `/generate-lua/${count}` : `/generate-participants/${count}`;
    return fetchJson(url, { method: "POST" });
  },

  adminDraw: () => fetchJson("/admin/draw", { method: "POST" }),
  pullTicket: () => fetchJson("/get-random-complex-ticket", { method: "GET" }),
  checkTicket: (ticketId) => fetchJson(`/check/${encodeURIComponent(ticketId)}`, { method: "GET" }),
  multiCheck: (count) => fetchJson(`/run-multi-check/${count}`, { method: "POST" }),

  systemStats: () => fetchJson("/system-stats", { method: "GET" }),
  locustStats: () => fetchJson("/locust-stats", { method: "GET" }),

  locustStart: (users, spawn, scenario) =>
    fetchJson(`/locust/start`, {
      method: "POST",
      body: JSON.stringify({
        user_count: users,
        spawn_rate: spawn,
        scenario: scenario || "realistic",
      }),
    }),

  locustStop: () => fetchJson("/locust/stop", { method: "POST" }),

  raceRun: (mode, concurrency = 200, delayMs = 10) =>
    fetchJson(
      `/race/run?mode=${encodeURIComponent(mode)}&concurrency=${concurrency}&delay_ms=${delayMs}`,
      { method: "POST" }
    ),

  raceReset: () => fetchJson("/race/reset", { method: "POST" }),

  latestDemoReport: () => fetchJson("/demo/latest-report", { method: "GET" }),

  clearDatabase: () => fetchJson("/clear-database", { method: "POST" }),
};