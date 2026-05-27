/* ============================================
   Teams — Phase 2.
   - Team-builder screen (tap-to-assign chips into Home/Away zones)
   - Rotation helpers (currentThrower, advanceRotation)

   When team mode is on, game.players[] still has exactly two entries
   (Home and Away) for the scoring engine. The actual humans live in
   game.teams[i].members and rotate one whole turn at a time, alternating
   teams. So with Home=[Anna,Bob] and Away=[Dan,Eve]:
     turn 1: Home → Anna
     turn 2: Away → Dan
     turn 3: Home → Bob
     turn 4: Away → Eve
     turn 5: Home → Anna  (wraps)
     ...
   ============================================ */

import { game } from './state.js';
import { getRosterCache, findPlayerByName } from './firebase.js';

let onTeamsConfirmed = null;
let trayPeople = [];        // chips not yet assigned: [{name, rosterEmail, id}]
let teamMembers = [[], []]; // 0 = Home, 1 = Away
let selectedChipId = null;  // tap-to-assign source
let controlsInitialized = false;

export function setTeamsConfirmedCallback(fn) {
    onTeamsConfirmed = fn;
}

/**
 * Called by setup.js when Team Mode is on and the user taps Start Game.
 * Pre-fills the tray with the current roster; user adds ad-hoc names as needed.
 */
export function showTeamBuilder() {
    const roster = getRosterCache();
    trayPeople = roster.map(p => ({
        name: p.name,
        rosterEmail: p.email,
        id: makeId()
    }));
    teamMembers = [[], []];
    selectedChipId = null;
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('teamBuilderScreen').style.display = 'flex';
    render();
}

// --- Rotation helpers (used by game modules in commit 3) ---

export function currentThrower(teamIndex) {
    const t = game.teams && game.teams[teamIndex];
    if (!t || !t.members || !t.members.length) return null;
    return t.members[t.rotationIndex % t.members.length];
}

export function advanceRotation(teamIndex) {
    const t = game.teams && game.teams[teamIndex];
    if (!t || !t.members || !t.members.length) return;
    t.rotationIndex = (t.rotationIndex + 1) % t.members.length;
}

// --- Internal ---

function makeId() {
    return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}

function render() {
    const tray = document.getElementById('teamTray');
    if (!tray) return;

    if (trayPeople.length === 0) {
        tray.innerHTML = '<div class="team-tray-empty">No unassigned players. Add one below or tap a zone member to put them back.</div>';
    } else {
        tray.innerHTML = trayPeople.map(p => `
            <button class="team-chip${selectedChipId === p.id ? ' selected' : ''}" data-chip-id="${p.id}">
                ${escapeHtml(p.name)}
            </button>
        `).join('');
    }

    [0, 1].forEach(idx => {
        const mems = document.getElementById(`teamZone${idx}Members`);
        if (!mems) return;
        if (teamMembers[idx].length === 0) {
            mems.innerHTML = '<div class="team-zone-empty">Empty</div>';
        } else {
            mems.innerHTML = teamMembers[idx].map((p, order) => `
                <button class="team-chip in-zone" data-zone-member-id="${p.id}" data-zone-idx="${idx}">
                    <span class="team-chip-order">${order + 1}.</span> ${escapeHtml(p.name)}
                </button>
            `).join('');
        }
        const zone = document.getElementById(`teamZone${idx}`);
        if (zone) zone.classList.toggle('drop-ready', !!selectedChipId);
    });

    const ready = teamMembers[0].length > 0 && teamMembers[1].length > 0;
    const startBtn = document.getElementById('teamStartMatchBtn');
    if (startBtn) startBtn.disabled = !ready;

    const hint = document.getElementById('teamBuilderHint');
    if (hint) {
        if (selectedChipId) {
            hint.textContent = 'Now tap Home or Away.';
        } else if (ready) {
            hint.textContent = `${teamMembers[0].length} vs ${teamMembers[1].length}. Tap Start Match — order shown is throwing order.`;
        } else {
            hint.textContent = 'Tap a player chip, then tap Home or Away. Tap a member to remove them.';
        }
    }
}

function assignSelectedTo(zoneIdx) {
    if (!selectedChipId) return;
    const person = trayPeople.find(p => p.id === selectedChipId);
    if (!person) return;
    trayPeople = trayPeople.filter(p => p.id !== selectedChipId);
    teamMembers[zoneIdx].push(person);
    selectedChipId = null;
    render();
}

function removeFromZone(zoneIdx, memberId) {
    const removed = teamMembers[zoneIdx].find(p => p.id === memberId);
    teamMembers[zoneIdx] = teamMembers[zoneIdx].filter(p => p.id !== memberId);
    if (removed) trayPeople.push(removed);
    selectedChipId = null;
    render();
}

function confirmTeams() {
    if (!teamMembers[0].length || !teamMembers[1].length) return;
    const teams = [
        { name: 'Home', members: teamMembers[0].map(stripId), rotationIndex: 0 },
        { name: 'Away', members: teamMembers[1].map(stripId), rotationIndex: 0 }
    ];
    if (onTeamsConfirmed) onTeamsConfirmed(teams);
}

function stripId(p) {
    return { name: p.name, rosterEmail: p.rosterEmail || null };
}

export function initTeamBuilder() {
    if (controlsInitialized) return;
    controlsInitialized = true;

    const tray = document.getElementById('teamTray');
    if (tray) {
        tray.addEventListener('pointerdown', (e) => {
            const chip = e.target.closest('[data-chip-id]');
            if (!chip) return;
            e.preventDefault();
            const id = chip.dataset.chipId;
            selectedChipId = (selectedChipId === id) ? null : id;
            render();
        });
    }

    [0, 1].forEach(idx => {
        const zone = document.getElementById(`teamZone${idx}`);
        if (!zone) return;
        zone.addEventListener('pointerdown', (e) => {
            const member = e.target.closest('[data-zone-member-id]');
            if (member) {
                e.preventDefault();
                removeFromZone(idx, member.dataset.zoneMemberId);
                return;
            }
            if (!selectedChipId) return;
            e.preventDefault();
            assignSelectedTo(idx);
        });
    });

    const addBtn = document.getElementById('teamAddBtn');
    const addInput = document.getElementById('teamAddName');
    const submitAdd = () => {
        const name = (addInput?.value || '').trim();
        if (!name) return;
        // If the name matches a roster entry, carry the email through.
        const match = findPlayerByName ? findPlayerByName(name) : null;
        trayPeople.push({
            name,
            rosterEmail: match ? match.email : null,
            id: makeId()
        });
        if (addInput) addInput.value = '';
        render();
    };
    if (addBtn) addBtn.addEventListener('click', submitAdd);
    if (addInput) addInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitAdd(); });

    const startBtn = document.getElementById('teamStartMatchBtn');
    if (startBtn) startBtn.addEventListener('click', confirmTeams);

    const backBtn = document.getElementById('teamBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => {
        document.getElementById('teamBuilderScreen').style.display = 'none';
        document.getElementById('setupScreen').style.display = 'flex';
    });
}
