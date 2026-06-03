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

// Drag state. sourceZone: null = tray, 0 = Home, 1 = Away.
// Tap vs drag is decided by movement past DRAG_THRESHOLD before pointerup.
const DRAG_THRESHOLD = 8;
let drag = null;

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
            hint.textContent = 'Drag a player into Home or Away (or tap a chip, then tap a zone). Drag a member back to the tray to undo.';
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

// --- Drag-and-drop ---

function findPerson(chipId, sourceZone) {
    if (sourceZone == null) return trayPeople.find(p => p.id === chipId);
    return teamMembers[sourceZone].find(p => p.id === chipId);
}

function startPointerTrack(e, chipId, sourceZone) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = {
        chipId,
        sourceZone,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        ghost: null,
        hoverZone: null,
        overTray: false
    };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
}

function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.isDragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        beginDrag(e);
    }
    moveGhost(e.clientX, e.clientY);
    updateHover(e.clientX, e.clientY);
}

function beginDrag(e) {
    const person = findPerson(drag.chipId, drag.sourceZone);
    if (!person) { cleanupDrag(); return; }
    drag.isDragging = true;

    const ghost = document.createElement('div');
    ghost.className = 'team-chip team-chip-ghost';
    ghost.textContent = person.name;
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    [0, 1].forEach(idx => {
        const z = document.getElementById(`teamZone${idx}`);
        if (z) z.classList.add('drop-ready');
    });
    if (drag.sourceZone != null) {
        const tray = document.getElementById('teamTray');
        if (tray) tray.classList.add('drop-ready');
    }
}

function moveGhost(x, y) {
    if (!drag || !drag.ghost) return;
    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = y + 'px';
}

function rectContains(el, x, y) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function updateHover(x, y) {
    let hover = null;
    if (rectContains(document.getElementById('teamZone0'), x, y)) hover = 0;
    else if (rectContains(document.getElementById('teamZone1'), x, y)) hover = 1;
    const overTray = drag.sourceZone != null
        && rectContains(document.getElementById('teamTray'), x, y);

    if (hover === drag.hoverZone && overTray === drag.overTray) return;
    drag.hoverZone = hover;
    drag.overTray = overTray;
    [0, 1].forEach(idx => {
        const z = document.getElementById(`teamZone${idx}`);
        if (z) z.classList.toggle('drop-hover', hover === idx);
    });
    const tray = document.getElementById('teamTray');
    if (tray) tray.classList.toggle('drop-hover', overTray);
}

function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasDragging = drag.isDragging;
    const target = drag.hoverZone;
    const droppedOnTray = drag.overTray;
    const chipId = drag.chipId;
    const sourceZone = drag.sourceZone;
    cleanupDrag();

    if (wasDragging) {
        if (target != null && target !== sourceZone) {
            moveChip(chipId, sourceZone, target);
        } else if (droppedOnTray && sourceZone != null) {
            moveChipToTray(chipId, sourceZone);
        } else {
            render();
        }
        return;
    }
    // Tap behavior — preserved fallback.
    if (sourceZone == null) {
        selectedChipId = (selectedChipId === chipId) ? null : chipId;
        render();
    } else {
        removeFromZone(sourceZone, chipId);
    }
}

function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    cleanupDrag();
    render();
}

function cleanupDrag() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    if (drag) {
        if (drag.ghost) drag.ghost.remove();
        [0, 1].forEach(idx => {
            const z = document.getElementById(`teamZone${idx}`);
            if (z) z.classList.remove('drop-hover');
        });
        const tray = document.getElementById('teamTray');
        if (tray) tray.classList.remove('drop-hover', 'drop-ready');
    }
    drag = null;
}

function moveChip(chipId, sourceZone, targetZone) {
    let person;
    if (sourceZone == null) {
        person = trayPeople.find(p => p.id === chipId);
        if (!person) return;
        trayPeople = trayPeople.filter(p => p.id !== chipId);
    } else {
        person = teamMembers[sourceZone].find(p => p.id === chipId);
        if (!person) return;
        teamMembers[sourceZone] = teamMembers[sourceZone].filter(p => p.id !== chipId);
    }
    teamMembers[targetZone].push(person);
    selectedChipId = null;
    render();
}

function moveChipToTray(chipId, sourceZone) {
    const person = teamMembers[sourceZone].find(p => p.id === chipId);
    if (!person) return;
    teamMembers[sourceZone] = teamMembers[sourceZone].filter(p => p.id !== chipId);
    trayPeople.push(person);
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
            startPointerTrack(e, chip.dataset.chipId, null);
        });
    }

    [0, 1].forEach(idx => {
        const zone = document.getElementById(`teamZone${idx}`);
        if (!zone) return;
        zone.addEventListener('pointerdown', (e) => {
            const member = e.target.closest('[data-zone-member-id]');
            if (member) {
                e.preventDefault();
                startPointerTrack(e, member.dataset.zoneMemberId, idx);
                return;
            }
            // Empty-zone tap with a selected tray chip → assign (tap fallback).
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
