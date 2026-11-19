// 501 post-game coach: recap is arithmetic on recorded turn totals only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build501Recap, chooseDrill, coachEligible } from '../js/coach/recap.js';

const player = (name, history, score) => ({ name, history, score });
const total = history => history.reduce((sum, e) => sum + (typeof e === 'number' ? e : e.bust ? 0 : e.score), 0);
const game = (players, extra = {}) => ({ type: '501', players, chicago: null, game121: null, ...extra });

// Synthetic leg: winner 9 turns, loser left on 141 with two busts.
const winHistory = [100, 60, 140, 45, 26, 60, 30, { score: 0, miss: true }, 40];
assert.equal(total(winHistory), 501);
const loseHistory = [60, 41, 45, { score: 180, bust: true }, 100, 26, 60, { score: 99, bust: true }, 28];
const g = game([player('Synthetic A', winHistory, 0), player('Synthetic B', loseHistory, 501 - total(loseHistory))]);
const frozen = JSON.stringify(g);
const recap = build501Recap(g);
assert.equal(JSON.stringify(g), frozen, 'recap must not mutate the game');
assert.equal(recap.winnerIndex, 0);
const [a, b] = recap.sides;
assert.deepEqual([a.turns, a.points, a.remaining, a.busts, a.zeroTurns], [9, 501, 0, 0, 1]);
assert.equal(a.averagePerTurn, 55.7);            // 501 / 9
assert.equal(a.highTurn, 140);
assert.deepEqual([a.tonPlus, a.ton40Plus, a.ton80], [1, 1, 0]);
assert.equal(a.firstThreeAverage, 100);
assert.equal(a.finishingTurn, 40);
// Remaining before each turn: 501,401,341,201,156,130,70,40,40 → five began on ≤170.
assert.equal(a.finishWindowTurns, 5);
assert.deepEqual([b.turns, b.points, b.remaining, b.busts], [9, 360, 141, 2]);
assert.equal(b.averagePerTurn, 40);
assert.equal(b.highTurn, 100, 'a busted 180 is never credited as a high turn');
assert.equal(b.ton80, 0);
assert.equal(b.finished, false);
assert.equal(b.finishingTurn, null);
console.log('PASS recap arithmetic from recorded turn totals; busts score zero; input untouched');

// No dart-level data exists for an ordinary game, so none is reported.
assert.equal(a.darts, null); assert.equal(a.averagePerDart, null); assert.equal(recap.dartsRecorded, false);
// The complete set of reported fields is pinned: adding an estimated statistic must fail here.
assert.deepEqual(Object.keys(a).sort(), ['available', 'averagePerDart', 'averagePerTurn', 'busts', 'darts', 'drill', 'finishWindowTurns', 'finished',
    'finishingTurn', 'firstThreeAverage', 'highTurn', 'index', 'name', 'points', 'remaining', 'throwers', 'ton40Plus', 'ton80', 'tonPlus', 'turns', 'zeroTurns']);
for (const key of Object.keys(a)) assert.ok(!/accuracy|checkout|double|percent|firstNine/i.test(key), key);
assert.match(recap.limits.join(' '), /does not record individual darts/);
console.log('PASS no per-dart, accuracy or checkout-attempt statistics are produced');

// Darts appear only when a recording session actually stored them for this leg.
const recorded = game([player('T1', [100, 401], 0), player('T2', [60], 441)], {
    tournament: { teams: [{ id: 'ta' }, { id: 'tb' }] },
    scoringRecords: { legs: [{ gameType: '501', turns: [
        { teamId: 'ta', points: 100, darts: 3 }, { teamId: 'tb', points: 60, darts: 3 }, { teamId: 'ta', points: 401, darts: 2 }] }] },
});
// (401 in one turn is impossible; the recap must refuse rather than report it.)
assert.equal(build501Recap(recorded).sides[0].available, false);
recorded.players[0] = player('T1', [180, 180, 141], 0);
recorded.scoringRecords.legs[0].turns = [
    { teamId: 'ta', points: 180, darts: 3 }, { teamId: 'tb', points: 60, darts: 3 },
    { teamId: 'ta', points: 180, darts: 3 }, { teamId: 'ta', points: 141, darts: 3 }];
const rec = build501Recap(recorded);
assert.deepEqual([rec.sides[0].darts, rec.sides[0].averagePerDart, rec.sides[0].ton80], [9, 55.7, 2]);
recorded.scoringRecords.legs[0].turns[0].darts = undefined;
assert.equal(build501Recap(recorded).sides[0].darts, null, 'an incomplete dart ledger reports no darts');
console.log('PASS dart counts only from a complete recorded ledger; impossible ledgers are refused');

// A ledger that does not reproduce the scoreboard yields no numbers.
const mismatch = build501Recap(game([player('X', [100, 60], 300)]));
assert.equal(mismatch.sides[0].available, false);
assert.equal(mismatch.winnerIndex, null);
assert.equal(mismatch.sides[0].drill.id, 'baseline');
assert.equal(build501Recap(game([player('X', [{ nope: 1 }], 501)])).sides[0].available, false);
console.log('PASS mismatched or malformed history produces no statistics');

// Eligibility: 501 only; not 301, Chicago legs or the 121 game.
assert.equal(build501Recap({ ...g, type: '301' }), null);
assert.equal(build501Recap({ ...g, chicago: {} }), null);
assert.equal(build501Recap({ ...g, game121: {} }), null);
assert.equal(coachEligible({ type: '501', players: [] }), false);
assert.equal(build501Recap(null), null);
console.log('PASS coach is limited to 501');

// Exactly one drill per side, chosen from recorded numbers and citing them.
for (const side of recap.sides) {
    assert.equal(typeof side.drill.title, 'string');
    assert.ok(side.drill.steps.length >= 2 && side.drill.target.length > 10);
}
assert.equal(b.drill.id, 'bust-control');
assert.match(b.drill.why, /2 of your 9 recorded turns were busts/);
assert.equal(a.drill.id, 'finish-window');
assert.match(a.drill.why, /5 of your turns began on 170 or less/);
assert.match(a.drill.why, /not a count of missed doubles/);
const base = { available: true, finished: false, remaining: 100, busts: 0, finishWindowTurns: 1, firstThreeAverage: null };
const slow = chooseDrill({ ...base, turns: 10, averagePerTurn: 38.2 });
assert.equal(slow.id, 'scoring');
assert.match(slow.target, /^440 points or more in 10 turns \(your recorded pace over 10 turns is 382\)/);
const fade = chooseDrill({ ...base, turns: 8, averagePerTurn: 50, firstThreeAverage: 80 });
assert.equal(fade.id, 'hold-pace'); assert.match(fade.why, /averaged 80 per turn.*averaged 50 across 8 turns/);
assert.equal(chooseDrill({ ...base, turns: 8, averagePerTurn: 62, firstThreeAverage: 60 }).id, 'consistency');
const few = chooseDrill({ ...base, turns: 2, averagePerTurn: 90 });
assert.equal(few.id, 'baseline'); assert.match(few.why, /not a diagnosis/);
console.log('PASS one concrete drill, selected and justified by recorded numbers');

// Team play: per-thrower lines come from recorded thrower names on turns.
const team = build501Recap(game([player('Home', [{ score: 100, thrower: 'Ann' }, { score: 60, thrower: 'Bo' }, { score: 41, thrower: 'Ann' }], 300)], { teamMode: true }));
assert.deepEqual(team.sides[0].throwers, [{ name: 'Ann', turns: 2, points: 141, averagePerTurn: 70.5 }, { name: 'Bo', turns: 1, points: 60, averagePerTurn: 60 }]);
console.log('PASS team thrower breakdown from recorded thrower names');

// Scope: the coach modules read state only; scoring/statistics code is not modified by them.
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
for (const file of ['../js/coach/recap.js', '../js/coach/ui.js']) {
    const source = read(file);
    assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|firebase|saveActiveGame|saveGameState/.test(source), `${file} must be read-only and offline`);
}
assert.match(read('../js/app.js'), /import\('\.\/coach\/ui\.js'\)\.then\(m => m\.initCoach\(\)\)\.catch/);
assert.ok(!fs.existsSync(new URL('../../js/coach', import.meta.url)), 'coach must not exist in production');
console.log('PASS coach is read-only, optional and DEV-only');
