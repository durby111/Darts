// 501 post-game coach — pure derivation. DEV only.
//
// The X01 scorer records ONE number per turn (the turn total) plus bust/miss
// flags and, in team play, the thrower's name. It does not record individual
// darts, segments, doubles aimed at, or checkout attempts. Darts per turn exist
// only inside a recorded/tournament session's ledger. Everything below is
// arithmetic on those recorded values; nothing is estimated or filled in.

export const START_SCORE = 501;
export const FINISH_WINDOW = 170; // highest total that three darts can finish

const isObject = value => value !== null && typeof value === 'object';

function turnOf(entry) {
    if (typeof entry === 'number') return { entered: entry, bust: false, miss: false, thrower: null };
    if (!isObject(entry) || typeof entry.score !== 'number') return null;
    return { entered: entry.score, bust: entry.bust === true, miss: entry.miss === true, thrower: typeof entry.thrower === 'string' ? entry.thrower : null };
}

export function coachEligible(game) {
    return !!game && game.type === '501' && !game.chicago && !game.game121
        && Array.isArray(game.players) && game.players.length > 0;
}

function round1(value) { return Math.round(value * 10) / 10; }

// Darts are known only when a recording session wrote them for this leg.
function recordedDarts(game, sideIndex) {
    const session = game.recording || game.tournament;
    const leg = game.scoringRecords?.legs?.at?.(-1);
    const teamId = session?.teams?.[sideIndex]?.id;
    if (!leg || leg.gameType !== '501' || !teamId || !Array.isArray(leg.turns)) return null;
    const turns = leg.turns.filter(turn => turn.teamId === teamId);
    if (!turns.length || turns.some(turn => !Number.isInteger(turn.darts) || turn.darts < 1 || turn.darts > 3)) return null;
    return turns.reduce((sum, turn) => sum + turn.darts, 0);
}

function sideRecap(game, player, index) {
    const turns = [];
    let remaining = START_SCORE, valid = Array.isArray(player.history);
    for (const entry of valid ? player.history : []) {
        const turn = turnOf(entry);
        if (!turn) { valid = false; break; }
        const scored = turn.bust ? 0 : turn.entered;
        turns.push({ ...turn, scored, startedOn: remaining });
        remaining -= scored;
    }
    // The ledger must reproduce the scoreboard exactly, or we say nothing.
    if (!valid || remaining !== player.score || turns.some(t => t.scored < 0 || t.scored > 180)) {
        return { index, name: player.name, available: false,
            reason: 'The recorded turn list does not match the final score, so no recap is shown for this side.' };
    }
    const count = turns.length;
    const points = START_SCORE - remaining;
    const scoredTurns = turns.map(t => t.scored);
    const windowTurns = turns.filter(t => t.startedOn <= FINISH_WINDOW).length;
    const darts = recordedDarts(game, index);
    const byThrower = new Map();
    for (const turn of turns) {
        if (!turn.thrower) continue;
        const entry = byThrower.get(turn.thrower) || { name: turn.thrower, turns: 0, points: 0 };
        entry.turns++; entry.points += turn.scored;
        byThrower.set(turn.thrower, entry);
    }
    const finished = remaining === 0 && count > 0;
    return {
        index, name: player.name, available: true, finished,
        turns: count, points, remaining,
        busts: turns.filter(t => t.bust).length,
        zeroTurns: turns.filter(t => !t.bust && t.scored === 0).length,
        averagePerTurn: count ? round1(points / count) : null,
        highTurn: count ? Math.max(...scoredTurns) : null,
        tonPlus: scoredTurns.filter(s => s >= 100 && s < 140).length,
        ton40Plus: scoredTurns.filter(s => s >= 140 && s < 180).length,
        ton80: scoredTurns.filter(s => s === 180).length,
        firstThreeAverage: count >= 3 ? round1((scoredTurns[0] + scoredTurns[1] + scoredTurns[2]) / 3) : null,
        finishWindowTurns: windowTurns,
        finishingTurn: finished ? turns.at(-1).scored : null,
        darts, averagePerDart: darts ? round1(points / darts) : null,
        throwers: [...byThrower.values()].map(t => ({ ...t, averagePerTurn: round1(t.points / t.turns) })),
    };
}

const roundUp10 = value => Math.ceil(value / 10) * 10;

// Exactly one drill. Every "why" cites a recorded number; none claims to know
// which segment was aimed at or hit.
export function chooseDrill(side) {
    if (!side.available || side.turns < 3) {
        return { id: 'baseline', title: 'Baseline: 10-turn Count Up',
            why: `Only ${side.available ? side.turns : 0} turn${side.turns === 1 ? '' : 's'} were recorded for this side, which is too few to point at one habit. This is a general starting drill, not a diagnosis.`,
            steps: ['Throw 10 turns of three darts at the 20s.', 'Write down each turn total and add them up.', 'Keep the total; next session, try to beat it by 20.'],
            target: 'Finish all 10 turns and record the total.' };
    }
    const avg = side.averagePerTurn;
    if (side.busts >= 2) {
        return { id: 'bust-control', title: 'Bust control: leave-a-double ladder',
            why: `${side.busts} of your ${side.turns} recorded turns were busts (each scored 0).`,
            steps: ['Start on 60 left. You have three darts per turn.', 'Before throwing, say the total you intend to leave if you do not finish (for example 40 or 32).', 'Finish on a double, or leave an even number of 40 or less. Going bust resets that rung.', 'Climb 60 → 70 → 80 → 90 → 100.'],
            target: 'Complete all five rungs with no more than 2 busts in total.' };
    }
    if (side.finishWindowTurns >= 4) {
        return { id: 'finish-window', title: 'Closing out: doubles round-the-board',
            why: `${side.finishWindowTurns} of your turns began on ${FINISH_WINDOW} or less${side.finished ? ' before the leg ended' : ` and the leg ended with ${side.remaining} left`}. Turn totals do not show what you aimed at, so this is about time spent in finishing range, not a count of missed doubles.`,
            steps: ['Throw three darts at each double in this order: D20, D16, D10, D8, D4, D2, D1.', 'Count how many of the 21 darts land in the double you called.', 'Then play five legs starting on 100 and count the turns each one takes.'],
            target: 'Hit at least 4 of 21 called doubles, then beat that count next session.' };
    }
    if (side.firstThreeAverage !== null && side.turns >= 6 && side.firstThreeAverage - avg >= 15) {
        const floor = Math.max(20, Math.floor(avg / 5) * 5);
        return { id: 'hold-pace', title: 'Hold your pace: 15-turn floor drill',
            why: `Your first three turns averaged ${side.firstThreeAverage} per turn, but the whole leg averaged ${avg} across ${side.turns} turns.`,
            steps: ['Throw 15 turns of three darts at the 20s without a break.', `Mark each turn that scores ${floor} or more.`, 'Compare how many marks fall in turns 1–5, 6–10 and 11–15.'],
            target: `At least 10 of 15 turns at ${floor} or more, with turns 11–15 no worse than turns 1–5.` };
    }
    if (avg < 45) {
        const target = roundUp10(avg * 10 + 50);
        return { id: 'scoring', title: 'Scoring power: 10-turn Count Up',
            why: `You averaged ${avg} points per turn over ${side.turns} recorded turns.`,
            steps: ['Play Count Up in BlakeOut, or keep a tally on paper: 10 turns of three darts.', 'Aim every dart at the 20s; if you drift, switch to 19s for that turn.', 'Record the 10-turn total.'],
            target: `${target} points or more in 10 turns (your recorded pace over 10 turns is ${Math.round(avg * 10)}).` };
    }
    const floor = Math.max(20, Math.floor(avg * 0.6 / 5) * 5);
    return { id: 'consistency', title: 'Consistency: no-low-turn drill',
        why: `You averaged ${avg} points per turn over ${side.turns} recorded turns with ${side.busts} bust${side.busts === 1 ? '' : 's'}; the recorded numbers do not single out one weakness.`,
        steps: ['Throw 12 turns of three darts at the 20s.', `Count the turns that score below ${floor}.`, 'Restart the count whenever two low turns happen in a row.'],
        target: `12 turns with no more than 2 turns below ${floor}.` };
}

export function build501Recap(game) {
    if (!coachEligible(game)) return null;
    const sides = game.players.map((player, index) => {
        const side = sideRecap(game, player, index);
        return { ...side, drill: chooseDrill(side) };
    });
    const finished = sides.filter(side => side.available && side.finished);
    return {
        gameType: '501',
        // A leg has a winner only when exactly one recorded side reached zero.
        winnerIndex: finished.length === 1 ? finished[0].index : null,
        teamMode: game.teamMode === true,
        dartsRecorded: sides.some(side => side.darts !== null && side.darts !== undefined && side.available),
        sides,
        limits: [
            'Built only from the turn totals, bust flags and (if recorded) dart counts saved for this leg.',
            'BlakeOut does not record individual darts, segments, doubles hit, or checkout attempts for 501, so none are shown.',
        ],
    };
}
