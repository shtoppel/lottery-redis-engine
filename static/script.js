// --- 1. Global Variables ---
let lastTotal = 0;
let targetCount = 0;
let myComplexTicket = [];
let isGameRunning = false;
let startTime = null;

// --- 2. Utilities ---
function addLog(msg, type = 'info') {
    const st = document.getElementById('game-status');
    if (!st) return;
    const color = type === 'error' ? '#ff4444' : (type === 'success' ? '#ffff00' : '#888');
    st.innerHTML = `<span style="color: ${color}">${msg}</span>`;
}

// Reset UI ticket display to default XX state
function resetTicketUI() {
    const container = document.getElementById('user-numbers');
    if (container) {
        container.innerHTML = '<span>XX</span>'.repeat(8);
    }
    myComplexTicket = [];
}

// --- 3. Initialization & WebSocket ---
window.onload = function() {
    console.log("🚀 System init: External Script Mode");
    resetTicketUI(); // Set placeholder XX on load
    setupWebSocket();
};

function setupWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);

        // Scanning Mode (Ticket Verification)
        if (data.status === "scanning") {
            const scanPercent = data.scan_progress || 0;
            document.getElementById('progress-bar').style.width = scanPercent + '%';
            document.getElementById('progress-percent').innerText = `SCANNING: ${scanPercent}%`;
            addLog(`[System] Scanning Redis Set... ${scanPercent}%`, 'info');
            return;
        }

        const currentTotal = parseInt(data.total) || 0;
        const rps = (lastTotal > 0 && currentTotal > lastTotal) ? (currentTotal - lastTotal) : 0;
        lastTotal = currentTotal;

        // Generation progress calculation
        if (targetCount <= 0) targetCount = currentTotal;
        const percent = targetCount > 0 ? Math.min((currentTotal / targetCount) * 100, 100) : 0;

        // Update UI stats
        document.getElementById('progress-bar').style.width = percent + '%';
        document.getElementById('progress-percent').innerText = Math.round(percent) + '%';
        document.getElementById('progress-count').innerText = `${currentTotal.toLocaleString()} / ${targetCount.toLocaleString()}`;
        document.getElementById('total-counter').innerText = currentTotal.toLocaleString();
        document.getElementById('rps-counter').innerText = rps.toLocaleString();

        // Generation completion
        if (data.status === "idle" && startTime) {
            const duration = (performance.now() - startTime) / 1000;
            document.getElementById('timer-val').innerText = duration.toFixed(3);
            document.getElementById('eff-rps').innerText = Math.round(targetCount / duration).toLocaleString();
            startTime = null;
            addLog("✅ Generation complete. Pool is ready.", "success");
        }

        // Search completion (Lottery result)
        if (isGameRunning && data.status === "finished") {
            isGameRunning = false;
            finalizeGame();
        }
    };
}

// --- 4. Generation Logic ---
async function runGenerator(type) {
    // 1. Reset UI and local ticket data immediately
    resetTicketUI();

    const countInput = document.getElementById('participants');
    const count = parseInt(countInput.value) || 100000;
    targetCount = count;
    lastTotal = 0;
    startTime = performance.now();

    addLog(`🚀 Starting ${type.toUpperCase()} generation...`, 'info');

    const endpoint = type === 'lua' ? `/generate-lua/${count}` : `/generate-participants/${count}`;
    try {
        await fetch(endpoint, { method: 'POST' });
        // The backend handles 'await r.delete("lottery:tickets")' internally
    } catch (err) {
        console.error("Generation error:", err);
        startTime = null;
    }
}
// --- 5. Ticket Logic ---
async function pickMyTicket() {
    try {
        const res = await fetch('/get-random-complex-ticket');
        const data = await res.json();

        // 1. Force save the ticket pairs to global variable
        myComplexTicket = data.ticket_pairs;

        // 2. Render to UI
        const container = document.getElementById('user-numbers');
        container.innerHTML = '';
        myComplexTicket.forEach(num => {
            const span = document.createElement('span');
            span.className = 'active';
            span.textContent = num;
            container.appendChild(span);
        });

        // 3. Debug log
        console.log("✅ TICKET LOADED TO MEMORY:", myComplexTicket);
        addLog("Ticket pulled from database.", "success");
    } catch (err) {
        addLog("Error: Database empty or server offline", "error");
    }
}

async function startFullLottery() {
    // Prevent request if no ticket is selected
    if (!myComplexTicket || myComplexTicket.length === 0) {
        return alert("Please pull a ticket from the database first!");
    }

    isGameRunning = true;
    addLog("⚡ Verifying...", "info");

    console.log("🚀 SENDING FOR VERIFICATION:", myComplexTicket);

    await fetch('/run-full-lottery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ticket: myComplexTicket })
    });
}

async function finalizeGame() {
    // Wait 100ms to ensure Redis has finished writing the result
    await new Promise(r => setTimeout(r, 100));

    try {
        const res = await fetch(`/check-result?t=${Date.now()}`);
        const data = await res.json();

        if (data.winner) {
            addLog(`🎉 JACKPOT! Ticket found in pool!`, "success");
        } else {
            const winningNumbers = data.winning_ticket ? data.winning_ticket.join(' ') : '??';
            addLog(`❌ REJECTED. Jackpot was: ${winningNumbers}`, "error");
            console.log("Server response on loss:", data);
        }
    } catch (e) {
        console.error("Finalization error:", e);
    }
}