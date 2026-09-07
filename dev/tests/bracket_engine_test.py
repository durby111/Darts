#!/usr/bin/env python3
"""Pure bracket ES-module regression tests, executed in Chrome via Playwright.

    /home/md/Documents/Darts/.venv/bin/python dev/tests/bracket_engine_test.py
    python dev/tests/bracket_engine_test.py --only corrections
"""

import argparse
import asyncio
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import tempfile
import threading
import traceback

from playwright.async_api import async_playwright


DEV_ROOT = Path(__file__).resolve().parent.parent


HELPERS = """
async () => {
    window.engine = await import('/js/brackets/engine.js');
    window.assert = (value, message = 'Assertion failed') => {
        if (!value) throw new Error(message);
    };
    window.equal = (actual, expected, message = 'Values differ') => {
        assert(JSON.stringify(actual) === JSON.stringify(expected),
            `${message}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
    };
    window.rejects = (fn, text = '') => {
        let caught;
        try { fn(); } catch (error) { caught = error; }
        assert(caught && caught.message.includes(text), `Expected rejection containing "${text}"`);
    };
    window.freeze = value => {
        if (value && typeof value === 'object') {
            Object.values(value).forEach(freeze);
            Object.freeze(value);
        }
        return value;
    };
    window.fixture = (count, checkedIn = true, gameType = 'chicago', bestOf = 3) => {
        const tournament = engine.createTournament({
            id: 'event-1', ownerId: 'verified-owner', title: 'Doubles',
            date: '2026-09-07', gameType, bestOf,
        });
        const registrations = Array.from({length: count * 2}, (_, index) => ({
            id: `entry-${index}`, playerId: index % 2 ? `verified-${index}` : null,
            name: `Player ${index}`, tag: String(Math.floor(index / 2) + 1),
            paid: false, checkedIn, standby: false,
        }));
        return engine.saveRoster(freeze(tournament), freeze(registrations));
    };
    window.start = count => {
        const random = Math.random;
        try {
            Math.random = () => 0.999999;
            return engine.startTournament(freeze(fixture(count)));
        } finally { Math.random = random; }
    };
    window.match = (t, code) => t.matches.find(item => item.code === code);
    window.result = (t, code, side = 'A', forfeit = false) => {
        const m = match(t, code);
        const threshold = Math.floor(t.bestOf / 2) + 1;
        return engine.recordResult(freeze(t), m.id, {
            winnerId: m[`team${side}`], forfeit,
            scoreA: forfeit ? null : side === 'A' ? threshold : 0,
            scoreB: forfeit ? null : side === 'B' ? threshold : 0,
        });
    };
}
"""


async def test_roster(page):
    return await page.evaluate("""() => {
        const t = fixture(2, false);
        equal(t.revision, 1);
        equal(t.status, 'registration');
        assert(t.registrations[0].playerId === null, 'Guests must not acquire inferred IDs');
        equal(t.registrations[1].playerId, 'verified-1');
        assert(engine.readiness(t).some(text => text.includes('checked in')));
        rejects(() => engine.startTournament(t), 'checked in');
        const rows = structuredClone(t.registrations);
        rows.forEach(r => { r.tag = `  ${r.tag}  `; r.checkedIn = true; });
        const saved = engine.saveRoster(freeze(t), freeze(rows));
        equal(saved.teams, t.teams, 'Whitespace must preserve teams and IDs');
        equal(engine.readiness(saved), [], 'Payment is not a start requirement');
        equal(rows[0].tag, '  1  ', 'Input roster must not mutate');
        equal(saved.registrations[0].tag, '1');
        const reversed = engine.saveRoster(saved, [...saved.registrations].reverse());
        equal(reversed.teams.map(t => t.id).sort(), saved.teams.map(t => t.id).sort());
        const swapped = structuredClone(saved.registrations);
        [swapped[0].tag, swapped[2].tag] = [swapped[2].tag, swapped[0].tag];
        const swap = engine.saveRoster(saved, swapped);
        equal(swap.teams.find(t => t.id === 'team-1').memberIds, ['entry-1', 'entry-2']);
        const extra = {...saved.registrations[0], id: 'extra', playerId: null, standby: true};
        const standby = engine.saveRoster(saved, [...saved.registrations, extra]);
        equal(standby.teams, saved.teams);
        equal(engine.readiness(standby), []);
        rejects(() => engine.saveRoster(saved, [...saved.registrations, {...extra, standby: false}]), 'two players');
        rejects(() => engine.saveRoster(saved, [...saved.registrations, {...extra, id: 'entry-0'}]), 'unique');
        rejects(() => engine.saveRoster(saved, [...saved.registrations, {...extra, playerId: 'verified-1'}]), 'only once');
        rejects(() => engine.saveRoster(saved, [{...extra, paid: 'false'}]), 'flags');
        rejects(() => engine.saveRoster(saved, [{...extra, tag: 'x'.repeat(101)}]), '100');
        const removed = engine.saveRoster(saved, saved.registrations.slice(1));
        equal(removed.registrations.length, 3);
        assert(engine.readiness(removed).some(text => text.includes('exactly two')));
        const restored = engine.saveRoster(removed, saved.registrations);
        equal(restored.teams, saved.teams);
        const emptied = engine.saveRoster(saved, []);
        equal(emptied.teams, []);
        equal(engine.saveRoster(emptied, saved.registrations).teams, saved.teams);
        const unpaired = engine.saveRoster(saved, [...saved.registrations, {...extra, standby: false, tag: ''}]);
        assert(engine.readiness(unpaired).some(text => text.includes('partner')));
        const live = start(2);
        rejects(() => engine.saveRoster(live, []), 'closed');
        rejects(() => engine.startTournament(live), 'closed');
        const badTeam = structuredClone(saved);
        badTeam.teams[1].memberIds[0] = badTeam.teams[0].memberIds[0];
        assert(engine.readiness(badTeam).some(text => text.includes('more than one team')));
        badTeam.teams[1].memberIds[0] = 'foreign-registration';
        assert(engine.readiness(badTeam).some(text => text.includes('not registered')));
        rejects(() => engine.startTournament(fixture(1)), 'between 2 and 32');
        rejects(() => engine.startTournament(fixture(33)), 'between 2 and 32');
        return 'roster normalization, stable IDs, eligibility, atomic swaps/removal';
    }""")


async def test_preview_and_shuffle(page):
    return await page.evaluate("""() => {
        const t = freeze(fixture(6, false));
        const before = JSON.stringify(t);
        const random = Math.random;
        let draws = 0;
        try {
            Math.random = () => { draws++; return 0; };
            const preview = engine.createPreview(t);
            equal(preview, engine.createPreview(t), 'Preview is deterministic');
            equal(draws, 0, 'Preview must not shuffle');
            equal(JSON.stringify(t), before);
            equal(t.matches, []);
            equal(t.status, 'registration');
            const ready = engine.saveRoster(t, t.registrations.map(r => ({...r, checkedIn: true})));
            const live = engine.startTournament(freeze(ready));
            equal(draws, 5, 'Fisher-Yates exactly once at start');
            assert(JSON.stringify(live.matches) !== JSON.stringify(preview.matches), 'Live draw is shuffled');
            const serialized = JSON.parse(JSON.stringify(live));
            const sources = live.matches.map(m => [m.sourceA, m.sourceB]);
            const m = live.matches.find(m => m.status === 'ready');
            const played = result(serialized, m.code);
            equal(played.matches.map(m => [m.sourceA, m.sourceB]), sources, 'No reseeding on scoring');
            equal(draws, 5);
            rejects(() => engine.startTournament(played), 'closed');
            rejects(() => engine.createPreview(live), 'closed');
            const incomplete = engine.saveRoster(t, t.registrations.slice(1));
            equal(engine.createPreview(incomplete).teams.length, 5, 'Only complete pairs preview');
            equal(engine.createPreview(fixture(1)).matches, []);
            rejects(() => engine.createPreview(fixture(33)), 'between 2 and 32');
        } finally { Math.random = random; }
        return 'unlocked complete-pair previews; one-time shuffle; JSON round-trip';
    }""")


async def test_topology(page):
    return await page.evaluate("""() => {
        for (let count = 2; count <= 32; count++) {
            const preview = engine.createPreview(freeze(fixture(count)));
            const matches = preview.matches;
            const size = 2 ** Math.ceil(Math.log2(count));
            const rounds = Math.log2(size);
            equal(matches.length, 2 * size - 1, `match count ${count}`);
            const seen = new Set();
            for (const m of matches) {
                assert(!seen.has(m.code), 'Duplicate code');
                equal(m.id, m.code);
                for (const source of [m.sourceA, m.sourceB]) {
                    if (source?.matchCode) assert(seen.has(source.matchCode), 'Non-topological dependency');
                    if (source?.teamId) assert(preview.teams.some(t => t.id === source.teamId));
                }
                seen.add(m.code);
            }
            for (let r = 1; r <= rounds; r++) {
                equal(matches.filter(m => m.bracket === 'winners' && m.round === r).length, size / 2 ** r);
            }
            for (let r = 1; r < rounds; r++) {
                for (const round of [2*r-1, 2*r]) {
                    equal(matches.filter(m => m.bracket === 'losers' && m.round === round).length, size / 2 ** (r+1));
                }
            }
            const w1 = matches.filter(m => m.bracket === 'winners' && m.round === 1);
            const byeIds = w1.filter(m => m.status === 'bye').map(m => m.winnerId);
            equal(byeIds.slice().sort(), preview.teams.slice(0, size-count).map(t => t.id).sort(), 'High seeds get byes');
            const seeded = w1.flatMap(m => [m.teamA, m.teamB]).filter(Boolean);
            equal(new Set(seeded).size, count, 'Each team seeded once');
            for (const bye of matches.filter(m => m.status === 'bye')) {
                equal(bye.scoreA, null);
                equal(bye.scoreB, null);
                equal(bye.forfeit, false);
            }
            if (rounds >= 3) {
                const leftCount = size / 4;
                for (let position = 1; position <= leftCount; position++) {
                    const lower = matches.find(m => m.code === `L2.${position}`);
                    const sourceCode = `L1.${leftCount+1-position}`;
                    const sourceMatch = matches.find(m => m.code === sourceCode);
                    equal(lower.sourceA, sourceMatch.sourceA || sourceMatch.sourceB
                        ? {matchCode: sourceCode, outcome: 'winner'} : null);
                    equal(lower.sourceB, {matchCode: `W2.${position}`, outcome: 'loser'});
                }
            }
        }
        const two = engine.createPreview(fixture(2)).matches;
        equal(two.map(m => m.code), ['W1.1', 'GF1', 'GF2']);
        equal(two[1].sourceB, {matchCode: 'W1.1', outcome: 'loser'});
        equal(two[2].sourceA, {matchCode: 'GF1', outcome: 'winner'});
        equal(two[2].sourceB, {matchCode: 'GF1', outcome: 'loser'});
        const six = engine.createPreview(fixture(6)).matches;
        equal(six.find(m => m.code === 'W1.1').sourceB, null);
        equal(six.find(m => m.code === 'W1.3').sourceB, null);
        equal(six.find(m => m.code === 'L1.1').sourceA, null);
        equal(six.find(m => m.code === 'L1.2').sourceA, null);
        return 'all 31 sizes: topology, seed placement, lower crossover and byes';
    }""")


async def test_sizes_and_finals(page):
    return await page.evaluate("""() => {
        let tournaments = 0;
        for (let count = 2; count <= 32; count++) {
            for (const reset of [false, true]) {
                for (let scenario = 0; scenario < 3; scenario++) {
                    let t = start(count);
                    const losses = new Map(t.teams.map(team => [team.id, 0]));
                    let played = 0;
                    let seed = count * 31 + scenario;
                    while (t.status !== 'complete') {
                        assert(played < 2 * count, `Did not terminate: ${count}`);
                        const ready = t.matches.filter(m => m.status === 'ready');
                        assert(ready.length > 0, `Deadlock: ${count}`);
                        const participants = ready.flatMap(m => [m.teamA, m.teamB]);
                        equal(new Set(participants).size, participants.length, 'Team ready on two boards');
                        seed = (seed * 1664525 + 1013904223) >>> 0;
                        const m = ready[seed % ready.length];
                        assert(m.teamA && m.teamB && m.teamA !== m.teamB);
                        if (m.bracket === 'winners') {
                            equal(losses.get(m.teamA), 0); equal(losses.get(m.teamB), 0);
                        } else if (m.bracket === 'losers' || m.bracket === 'reset') {
                            equal(losses.get(m.teamA), 1); equal(losses.get(m.teamB), 1);
                        } else {
                            equal(losses.get(m.teamA), 0); equal(losses.get(m.teamB), 1);
                        }
                        const side = m.code === 'GF1' ? (reset ? 'B' : 'A')
                            : scenario === 0 ? 'A' : scenario === 1 ? 'B' : seed % 2 ? 'A' : 'B';
                        const loser = side === 'A' ? m.teamB : m.teamA;
                        losses.set(loser, losses.get(loser) + 1);
                        const revision = t.revision;
                        t = result(t, m.code, side, scenario === 2 && played % 4 === 0);
                        equal(t.revision, revision + 1);
                        played++;
                    }
                    equal(played, 2 * count - (reset ? 1 : 2), 'Byes are not played wins');
                    equal(t.matches.filter(m => m.status === 'complete').length, played);
                    const gf2 = match(t, 'GF2');
                    equal(gf2.status, reset ? 'complete' : 'void');
                    const champion = match(t, reset ? 'GF2' : 'GF1').winnerId;
                    equal(losses.get(champion), reset ? 1 : 0);
                    for (const [id, lost] of losses) if (id !== champion) equal(lost, 2, `Elimination: ${id}`);
                    assert(t.matches.every(m => ['bye', 'void', 'complete'].includes(m.status)));
                    rejects(() => engine.saveRoster(t, []), 'closed');
                    tournaments++;
                }
            }
        }
        return `${tournaments} complete tournaments: 2–32 teams, upper/lower/random winners, both GF paths`;
    }""")


async def test_scores(page):
    return await page.evaluate("""() => {
        for (const gameType of ['chicago', '301', '501', 'cricket', 'spanish', 'minnesota']) {
            for (const bestOf of [1, 3, 5, 7]) {
                const t = engine.startTournament(freeze(fixture(2, true, gameType, bestOf)));
                equal(t.bestOf, gameType === 'chicago' ? 3 : bestOf);
                const m = match(t, 'W1.1');
                const threshold = Math.floor(t.bestOf / 2) + 1;
                const recorded = engine.recordResult(freeze(t), m.id, {
                    winnerId: m.teamB, scoreA: threshold - 1, scoreB: threshold,
                });
                equal(match(recorded, m.code).winnerId, m.teamB);
                equal(match(t, m.code).winnerId, null, 'No input mutation');
            }
        }
        rejects(() => fixture(2, true, 'baseball'), 'Unsupported');
        for (const bestOf of [0, -1, 2, 2.5, '3', NaN, Infinity]) {
            rejects(() => fixture(2, true, '501', bestOf), 'positive odd');
        }
        const t = freeze(start(2));
        const m = match(t, 'W1.1');
        for (const [scoreA, scoreB] of [[null,null], [1,0], [3,0], [2,2], [0,2], [-1,2], [2,-1], [2,0.5], ['2',0], [true,0], [NaN,0]]) {
            rejects(() => engine.recordResult(t, m.id, {winnerId: m.teamA, scoreA, scoreB}), 'Leg scores');
        }
        rejects(() => engine.recordResult(t, m.id, {winnerId: 'outsider', scoreA: 2, scoreB: 0}), 'Winner');
        rejects(() => engine.recordResult(t, m.id, {winnerId: m.teamA, scoreA: 2, scoreB: 0, forfeit: true}), 'cannot include scores');
        rejects(() => engine.recordResult(t, m.id, {winnerId: m.teamA, forfeit: 'true'}), 'true or false');
        const forfeited = engine.recordResult(t, m.id, {winnerId: m.teamA, forfeit: true});
        equal(match(forfeited, m.code).scoreA, null);
        equal(match(forfeited, m.code).forfeit, true);
        const scored = result(forfeited, m.code, 'B');
        equal(match(scored, m.code).forfeit, false);
        equal(match(scored, m.code).scoreB, 2);
        const again = result(scored, m.code, 'A', true);
        equal(match(again, m.code).scoreB, null);
        const three = start(3);
        rejects(() => result(three, 'W1.1'), 'Only ready');
        rejects(() => result(three, 'W2.1'), 'Only ready');
        rejects(() => result(t, 'GF2'), 'Only ready');
        rejects(() => engine.recordResult(fixture(2), 'W1.1', {}), 'not started');
        return 'game whitelist, Chicago format, leg thresholds, invalid scores, forfeits';
    }""")


async def test_corrections(page):
    return await page.evaluate("""() => {
        let t = result(start(4), 'W1.1');
        const original = match(t, 'W1.1');
        equal(match(t, 'W2.1').teamA, original.teamA);
        equal(match(t, 'L1.1').teamA, original.teamB);
        t = result(t, 'W1.1', 'B');
        equal(match(t, 'W2.1').teamA, original.teamB);
        equal(match(t, 'L1.1').teamA, original.teamA);
        equal(t.matches.filter(m => m.status === 'complete').length, 1);
        t = result(t, 'W1.2');
        t = result(t, 'W2.1');
        const before = JSON.stringify(t);
        rejects(() => result(t, 'W1.1'), 'dependent match');
        equal(JSON.stringify(t), before);
        let byePath = result(start(3), 'W1.2');
        const opening = match(byePath, 'W1.2');
        equal(match(byePath, 'L1.1').status, 'bye');
        byePath = result(byePath, 'W1.2', 'B');
        equal(match(byePath, 'L1.1').winnerId, opening.teamA, 'Correction traverses bye');
        byePath = result(byePath, 'W2.1');
        byePath = result(byePath, 'L2.1');
        rejects(() => result(byePath, 'W1.2'), 'dependent match');
        let final = result(result(start(2), 'W1.1'), 'GF1');
        equal(final.status, 'complete');
        equal(match(final, 'GF2').status, 'void');
        final = result(final, 'GF1', 'B');
        equal(final.status, 'live');
        equal(match(final, 'GF2').status, 'ready');
        equal(match(final, 'GF2').teamA, match(final, 'GF1').teamB);
        final = result(final, 'GF1');
        equal(final.status, 'complete');
        for (const key of ['teamA', 'teamB', 'winnerId', 'scoreA', 'scoreB']) equal(match(final, 'GF2')[key], null);
        final = result(final, 'GF1', 'B');
        final = result(final, 'GF2');
        rejects(() => result(final, 'GF1'), 'dependent match');
        rejects(() => result(final, 'W1.1'), 'dependent match');
        const winner = match(final, 'GF2').teamB;
        final = result(final, 'GF2', 'B');
        equal(match(final, 'GF2').winnerId, winner, 'Terminal result safely correctable');
        equal(final.status, 'complete');
        // A later completed descendant must block even if its intermediate state is a bye.
        const synthetic = structuredClone(result(start(4), 'W1.1'));
        synthetic.matches.push({
            id: 'descendant', code: 'descendant', status: 'complete',
            sourceA: {matchCode: 'W2.1', outcome: 'winner'}, sourceB: null,
        });
        rejects(() => result(synthetic, 'W1.1'), 'dependent match');
        return 'safe rerouting, bye paths, transitive correction guards and GF reopening';
    }""")


TESTS = {
    "roster": test_roster,
    "preview_and_shuffle": test_preview_and_shuffle,
    "topology": test_topology,
    "sizes_and_finals": test_sizes_and_finals,
    "scores": test_scores,
    "corrections": test_corrections,
}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/__engine_tests__":
            body = b"<!doctype html><title>Bracket engine tests</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


async def run(selected):
    # Chrome's Unix socket paths must stay short; all scratch data remains in dev.
    runtime = DEV_ROOT / f".be-{os.getpid()}"
    runtime.mkdir()
    old_tempdir = tempfile.tempdir
    old_environment = {key: os.environ.get(key) for key in ("TMPDIR", "TMP", "TEMP")}
    for key in old_environment:
        os.environ[key] = str(runtime)
    tempfile.tempdir = str(runtime)
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(DEV_ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    failures = 0
    try:
        async with async_playwright() as playwright:
            chrome = shutil.which("google-chrome") or shutil.which("chromium")
            browser = await playwright.chromium.launch(
                headless=True,
                **({"executable_path": chrome} if chrome else {}),
            )
            try:
                page = await browser.new_page()
                await page.goto(f"http://127.0.0.1:{server.server_port}/__engine_tests__")
                await page.evaluate(HELPERS)
                for name in selected:
                    try:
                        detail = await TESTS[name](page)
                        print(f"PASS {name}: {detail}")
                    except Exception:
                        failures += 1
                        print(f"FAIL {name}")
                        traceback.print_exc()
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        tempfile.tempdir = old_tempdir
        for key, value in old_environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(runtime)
    print(f"{len(selected) - failures}/{len(selected)} bracket engine tests passed")
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=list(TESTS))
    args = parser.parse_args()
    raise SystemExit(bool(asyncio.run(run([args.only] if args.only else list(TESTS)))))
