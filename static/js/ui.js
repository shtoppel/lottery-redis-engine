// static/js/ui.js
import { dom } from "./dom.js";

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatBytes(bytes, decimals = 2) {
  if (!bytes || isNaN(bytes) || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export function uiLog(msg, type = "info") {
  const el = dom.gameStatus();
  if (!el) return;
  const color =
    type === "error"
      ? "#ff4444"
      : type === "success"
      ? "#00d4ff"
      : type === "warning"
      ? "#ffb347"
      : "#888";

  el.innerHTML = `> <span style="color:${color}">${escapeHtml(msg)}</span>`;
}

export function setWinnerDisplay(text, mode = "idle") {
  const el = dom.winnerDisplay();
  if (!el) return;

  el.textContent = text;

  if (mode === "ok") {
    el.style.color = "var(--neon-green)";
    el.style.textShadow = "0 0 15px var(--neon-green)";
  } else if (mode === "loading") {
    el.style.color = "var(--neon-blue)";
    el.style.textShadow = "0 0 10px var(--neon-blue)";
  } else if (mode === "error") {
    el.style.color = "#ff4444";
    el.style.textShadow = "none";
  } else {
    el.style.color = "#888";
    el.style.textShadow = "none";
  }
}

export function renderTicketPairs(pairs) {
  const el = dom.userNumbers();
  if (!el) return;

  if (!pairs || pairs.length !== 8) {
    el.innerHTML = `<span>XX</span>`.repeat(8);
    return;
  }

  el.innerHTML = pairs.map((n) => `<span>${escapeHtml(n)}</span>`).join("");
}

export function setTicketStatus(text, color = "#888") {
  const el = dom.ticketStatus();
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

export function renderTopStats(total, rps) {
  if (dom.totalCounter()) {
    dom.totalCounter().textContent = Number(total || 0).toLocaleString();
  }
  if (dom.rpsCounter()) {
    dom.rpsCounter().textContent = Number(rps || 0).toLocaleString();
  }
}

export function renderProgress(percent) {
  const bar = dom.progressBar();
  const pctEl = dom.progressPercent();
  if (bar) bar.style.width = `${percent}%`;
  if (pctEl) pctEl.textContent = `${Math.round(percent)}%`;
}

export function renderGenerationBenchmark(seconds, effRps) {
  const t = dom.timerVal();
  const r = dom.effRps();
  if (t) t.textContent = seconds.toFixed(3);
  if (r) r.textContent = Math.round(effRps).toLocaleString();
}

export function renderMultiResult(data) {
  const el = dom.multiResults();
  if (!el) return;

  el.innerHTML = `
    <div style="border:1px solid var(--neon-blue); padding:12px; margin-top:10px; background:rgba(0,212,255,0.07); border-radius:4px;">
      <div style="color:var(--neon-blue); font-size:18px; font-weight:bold; margin-bottom:8px;">STRESS TEST RESULTS</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px;">
        <div>Speed: <span style="color:#fff">${Number(data.rps || 0).toLocaleString()} OPS/s</span></div>
        <div>Time: <span style="color:#fff">${data.execution_time_ms ?? "?"} ms</span></div>
        <div>Winners: <span style="color:var(--neon-green); font-weight:bold;">${data.winners ?? 0}</span></div>
        <div>Checked: <span style="color:#fff">${Number(data.checked_count || 0).toLocaleString()}</span></div>
      </div>
      <div style="font-size:10px; color:#666; margin-top:8px; border-top:1px solid #333; padding-top:5px;">
        Redis Memory: ${escapeHtml(data.used_memory || "N/A")}
      </div>
    </div>
  `;
}

export function renderSystemStats(redisMemHuman, sysUsedBytes, sysTotalBytes) {
  if (dom.redisMemVal()) dom.redisMemVal().textContent = redisMemHuman || "0B";
  if (dom.sysMemVal()) {
    dom.sysMemVal().textContent = `${formatBytes(sysUsedBytes)} / ${formatBytes(
      sysTotalBytes,
      0
    )}`;
  }
}

// ----------------------
// Locust stats rendering
// ----------------------

function pick(obj, keys, fallback = 0) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}

function pickPercentile(obj, pStr, fallback = 0) {
  const rp = obj?.response_time_percentiles;
  if (rp && typeof rp === "object") {
    const v = rp[pStr] ?? rp[Number(pStr)] ?? rp[String(pStr)];
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}

export function renderLocustStats(data) {
  if (dom.externalRps()) {
    dom.externalRps().textContent = Math.floor(data?.rps || 0).toLocaleString();
  }

  if (dom.p95Latency()) {
    dom.p95Latency().textContent = `${Math.round(data?.p95 || 0)} ms`;
  }

  if (dom.failRate()) {
    dom.failRate().textContent = `${(((data?.fail_ratio || 0) * 100) || 0).toFixed(1)}%`;
  }

  const tbody = dom.statsBody();
  if (!tbody) return;

  const arr = Array.isArray(data?.full_stats) ? data.full_stats : [];
  if (!arr.length) {
    tbody.innerHTML = "";
    return;
  }

  tbody.innerHTML = arr
    .map((s) => {
      const name = s?.name || "";
      const method = s?.method || "";
      const label = method ? `${method} ${name}` : name;

      const reqs = pick(s, ["num_requests"], 0);
      const fails = pick(s, ["num_failures"], 0);

      const median = pick(s, ["median_response_time"], 0);
      const avg = pick(s, ["avg_response_time"], 0);
      const min = pick(s, ["min_response_time"], 0);
      const max = pick(s, ["max_response_time"], 0);

      const p95 =
        pick(
          s,
          [
            "ninetieth_response_time",
            "response_time_percentile_95",
            "current_response_time_percentile_95",
          ],
          null
        ) ??
        pickPercentile(s, "0.95", 0) ??
        0;

      const p99 =
        pick(
          s,
          [
            "ninety_ninth_response_time",
            "response_time_percentile_99",
            "current_response_time_percentile_99",
          ],
          null
        ) ??
        pickPercentile(s, "0.99", 0) ??
        0;

      const rps = pick(s, ["current_rps"], 0);
      const failColor = (fails || 0) > 0 ? "#ff4444" : "#888";

      return `
        <tr style="border-bottom:1px solid #222; font-size:10px;">
          <td style="text-align:left; color:var(--neon-blue); padding:5px 0;">${escapeHtml(
            label
          )}</td>
          <td>${Math.round(reqs)}</td>
          <td style="color:${failColor}">${Math.round(fails)}</td>
          <td>${Math.round(median)}</td>
          <td>${Math.round(p95)}</td>
          <td>${Math.round(p99)}</td>
          <td>${Math.round(avg)}</td>
          <td>${Math.round(min)}</td>
          <td>${Math.round(max)}</td>
          <td style="color:var(--neon-green)">${Number(rps || 0).toFixed(1)}</td>
        </tr>
      `;
    })
    .join("");
}

// ----------------------
// Race stats rendering
// ----------------------

export function renderRaceStats(data) {
  if (dom.raceSuccessCount()) {
    dom.raceSuccessCount().textContent = String(
      data?.stored_success_count ?? data?.success_count ?? 0
    );
  }

  if (dom.raceDuplicateBug()) {
    const isBroken = (data?.consistency || "").toUpperCase() === "BROKEN" || !!data?.duplicate_bug;
    dom.raceDuplicateBug().textContent = isBroken ? "YES" : "NO";
    dom.raceDuplicateBug().style.color = isBroken
      ? "#ff4444"
      : "var(--neon-green)";
  }

  if (dom.raceDuration()) {
    dom.raceDuration().textContent = `${data?.duration_ms ?? 0} ms`;
  }

  if (dom.raceResult()) {
    const timeline = Array.isArray(data?.race_timeline) ? data.race_timeline : [];
    const timelineLines = timeline.slice(0, 12).map((e) => {
      const ms = Number(e?.latency_ms ?? 0).toFixed(2);
      return `${ms} ms  ${e?.user ?? "-"}  ${String(e?.status ?? "unknown")}`;
    });

    dom.raceResult().textContent =
      `Mode: ${data?.mode ?? "-"}
` +
      `Concurrency: ${data?.concurrency ?? "-"}
` +
      `Final claimed by: ${data?.final_claimed_by ?? "-"}
` +
      `Success count: ${data?.stored_success_count ?? data?.success_count ?? 0}
` +
      `Duplicate bug: ${data?.duplicate_bug ? "YES" : "NO"}
` +
      `Winners: ${(data?.winners || []).join(", ") || "-"}

` +
      `Race timeline:
` +
      `${timelineLines.join("\n") || "No events"}`;
  }
}



function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function renderSummaryTerminal(lines, speed = 220) {
  const el = document.getElementById("summary-terminal");
  if (!el) return;

  el.textContent = "";

  for (const line of lines) {
    el.textContent += `> ${line}\n`;
    el.scrollTop = el.scrollHeight;
    await sleep(speed);
  }
}

export function clearSummaryTerminal() {
  const el = document.getElementById("summary-terminal");
  if (!el) return;
  el.textContent = "> idle...";
}

export function appendSummaryLine(line) {
  const el = document.getElementById("summary-terminal");
  if (!el) return;

  if (el.textContent.trim() === "> idle...") {
    el.textContent = "";
  }

  el.textContent += `> ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

//Ticket Animation
function randomPair() {
  return String(Math.floor(Math.random() * 100)).padStart(2, "0");
}

export function renderRevealFrame(pairs, revealed) {
  const el = document.getElementById("winner-display");
  if (!el) return;

  const html = pairs
    .map((p, i) => {
      if (i < revealed) {
        return `<span style="color:var(--neon-green); text-shadow:0 0 10px var(--neon-green)">${p}</span>`;
      }

      return `<span style="color:#ff4444">${randomPair()}</span>`;
    })
    .join(" ");

  el.innerHTML = html;
}

export function showHiddenWinner(slotCount = 8) {
  const el = document.getElementById("winner-display");
  if (!el) return;

  el.innerHTML = Array.from({ length: slotCount }, () => {
    return `<span style="color:var(--neon-green); opacity:0.35; text-shadow:0 0 8px var(--neon-green)">XX</span>`;
  }).join(" ");

  el.style.textShadow = "none";
}