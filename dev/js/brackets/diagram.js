// Geometry ported from tournament-manager's bracket_layout.py; sources alone route edges.
const WIDTH = 280, HEIGHT = 220, COLUMN = 340, ROW = 246;
const LABELS = { winners: 'Winners bracket', losers: 'Losers bracket', final: 'Grand final', reset: 'Reset · if needed' };

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

export function buildLayout(matches) {
    const nodes = [], headings = [];
    let top = 70, maxRounds = 0;
    for (const bracket of ['winners', 'losers']) {
        const group = matches.filter(match => match.bracket === bracket);
        if (!group.length) continue;
        const rounds = [...new Set(group.map(match => match.round))].sort((a, b) => a - b);
        const height = Math.max(...rounds.map(round => group.filter(match => match.round === round).length)) * ROW;
        maxRounds = Math.max(maxRounds, rounds.length);
        headings.push({ text: LABELS[bracket], x: 20, y: top - 60, section: true });
        rounds.forEach((round, column) => {
            const entries = group.filter(match => match.round === round).sort((a, b) => a.position - b.position);
            const x = 20 + column * COLUMN;
            headings.push({ text: `Round ${round}`, x, y: top - 30 });
            entries.forEach((match, row) => nodes.push({
                match, x, y: top + (row + .5) * height / entries.length - HEIGHT / 2,
            }));
        });
        top += height + 90;
    }
    ['final', 'reset'].forEach((bracket, column) => {
        for (const match of matches.filter(item => item.bracket === bracket)) {
            const sources = [match.sourceA, match.sourceB].map(source => nodes.find(node => node.match.code === source?.matchCode)).filter(Boolean);
            const center = sources.length ? sources.reduce((sum, node) => sum + node.y + HEIGHT / 2, 0) / sources.length : top / 2;
            const node = { match, x: 20 + (maxRounds + column) * COLUMN, y: center - HEIGHT / 2 };
            nodes.push(node);
            headings.push({ text: LABELS[bracket], x: node.x, y: node.y - 40, section: true });
        }
    });
    const connectors = [];
    for (const target of nodes) {
        ['A', 'B'].forEach((side, index) => {
            const sourceSpec = target.match[`source${side}`];
            const source = nodes.find(node => node.match.code === sourceSpec?.matchCode);
            if (!source) return;
            const y = target.y + 70 + index * 67;
            const drop = source.match.bracket === 'winners' && target.match.bracket === 'losers';
            const lane = target.x - (side === 'A' ? 24 : 12);
            connectors.push({
                source: source.match.code, target: target.match.code, drop,
                conditional: target.match.bracket === 'reset',
                path: drop ? `M ${target.x - 16} ${y} H ${target.x}`
                    : `M ${source.x + WIDTH} ${source.y + HEIGHT / 2} H ${lane} V ${y} H ${target.x}`,
            });
        });
    }
    return {
        nodes, headings, connectors,
        width: nodes.length ? Math.max(...nodes.map(node => node.x)) + WIDTH + 20 : 0,
        height: nodes.length ? Math.max(top - 60, ...nodes.map(node => node.y + HEIGHT + 20)) : 0,
    };
}

export function teamLabel(tournament, teamId) {
    const team = tournament.teams.find(item => item.id === teamId);
    if (!team) return 'Not decided';
    const names = team.memberIds.map(id => tournament.registrations.find(entry => entry.id === id)?.name || 'Unknown player');
    return `${team.name} — ${names.join(' & ')}`;
}

export function renderDiagram(host, tournament, { preview = false, canScore = false, onSelect, scale = '1' } = {}) {
    const scroll = { left: host.scrollLeft, top: host.scrollTop };
    host.replaceChildren();
    if (!tournament.matches.length) {
        host.append(element('p', 'diagram-empty', 'Pair at least two complete teams to see a connected preview.'));
        return;
    }
    const layout = buildLayout(tournament.matches);
    const spacer = element('div', 'diagram-spacer');
    const canvas = element('div', 'diagram-canvas');
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${layout.height}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', layout.width);
    svg.setAttribute('height', layout.height);
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('diagram-connectors');
    for (const connector of layout.connectors) {
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', connector.path);
        path.setAttribute('class', `connector${connector.drop ? ' drop' : ''}${connector.conditional ? ' conditional' : ''}`);
        path.dataset.source = connector.source;
        path.dataset.target = connector.target;
        svg.append(path);
    }
    canvas.append(svg);
    for (const heading of layout.headings) {
        const label = element(heading.section ? 'h3' : 'span', 'diagram-heading', heading.text);
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
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
        const state = preview ? (match.status === 'bye' ? 'Bye · Not played' : 'Not played')
            : match.status === 'bye' ? 'Bye · no win'
                : match.status === 'void' ? 'Not required' : match.status === 'complete' ? (match.forfeit ? 'Forfeit' : 'Played') : match.status === 'ready' ? 'Ready' : 'Upcoming';
        card.append(element('h4', 'match-header', `${match.code} · ${state}`));
        for (const side of ['A', 'B']) {
            const teamId = match[`team${side}`];
            const source = match[`source${side}`];
            const played = !preview && match.status === 'complete';
            const won = played && teamId && match.winnerId === teamId;
            const slot = element('div', `match-slot${won ? ' won' : ''}`);
            const label = teamId ? teamLabel(tournament, teamId) : source ? 'Not decided' : 'Bye';
            const text = element('span', 'slot-label', label);
            text.title = label;
            slot.append(text);
            if (played && teamId) slot.append(element('span', 'slot-score', `${match.forfeit ? '' : match[`score${side}`]} ${won ? 'Won' : 'Lost'}`.trim()));
            if (source?.matchCode) {
                const jump = element('button', 'source-jump', `${source.outcome === 'winner' ? 'Winner' : 'Loser'} of ${source.matchCode} ↗`);
                jump.type = 'button';
                jump.addEventListener('click', () => {
                    const target = [...canvas.querySelectorAll('.match-card')].find(card => card.dataset.code === source.matchCode);
                    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    target?.focus({ preventScroll: true });
                });
                slot.append(jump);
            }
            card.append(slot);
        }
        if (!preview && canScore && match.status === 'ready') {
            const select = element('button', 'match-action', 'Score match');
            select.type = 'button';
            select.addEventListener('click', () => onSelect?.(match.id));
            card.append(select);
        }
        canvas.append(card);
    }
    const factor = scale === 'fit' ? Math.min(1, (host.clientWidth - 12) / layout.width) : Number(scale);
    canvas.style.transform = `scale(${factor})`;
    spacer.style.width = `${layout.width * factor}px`;
    spacer.style.height = `${layout.height * factor}px`;
    spacer.append(canvas);
    host.append(spacer);
    host.scrollLeft = scroll.left;
    host.scrollTop = scroll.top;
}
