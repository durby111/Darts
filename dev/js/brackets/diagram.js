// Source-driven tournament presentation. Match state and progression stay in engine.js.
import { registrationLabels } from './labels.js';
import { diagramViewport } from './viewport.js';
export const MATCH_GEOMETRY = Object.freeze({ width: 280, height: 190, column: 364, row: 246 });
const { width: WIDTH, height: HEIGHT, column: COLUMN, row: ROW } = MATCH_GEOMETRY;
const SLOT_CENTERS = [61, 125], LEFT = 48;
const LABELS = { winners: 'Winners bracket', losers: 'Losers bracket', final: 'Grand final', reset: 'Reset · if needed' };

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function buildLayout(matches) {
    const nodes = [], headings = [], sections = [];
    const byCode = new Map();
    let top = 88, maxRounds = 0, dropBoundary = 0;
    const dropCount = matches.reduce((count, match) => count + ['A', 'B'].filter(side => {
        const source = match[`source${side}`];
        return match.bracket === 'losers' && source?.outcome === 'loser';
    }).length, 0);
    for (const bracket of ['winners', 'losers']) {
        const group = matches.filter(match => match.bracket === bracket);
        if (!group.length) continue;
        const rounds = [...new Set(group.map(match => match.round))].sort((a, b) => a - b);
        const height = Math.max(...rounds.map(round => group.filter(match => match.round === round).length)) * ROW;
        maxRounds = Math.max(maxRounds, rounds.length);
        // Order feeder columns from the next round's actual sources. The lower
        // bracket reverses pairings on drop-in rounds; position alone crosses edges.
        const order = new Map();
        for (const round of [...rounds].reverse()) {
            const entries = group.filter(match => match.round === round).sort((a, b) => a.position - b.position);
            const next = order.get(round + 1) || [];
            const codes = next.flatMap(match => [match.sourceA?.matchCode, match.sourceB?.matchCode]);
            order.set(round, [...entries].sort((a, b) => {
                const rank = match => codes.includes(match.code) ? codes.indexOf(match.code) : codes.length + match.position;
                return rank(a) - rank(b);
            }));
        }
        sections.push({ bracket, x: 0, y: top - 88, width: rounds.length * COLUMN - (COLUMN - WIDTH) + LEFT + 20, height: height + 100 });
        headings.push({ text: LABELS[bracket], detail: bracket === 'winners' ? 'Win to advance →' : 'One loss · win to stay in →', x: LEFT, y: top - 76, section: true });
        rounds.forEach((round, column) => {
            const entries = order.get(round), x = LEFT + column * COLUMN;
            const remaining = rounds.length - column;
            const title = bracket === 'winners'
                ? remaining === 1 ? 'Winners final' : remaining === 2 ? 'Semifinals' : remaining === 3 ? 'Quarterfinals' : `Round ${round}`
                : remaining === 1 ? 'Losers final' : `Round ${round}`;
            headings.push({ text: title, detail: `${entries.length} ${entries.length === 1 ? 'match' : 'matches'}`, x, y: top - 18 });
            entries.forEach((match, row) => {
                const node = { match, x, y: top + (row + .5) * height / entries.length - HEIGHT / 2 };
                nodes.push(node); byCode.set(match.code, node);
            });
        });
        if (bracket === 'winners') dropBoundary = top + height + 20;
        top += height + 132 + (bracket === 'winners' && dropCount ? Math.max(48, dropCount * 4) : 0);
    }
    ['final', 'reset'].forEach((bracket, column) => {
        for (const match of matches.filter(item => item.bracket === bracket)) {
            const sources = [match.sourceA, match.sourceB].map(source => byCode.get(source?.matchCode)).filter(Boolean);
            const center = sources.length ? sources.reduce((sum, node) => sum + node.y + HEIGHT / 2, 0) / sources.length : top / 2;
            const node = { match, x: LEFT + (maxRounds + column) * COLUMN, y: center - HEIGHT / 2 };
            nodes.push(node); byCode.set(match.code, node);
            headings.push({ text: LABELS[bracket], detail: bracket === 'final' ? 'For the championship' : 'Only if the lower bracket wins GF1', x: node.x, y: node.y - 56, section: true });
        }
    });
    const connectors = [];
    let dropIndex = 0;
    for (const target of nodes) {
        ['A', 'B'].forEach((side, index) => {
            const sourceSpec = target.match[`source${side}`];
            const source = byCode.get(sourceSpec?.matchCode);
            if (!source) return;
            const y = target.y + SLOT_CENTERS[index];
            const drop = source.match.bracket === 'winners' && target.match.bracket === 'losers';
            const lane = target.x - (side === 'A' ? 36 : 22);
            const sourceY = source.y + HEIGHT / 2;
            // Cross-bracket drops travel through the section gap, never through
            // match cards. The same labeled source jump remains keyboard accessible.
            const routeY = dropBoundary + dropIndex * 4;
            if (drop) dropIndex++;
            connectors.push({
                source: source.match.code, target: target.match.code, side, drop, loser: sourceSpec.outcome === 'loser',
                conditional: target.match.bracket === 'reset',
                path: drop ? `M ${source.x + WIDTH} ${sourceY} H ${source.x + WIDTH + 16} V ${routeY} H ${lane} V ${y} H ${target.x}`
                    : `M ${source.x + WIDTH} ${sourceY} H ${lane} V ${y} H ${target.x}`,
            });
        });
    }
    return {
        nodes, headings, sections, connectors,
        width: nodes.length ? Math.max(...nodes.map(node => node.x)) + WIDTH + 20 : 0,
        height: nodes.length ? Math.max(...sections.map(section => section.y + section.height), ...nodes.map(node => node.y + HEIGHT + 20)) : 0,
    };
}

export function teamLabel(tournament, teamId, labels = registrationLabels(tournament.registrations)) {
    const team = tournament.teams.find(item => item.id === teamId);
    if (!team) return 'Not decided';
    const names = team.memberIds.map(id => labels.get(id) || 'Unknown player');
    return `${team.name} — ${names.join(' & ')}`;
}

export function renderDiagram(host, tournament, { preview = false, canScore = false, canCorrect = null, onSelect, scale } = {}) {
    const view = diagramViewport(host);
    const active = document.activeElement;
    const activeCard = host.contains(active) ? active.closest('.match-card') : null;
    const focus = activeCard && host.dataset.eventId === tournament.id ? {
        code: activeCard.dataset.code, button: [...activeCard.querySelectorAll('button')].indexOf(active),
    } : null;
    host.dataset.eventId = tournament.id;
    view.beforeRender();
    host.replaceChildren();
    if (!tournament.matches.length) {
        view.clear();
        host.append(element('p', 'diagram-empty', 'Pair at least two complete teams to see a connected preview.'));
        return;
    }
    const layout = buildLayout(tournament.matches);
    const labels = registrationLabels(tournament.registrations);
    const spacer = element('div', 'diagram-spacer');
    const canvas = element('div', 'diagram-canvas');
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    for (const section of layout.sections) {
        const band = element('div', `diagram-section diagram-section-${section.bracket}`);
        Object.assign(band.style, { left: `${section.x}px`, top: `${section.y}px`, width: `${section.width}px`, height: `${section.height}px` });
        band.setAttribute('aria-hidden', 'true');
        canvas.append(band);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('diagram-connectors');
    for (const connector of layout.connectors) {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', connector.path);
        path.setAttribute('class', `connector${connector.drop || connector.loser ? ' drop' : ''}${connector.conditional ? ' conditional' : ''}`);
        path.dataset.source = connector.source;
        path.dataset.target = connector.target;
        path.dataset.side = connector.side;
        svg.append(path);
    }
    canvas.append(svg);
    for (const heading of layout.headings) {
        const label = element(heading.section ? 'h3' : 'span', `diagram-heading${heading.section ? ' section-heading' : ''}`);
        label.append(element('span', 'round-title', heading.text));
        if (heading.detail) label.append(element('span', 'round-detail', heading.detail));
        label.style.left = `${heading.x}px`;
        label.style.top = `${heading.y}px`;
        canvas.append(label);
    }
    for (const node of layout.nodes) {
        const match = node.match;
        const card = element('article', `match-card ${match.status}`);
        card.id = `match-${match.code}`;
        card.dataset.code = match.code;
        card.tabIndex = -1;
        card.setAttribute('aria-label', `${match.code} · ${LABELS[match.bracket] || 'Match'}`);
        card.style.width = `${WIDTH}px`;
        card.style.height = `${HEIGHT}px`;
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
        const state = preview ? (match.status === 'bye' ? 'Bye · Not played' : 'Not played')
            : match.status === 'bye' ? 'Bye · no win'
                : match.status === 'void' ? 'Not required' : match.status === 'complete' ? (match.forfeit ? 'Forfeit' : 'Played') : match.status === 'ready' ? 'Ready' : 'Upcoming';
        const header = element('h4', 'match-header');
        header.append(element('span', 'match-code', match.code), element('span', 'match-state', state));
        card.append(header);
        for (const side of ['A', 'B']) {
            const teamId = match[`team${side}`];
            const source = match[`source${side}`];
            const played = !preview && match.status === 'complete';
            const won = played && teamId && match.winnerId === teamId;
            const slot = element('div', `match-slot${won ? ' won' : played && teamId ? ' lost' : ''}`);
            const label = teamId ? teamLabel(tournament, teamId, labels) : source ? 'Not decided' : 'Bye';
            const text = element('span', 'slot-label');
            const team = tournament.teams.find(item => item.id === teamId);
            if (team) {
                text.append(element('strong', 'slot-team', team.name), element('span', 'slot-members', team.memberIds.map(id => labels.get(id) || 'Unknown player').join(' & ')));
            } else text.append(element('span', 'slot-team', label));
            text.title = label;
            slot.append(text);
            if (played && teamId) slot.append(element('span', 'slot-score', `${match.forfeit ? '' : match[`score${side}`]} ${won ? 'Won' : 'Lost'}`.trim()));
            if (source?.matchCode) {
                const jump = element('button', 'source-jump', `← ${source.outcome === 'winner' ? 'Winner' : 'Loser'} of ${source.matchCode}`);
                jump.type = 'button';
                jump.addEventListener('click', () => {
                    const target = [...canvas.querySelectorAll('.match-card')].find(card => card.dataset.code === source.matchCode);
                    view.reveal(target);
                });
                slot.append(jump);
            }
            card.append(slot);
        }
        if (!preview && canScore && (match.status === 'ready' || canCorrect?.(match))) {
            const select = element('button', 'match-action', match.status === 'complete' ? 'Correct result' : 'Score match');
            select.type = 'button';
            select.addEventListener('click', () => onSelect?.(match.id));
            card.append(select);
        }
        canvas.append(card);
    }
    spacer.append(canvas);
    host.append(spacer);
    view.setContent(canvas, spacer, layout, tournament.id, scale);
    if (focus) {
        const card = [...canvas.querySelectorAll('.match-card')].find(item => item.dataset.code === focus.code);
        const target = focus.button < 0 ? card : card?.querySelectorAll('button')[focus.button];
        target?.focus({ preventScroll: true });
    }
}
