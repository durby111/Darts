import assert from 'node:assert/strict';
import { createTournament, saveRoster, startTournament } from '../js/brackets/engine.js';
import { buildLayout, MATCH_GEOMETRY } from '../js/brackets/diagram.js';

const { width, height } = MATCH_GEOMETRY;
let checked = 0;
for (const count of [2, 3, 4, 5, 8, 16, 32]) {
    for (const gameType of ['chicago', '301', '501', 'cricket', 'spanish', 'minnesota']) {
        let tournament = createTournament({ id: 'layout', ownerId: 'owner', title: 'Layout', date: '2026-10-10', gameType, bestOf: 3 });
        tournament = saveRoster(tournament, Array.from({ length: count * 2 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, tag: String(Math.floor(i / 2) + 1), paid: true, checkedIn: true, standby: false })));
        tournament = startTournament(tournament);
        const before = JSON.stringify(tournament);
        const layout = buildLayout(tournament.matches);
        assert.equal(JSON.stringify(tournament), before, 'layout must never mutate tournament state');
        assert.equal(layout.nodes.length, tournament.matches.length);
        const byCode = new Map(layout.nodes.map(node => [node.match.code, node]));
        for (const node of layout.nodes) {
            assert.ok(node.x >= 0 && node.y >= 0 && node.x + width <= layout.width && node.y + height <= layout.height);
            for (const other of layout.nodes) if (node !== other) {
                assert.ok(node.x + width <= other.x || other.x + width <= node.x || node.y + height <= other.y || other.y + height <= node.y, 'match cards cannot overlap');
            }
            for (const side of ['A', 'B']) {
                const spec = node.match[`source${side}`];
                if (!spec?.matchCode) continue;
                const edges = layout.connectors.filter(edge => edge.target === node.match.code && edge.side === side);
                assert.equal(edges.length, 1, 'each source has one complete visible connection');
                const edge = edges[0], source = byCode.get(spec.matchCode);
                assert.equal(edge.source, source.match.code);
                assert.equal(edge.loser, spec.outcome === 'loser', 'loser transfers remain explicit even for two-team finals');
                assert.ok(edge.path.startsWith(`M ${source.x + width} ${source.y + height / 2} `), 'including lower-bracket drops, connections start at their source');
                assert.ok(edge.path.endsWith(` H ${node.x}`));
                assert.equal(edge.drop, source.match.bracket === 'winners' && node.match.bracket === 'losers');
                assert.equal(edge.conditional, node.match.bracket === 'reset');
                // Every orthogonal segment stays outside all match-card interiors.
                const parts = [...edge.path.matchAll(/([MHV])\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)];
                let x, y;
                for (const [, op, a, b] of parts) {
                    if (op === 'M') { x = Number(a); y = Number(b); continue; }
                    const nx = op === 'H' ? Number(a) : x, ny = op === 'V' ? Number(a) : y;
                    for (const card of layout.nodes) {
                        const cuts = op === 'H'
                            ? y > card.y && y < card.y + height && Math.max(x, nx) > card.x && Math.min(x, nx) < card.x + width
                            : x > card.x && x < card.x + width && Math.max(y, ny) > card.y && Math.min(y, ny) < card.y + height;
                        assert.ok(!cuts, `${count}/${gameType}: ${edge.source} → ${edge.target} crosses ${card.match.code}`);
                    }
                    x = nx; y = ny;
                }
            }
        }
        assert.ok(layout.headings.some(heading => heading.text === 'Winners final'));
        if (count > 2) assert.ok(layout.headings.some(heading => heading.text === 'Losers final'));
        assert.ok(layout.headings.some(heading => heading.text === 'Grand final'));
        checked++;
    }
}
console.log(`PASS ${checked} bracket layouts: 2–32 teams, byes, all six games, full source routes, no overlapping cards or connectors through cards; state unchanged.`);
