/* ============================================
   121 Game Mode

   Standard: each leg starts at game121.startingScore. Player must
   check out within game121.dartsPerLeg. On a win, the next leg starts
   higher (+5). On a loss, the next leg's start drops by legLossPenalty
   (configurable, default 1), floored at 121.

   Total legs: 5, 10, 25, or 'infinite' (play until cancelled).

   Solo / co-op (game121.soloMode): one team plays together. No penalty
   on loss — starting score never decreases. Goal is to beat your best
   start.

   Match summary tracks per-player:
   - Legs won (and team total)
   - Round score buckets: 180, 160+, 140+, 120+, 100+, 60+
   - Highest leg-start reached
   These also feed a local leaderboard (blakeout_121_leaderboard) keyed
   by player name + roster email when available.
   ============================================ */

import { game } from './state.js';
import { showModal, hideModal, showWinner, updateUndoRedoButtons } from './ui.js';

const LEADERBOARD_KEY = 'blakeout_121_leaderboard';
const ROUND_BUCKETS = [180, 160, 140, 120, 100, 60];

// Called from x01.js submitScore after a successful round commit. Logs the
// round score against the active player so the match summary can tally
// 180s, ton-pluses, etc.
export function record121Round(score) {
    const g121 = game.game121;
    if (!g121) return;
    g121.roundsByPlayer = g121.roundsByPlayer || {};
    const pi = game.currentPlayer;
    if (!g121.roundsByPlayer[pi]) {
        g121.roundsByPlayer[pi] = { 180: 0, 160: 0, 140: 0, 120: 0, 100: 0, 60: 0 };
    }
    const buckets = g121.roundsByPlayer[pi];
    if (score >= 180) buckets[180]++;
    else if (score >= 160) buckets[160]++;
    else if (score >= 140) buckets[140]++;
    else if (score >= 120) buckets[120]++;
    else if (score >= 100) buckets[100]++;
    else if (score >= 60) buckets[60]++;
}

export function handle121LegEnd(won, checkoutScore = 0) {
    const g121 = game.game121;
    const playerIndex = game.currentPlayer;

    g121.legResults.push({
        winner: won ? playerIndex : -1,
        checkout: checkoutScore,
        startingScore: g121.startingScore,
        dartsUsed: g121.dartsThrown
    });

    g121.highestStart = Math.max(g121.highestStart || g121.startingScore, g121.startingScore);

    if (won) {
        g121.legsWon[playerIndex]++;
        g121.startingScore += 5;
    } else if (!g121.soloMode) {
        const penalty = g121.legLossPenalty || 1;
        g121.startingScore = Math.max(121, g121.startingScore - penalty);
    }
    // soloMode loss: startingScore unchanged.

    const totalLegs = g121.totalLegs;
    const isInfinite = totalLegs === 'infinite' || totalLegs === Infinity;
    if (!isInfinite && g121.currentLeg >= totalLegs) {
        show121MatchSummary();
        return;
    }

    g121.currentLeg++;
    g121.dartsThrown = 0;
    game.players.forEach(p => {
        p.score = g121.startingScore;
        p.history = [];
    });

    const indicator = document.getElementById('finishIndicator');
    if (won) {
        indicator.textContent = `LEG WON! Next: ${g121.startingScore}`;
        indicator.style.color = 'var(--color-pending)';
    } else if (g121.soloMode) {
        indicator.textContent = `Leg done. Next: ${g121.startingScore} (solo — no penalty)`;
        indicator.style.color = 'var(--color-undo)';
    } else {
        indicator.textContent = `Leg lost. Next: ${g121.startingScore}`;
        indicator.style.color = 'var(--color-undo)';
    }

    setTimeout(() => {
        game.currentInput = '';
        const inp = document.getElementById('inputDisplay');
        if (inp) inp.textContent = '0';
        game.completedRounds = 0;
        document.dispatchEvent(new CustomEvent('game121LegReady'));
    }, 2000);
}

// --- Match summary + leaderboard ---

function show121MatchSummary() {
    const g121 = game.game121;
    const body = document.getElementById('game121SummaryBody');
    if (!body) {
        // Fallback — old modal didn't exist, fall through to generic winner
        const winners = game.players.filter((p, i) => g121.legsWon[i] === Math.max(...g121.legsWon)).map(p => p.name);
        showWinner(winners.join(' & '), false, true);
        return;
    }

    body.innerHTML = renderSummaryHtml();
    // Record into the leaderboard, mark any new records, then render the board
    const records = updateLeaderboard();
    appendLeaderboardSection(body, records);

    showModal('game121SummaryModal');
}

function renderSummaryHtml() {
    const g121 = game.game121;

    // Per-player rows
    const playerHeaderCells = game.players.map(p => `<th>${escapeHtml(p.name)}</th>`).join('');
    const totalLegs = g121.totalLegs === 'infinite' ? '∞' : g121.totalLegs;
    const legsWonCells = game.players.map((p, i) =>
        `<td class="num">${g121.legsWon[i] || 0}</td>`
    ).join('');

    const bucketRows = ROUND_BUCKETS.map(bucket => {
        const cells = game.players.map((p, i) => {
            const counts = (g121.roundsByPlayer || {})[i] || {};
            const n = counts[bucket] || 0;
            return `<td class="num">${n}</td>`;
        }).join('');
        const label = bucket === 180 ? '180s'
                   : bucket === 60 ? '60+'
                   : `${bucket}+`;
        return `<tr><td>${label}</td>${cells}</tr>`;
    }).join('');

    const teamTotalLegs = (g121.legsWon || []).reduce((s, n) => s + (n || 0), 0);
    const highestStart = g121.highestStart || g121.startingScore;
    const mode = g121.soloMode ? 'Solo / co-op' : 'Standard';

    return `
        <div class="summary-section-label">Match (${mode})</div>
        <table class="summary-table">
            <thead><tr><th>Stat</th>${playerHeaderCells}</tr></thead>
            <tbody>
                <tr><td>Legs won</td>${legsWonCells}</tr>
                ${bucketRows}
            </tbody>
        </table>
        <div class="summary-section-label">Match totals</div>
        <div style="display:flex;justify-content:space-between;color:var(--color-text);padding:var(--space-xs) var(--space-md);">
            <span>Legs played</span>
            <span>${g121.legResults.length} / ${totalLegs}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--color-text);padding:var(--space-xs) var(--space-md);">
            <span>Team legs won</span>
            <span>${teamTotalLegs}</span>
        </div>
        <div style="display:flex;justify-content:space-between;color:var(--color-text);padding:var(--space-xs) var(--space-md);">
            <span>Highest leg-start</span>
            <span>${highestStart}</span>
        </div>
    `;
}

function appendLeaderboardSection(body, records) {
    const sect = document.createElement('div');
    sect.className = 'summary-section-label';
    sect.textContent = 'All-time 121 leaderboard (this device)';
    body.appendChild(sect);
    if (!records.length) {
        const empty = document.createElement('div');
        empty.style.color = 'var(--color-text-muted)';
        empty.style.padding = 'var(--space-xs) var(--space-md)';
        empty.textContent = 'No records yet.';
        body.appendChild(empty);
        return;
    }
    records.slice(0, 10).forEach(rec => {
        const row = document.createElement('div');
        row.className = 'summary-leaderboard-row' + (rec.isNew ? ' new-record' : '');
        row.innerHTML = `
            <span>${escapeHtml(rec.name)}${rec.isNew ? ' &middot; NEW' : ''}</span>
            <span>Highest start ${rec.highestStart} &middot; ${rec.legsWon} wins</span>
        `;
        body.appendChild(row);
    });
}

function loadLeaderboard() {
    try {
        const raw = localStorage.getItem(LEADERBOARD_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function saveLeaderboard(rows) {
    try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(rows)); } catch {}
}

// Push this match's players into the leaderboard. A player's row is
// keyed by rosterEmail when available, otherwise by lowercased name. We
// track their best-ever leg-start across all 121 games on this device.
// Returns the updated, sorted leaderboard with `isNew` flags on rows that
// were created or improved by this match.
function updateLeaderboard() {
    const g121 = game.game121;
    const rows = loadLeaderboard();
    const byKey = new Map(rows.map(r => [r.key, r]));
    const matchHigh = g121.highestStart || g121.startingScore;

    game.players.forEach((p, i) => {
        const key = (p.rosterEmail || ('name:' + (p.name || '').trim().toLowerCase())) || '';
        if (!key) return;
        const existing = byKey.get(key);
        const myWins = g121.legsWon[i] || 0;
        if (!existing) {
            byKey.set(key, {
                key,
                name: p.name,
                highestStart: matchHigh,
                legsWon: myWins,
                games: 1,
                isNew: true
            });
        } else {
            existing.games = (existing.games || 0) + 1;
            existing.legsWon = (existing.legsWon || 0) + myWins;
            if (matchHigh > existing.highestStart) {
                existing.highestStart = matchHigh;
                existing.isNew = true;
            } else {
                existing.isNew = false;
            }
            existing.name = p.name;  // keep the latest spelling
        }
    });

    const merged = Array.from(byKey.values())
        .sort((a, b) => (b.highestStart - a.highestStart) || (b.legsWon - a.legsWon));

    // Persist a non-flagged copy.
    saveLeaderboard(merged.map(r => ({ ...r, isNew: false })));

    return merged;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Modal buttons (wired by app.js once on init) ---

export function init121SummaryControls(onPlayAgain, onDone) {
    const again = document.getElementById('game121SummaryAgainBtn');
    if (again) again.addEventListener('click', () => {
        hideModal('game121SummaryModal');
        onPlayAgain();
    });
    const done = document.getElementById('game121SummaryDoneBtn');
    if (done) done.addEventListener('click', () => {
        hideModal('game121SummaryModal');
        onDone();
    });
}

// Export for explicit calls from outside (kept for app.js compatibility).
export { show121MatchSummary };
