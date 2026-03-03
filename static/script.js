// --- 1. Global Variables ---
let lastTotal = 0;
let targetCount = 0;
let currentTicketString = "";
let isGameRunning = false;
let startTime = null;

// --- 2. Utilities ---
function addLog(msg, type = 'info') {
    const st = document.getElementById('game-status');
    if (!st) return;
    const color = type === 'error' ? '#ff4444' : (type === 'success' ? '#00d4ff' : '#888');
    st.innerHTML = `> <span style="color: ${color}">${msg}</span>`;
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// --- 3. Initialization & WebSocket ---
window.onload = function() {
    console.log("🚀 System Dashboard Ready");
    setupWebSocket();
    setInterval(updateSystemStats, 2000);
    setInterval(updateLocustMetrics, 2000);
};

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        const bar = document.getElementById('progress-bar');
        const pctEl = document.getElementById('progress-percent');

        const currentTotal = parseInt(data.total) || 0;
        const rps = (lastTotal > 0 && currentTotal > lastTotal) ? (currentTotal - lastTotal) : 0;
        lastTotal = currentTotal;

        if (targetCount > 0) {
            const percent = Math.min((currentTotal / targetCount) * 100, 100);
            if (bar) bar.style.width = percent + '%';
            if (pctEl) pctEl.innerText = `READY: ${Math.round(percent)}%`;
        }

        document.getElementById('total-counter').innerText = currentTotal.toLocaleString();
        document.getElementById('rps-counter').innerText = rps.toLocaleString();

        if (data.status === "idle" && startTime) {
            const duration = (performance.now() - startTime) / 1000;
            document.getElementById('timer-val').innerText = duration.toFixed(3);
            document.getElementById('eff-rps').innerText = Math.round(targetCount / duration).toLocaleString();
            startTime = null;
            addLog("Pool generation complete.", "success");
        }
    };
}

// --- 4. Logic Functions ---
async function runGenerator(type) {
    // ИСПРАВЛЕНИЕ: Очищаем блок результатов мультичека при старте новой генерации
    const resultDiv = document.getElementById('multi-results');
    if (resultDiv) resultDiv.innerHTML = '';

    const count = parseInt(document.getElementById('participants').value) || 100000;
    targetCount = count;
    startTime = performance.now();
    addLog(`Starting ${type.toUpperCase()} generation...`);

    try {
        await fetch(type === 'lua' ? `/generate-lua/${count}` : `/generate-participants/${count}`, { method: 'POST' });
    } catch (e) {
        addLog("Generation request failed", "error");
        startTime = null;
    }
}

async function pickMyTicket() {
    try {
        const res = await fetch('/get-random-complex-ticket');
        const data = await res.json();
        if (data.status === "ok") {
            currentTicketString = data.ticket_pairs.join('');
            document.getElementById('user-numbers').innerHTML = data.ticket_pairs.map(n => `<span>${n}</span>`).join('');
            document.getElementById('ticket-status').innerText = "Ticket pulled. Ready to verify.";
            document.getElementById('ticket-status').style.color = "#888";
        }
    } catch (e) { addLog("Error pulling ticket", "error"); }
}

async function verifySingleTicket() {
    if (!currentTicketString) return addLog("Pull a ticket first!", "error");
    try {
        const res = await fetch(`/check-result?ticket=${currentTicketString}`);
        const data = await res.json();
        const statusEl = document.getElementById('ticket-status');
        if (data.winner) {
            statusEl.innerText = "🔥 JACKPOT!";
            statusEl.style.color = "var(--neon-green)";
        } else {
            statusEl.innerText = "❌ NO MATCH";
            statusEl.style.color = "#ff4444";
        }
    } catch (e) { addLog("Check failed", "error"); }
}

async function runMultiCheck() {
    const input = document.getElementById('multi-count');
    const resultDiv = document.getElementById('multi-results');

    const genInput = document.getElementById('participants');
    const genLabel = document.getElementById('gen-label');

    const totalInDb = parseInt(document.getElementById('total-counter').innerText.replace(/[^0-9]/g, '')) || 0;

    if (totalInDb < 10000) {
        addLog("Error: Pool is too small or empty!", "error");

        resultDiv.innerHTML = `
            <div style="border: 1px solid #ff4444; padding: 12px; margin-top: 10px; background: rgba(255,68,68,0.07); border-radius: 4px;">
                <div style="color: #ff4444; font-size: 16px; font-weight: bold; margin-bottom: 8px;">❌ DATABASE ERROR</div>
                <div style="font-size: 13px; color: #eee;">
                    The ticket pool is empty or insufficient. <br>
                    Current: <span style="color:#ff4444; font-weight:bold;">${totalInDb.toLocaleString()}</span> / 10,000 min.
                </div>
                <div style="font-size: 11px; color: #888; margin-top: 8px; border-top: 1px solid rgba(255,68,68,0.3); padding-top: 5px;">
                    Redirecting focus to Pool Configuration...
                </div>
            </div>`;

        genInput.focus();
        genInput.style.borderColor = "#ff4444";
        genInput.style.boxShadow = "0 0 10px rgba(255, 68, 68, 0.5)";
        if (genLabel) genLabel.style.color = "#ff4444";

        setTimeout(() => {
            genInput.style.borderColor = "var(--neon-green)";
            genInput.style.boxShadow = "none";
            if (genLabel) genLabel.style.color = "#888";
        }, 2000);

        return;
    }

    let countVal = parseInt(input.value);
    if (isNaN(countVal) || countVal < 10000) {
        countVal = 10000;
        input.value = 10000;
        addLog("Minimum check is 10,000. Adjusted.", "info");
    }

    if (countVal > totalInDb) {
        countVal = totalInDb;
        input.value = totalInDb;
        addLog(`Adjusted to maximum: ${totalInDb.toLocaleString()}`, "info");
    }

    resultDiv.innerHTML = `<span style="color:var(--neon-blue)">> Analyzing ${countVal.toLocaleString()} cases...</span>`;

    try {
        const res = await fetch(`/run-multi-check/${countVal}`, { method: 'POST' });

        if (!res.ok) {
            const err = await res.json();
            addLog(`Server error: ${err.detail}`, "error");
            resultDiv.innerHTML = `<span style="color:#ff4444">> Request rejected: ${err.detail}</span>`;
            return;
        }

        const data = await res.json();

        resultDiv.innerHTML = `
            <div style="border: 1px solid var(--neon-blue); padding: 12px; margin-top: 10px; background: rgba(0,212,255,0.07); border-radius: 4px;">
                <div style="color: var(--neon-blue); font-size: 18px; font-weight: bold; margin-bottom: 8px;">📊 STRESS-TEST RESULTS</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
                    <div>🚀 Speed: <span style="color:#fff">${data.rps.toLocaleString()} OPS/s</span></div>
                    <div>⏱ Time: <span style="color:#fff">${data.execution_time_ms}ms</span></div>
                    <div>🏆 Winners: <span style="color:var(--neon-green); font-weight:bold;">${data.winners}</span></div>
                    <div>📦 Checked: <span style="color:#fff">${data.checked_count.toLocaleString()}</span></div>
                </div>
                <div style="font-size: 10px; color: #666; margin-top: 8px; border-top: 1px solid #333; padding-top: 5px;">
                    Redis Memory: ${data.used_memory || 'N/A'}
                </div>
            </div>`;

        addLog(`Multi-check completed for ${countVal.toLocaleString()} tickets.`, "success");

    } catch (e) {
        addLog("Connection failed", "error");
        resultDiv.innerHTML = `<span style="color:red">Server unreachable</span>`;
    }
}

// --- 5. Monitoring ---
async function updateSystemStats() {
    try {
        const res = await fetch('/system-stats');
        const data = await res.json();
        document.getElementById('redis-mem-val').innerText = data.redis_mem;
        const sysEl = document.getElementById('sys-mem-val');
        sysEl.innerText = `${formatBytes(data.sys_mem_bytes)} / ${formatBytes(data.sys_total_bytes, 0)}`;
    } catch (e) {}
}

async function updateLocustMetrics() {
    try {
        const res = await fetch('/locust-stats');
        const data = await res.json();

        // 1. Обновляем основные плашки
        document.getElementById('external-rps').innerText = Math.floor(data.rps || 0).toLocaleString();
        document.getElementById('p95-latency').innerText = Math.round(data.p95 || 0) + " ms";
        document.getElementById('fail-rate').innerText = ((data.fail_ratio || 0) * 100).toFixed(1) + "%";

        // 2. Находим таблицу
        const tbody = document.getElementById('stats-body');
        if (!tbody) return;

        if (data.full_stats && data.full_stats.length > 0) {
            tbody.innerHTML = data.full_stats.map(s => {
                // Locust API использует специфичные имена для перцентилей
                const failColor = s.num_failures > 0 ? '#ff4444' : '#888';

                return `
                    <tr style="border-bottom: 1px solid #222; font-size: 10px;">
                        <td style="text-align:left; color:var(--neon-blue); padding: 5px 0;">${s.name}</td>
                        <td>${s.num_requests}</td>
                        <td style="color:${failColor}">${s.num_failures}</td>
                        <td>${Math.round(s.median_response_time || 0)}</td>
                        <td>${Math.round(s.ninetieth_response_time || 0)}</td> <td>${Math.round(s.ninety_ninth_response_time || 0)}</td>
                        <td>${Math.round(s.avg_response_time || 0)}</td>
                        <td>${Math.round(s.min_response_time || 0)}</td>
                        <td>${Math.round(s.max_response_time || 0)}</td>
                        <td style="color:var(--neon-green)">${(s.current_rps || 0).toFixed(1)}</td>
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        console.error("Metrics render error:", e);
    }
}

async function startLocust() {
    const u = document.getElementById('locust-users').value;
    const s = document.getElementById('locust-spawn').value;
    await fetch(`/locust/start?user_count=${u}&spawn_rate=${s}`, { method: 'POST' });
}

async function stopLocust() {
    await fetch('/locust/stop', { method: 'POST' });
}

async function runOfficialDraw() {
    const btn = document.getElementById('draw-btn');
    const display = document.getElementById('winner-display');

    // Блокируем кнопку, чтобы не спамили
    btn.disabled = true;
    btn.style.opacity = '0.5';
    addLog("Initiating official draw via Lua...", "info");

    try {
        const res = await fetch('/admin/draw', { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            // Разбиваем строку по 2 символа для красивого отображения
            const formatted = data.winner.match(/.{1,2}/g).join(' ');
            display.innerText = formatted;
            display.style.color = "var(--neon-green)";
            display.style.textShadow = "0 0 15px var(--neon-green)";
            addLog(`Draw successful! Winning ticket: ${data.winner}`, "success");
        } else {
            addLog(`Error: ${data.detail}`, "error");
            display.innerText = "FAILED";
        }
    } catch (e) {
        addLog("Server connection lost", "error");
        display.innerText = "ERROR";
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const drawBtn = document.getElementById("draw-btn");
    if (drawBtn) {
        drawBtn.addEventListener("click", runOfficialDraw);
    }
});

async function runOfficialDraw() {
    const display = document.getElementById("winner-display");

    display.innerText = "DRAWING...";
    display.style.color = "#00d4ff";

    try {
        const res = await fetch("/admin/draw", { method: "POST" });
        const data = await res.json();

        if (!res.ok) {
            display.innerText = "ERROR";
            display.style.color = "#ff4444";
            console.error(data.detail);
            return;
        }

        const winner = data.winner;

        // split into 2-digit pairs
        const formatted = winner.match(/.{1,2}/g).join(" ");

        display.innerText = formatted;
        display.style.color = "var(--neon-green)";

    } catch (err) {
        display.innerText = "SERVER ERROR";
        display.style.color = "#ff4444";
        console.error(err);
    }
}