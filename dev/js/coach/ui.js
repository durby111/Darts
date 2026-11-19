// 501 post-game coach — winner-dialog presentation. DEV only.
// Read-only: never mutates the game, saved statistics, or storage.
import { game } from '../state.js';
import { build501Recap } from './recap.js';

const PANEL_ID = 'coachRecap';
let selected = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function ensureStyles() {
    if (document.getElementById('coachStyles')) return;
    const link = el('link');
    link.id = 'coachStyles';
    link.rel = 'stylesheet';
    link.href = new URL('../../css/coach.css', import.meta.url).href;
    document.head.append(link);
}

function stat(list, label, value) {
    const row = el('div', 'coach-stat');
    row.append(el('dt', '', label), el('dd', '', String(value)));
    list.append(row);
}

function renderSide(host, side) {
    host.replaceChildren();
    if (!side.available) {
        host.append(el('p', 'coach-unavailable', side.reason));
    } else {
        const stats = el('dl', 'coach-stats');
        stat(stats, 'Result', side.finished ? `Finished on a ${side.finishingTurn}-point turn` : `${side.remaining} left`);
        stat(stats, 'Turns recorded', side.turns);
        stat(stats, 'Points scored', side.points);
        stat(stats, 'Average per turn', side.averagePerTurn ?? '—');
        stat(stats, 'Highest turn', side.highTurn ?? '—');
        stat(stats, 'Bust turns', side.busts);
        stat(stats, '100+ / 140+ / 180', `${side.tonPlus} / ${side.ton40Plus} / ${side.ton80}`);
        if (side.firstThreeAverage !== null) stat(stats, 'First three turns, average', side.firstThreeAverage);
        stat(stats, 'Turns that began on 170 or less', side.finishWindowTurns);
        if (side.darts) {
            stat(stats, 'Darts recorded', side.darts);
            stat(stats, 'Average per dart', side.averagePerDart);
        }
        host.append(stats);
        if (side.throwers.length > 1) {
            const list = el('ul', 'coach-throwers');
            for (const thrower of side.throwers) {
                list.append(el('li', '', `${thrower.name}: ${thrower.turns} turn${thrower.turns === 1 ? '' : 's'}, ${thrower.averagePerTurn} per turn`));
            }
            host.append(el('h4', '', 'By thrower (recorded turn totals)'), list);
        }
    }
    const drill = side.drill, card = el('section', 'coach-drill');
    card.dataset.drill = drill.id;
    card.append(el('h4', '', `Practice drill: ${drill.title}`), el('p', 'coach-why', drill.why));
    const steps = el('ol');
    for (const step of drill.steps) steps.append(el('li', '', step));
    card.append(steps, el('p', 'coach-target', `Target: ${drill.target}`));
    host.append(card);
}

function remove() { document.getElementById(PANEL_ID)?.remove(); }

export function renderCoach() {
    remove();
    const recap = build501Recap(game);
    const content = document.querySelector('#winnerModal .winner-modal-content');
    if (!recap || !content) return;
    ensureStyles();
    const panel = el('details', 'coach-recap');
    panel.id = PANEL_ID;
    panel.append(el('summary', '', '501 coach recap · DEV'));
    const body = el('div', 'coach-body');
    if (selected === null || !recap.sides[selected]) selected = recap.winnerIndex ?? 0;
    const sideHost = el('div', 'coach-side');
    if (recap.sides.length > 1) {
        const tabs = el('div', 'coach-tabs');
        tabs.setAttribute('role', 'group');
        tabs.setAttribute('aria-label', 'Recap for');
        recap.sides.forEach((side, index) => {
            const tab = el('button', 'coach-tab', side.name);
            tab.type = 'button';
            tab.setAttribute('aria-pressed', String(index === selected));
            tab.addEventListener('click', () => {
                selected = index;
                tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
                renderSide(sideHost, side);
            });
            tabs.append(tab);
        });
        body.append(tabs);
    }
    renderSide(sideHost, recap.sides[selected]);
    body.append(sideHost);
    const limits = el('ul', 'coach-limits');
    for (const limit of recap.limits) limits.append(el('li', '', limit));
    body.append(limits);
    panel.append(body);
    const buttons = content.querySelector('.modal-buttons');
    content.insertBefore(panel, buttons);
}

export function initCoach() {
    const modal = document.getElementById('winnerModal');
    if (!modal) return;
    document.addEventListener('scorerWinnerShown', () => { selected = null; renderCoach(); });
    // The dialog is shared by other games and summaries; never leave a stale
    // 501 recap behind once it closes (including "Undo winning turn").
    new MutationObserver(() => { if (modal.style.display !== 'flex') remove(); })
        .observe(modal, { attributes: true, attributeFilter: ['style'] });
}
