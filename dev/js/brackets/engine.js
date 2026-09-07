// Portable tournament state only. Authentication and persistence belong to callers.
// Team memberIds refer to registration IDs. Sources are null, {teamId}, or
// {matchCode, outcome: 'winner'|'loser'}. Only 'complete' matches count as played;
// 'bye' winners advance without a win/loss. Other statuses: pending, ready, void.
const GAME_TYPES = new Set(['chicago', '301', '501', 'cricket', 'spanish', 'minnesota']);
const clone = value => JSON.parse(JSON.stringify(value));
const ref = (matchCode, outcome) => ({ matchCode, outcome });

function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
    return value.trim();
}

function validateFormat(tournament) {
    if (!GAME_TYPES.has(tournament.gameType)) throw new Error('Unsupported tournament game type.');
    if (!Number.isSafeInteger(tournament.bestOf) || tournament.bestOf < 1 || tournament.bestOf % 2 !== 1) {
        throw new Error('Best-of must be a positive odd integer.');
    }
    if (tournament.gameType === 'chicago' && tournament.bestOf !== 3) {
        throw new Error('Chicago is always best-of three.');
    }
}

function requireRegistration(tournament) {
    if (tournament.status !== 'registration') throw new Error('Registration is closed.');
}

export function createTournament({ id, ownerId, title, date, gameType, bestOf = 3 }) {
    const tournament = {
        id: requireText(id, 'Tournament ID'),
        ownerId: requireText(ownerId, 'Owner ID'),
        title: requireText(title, 'Title'),
        date: requireText(date, 'Date'),
        gameType,
        bestOf: gameType === 'chicago' ? 3 : bestOf,
        status: 'registration',
        registrations: [],
        teams: [],
        matches: [],
        revision: 0,
    };
    validateFormat(tournament);
    return tournament;
}

function normalizeRoster(registrations) {
    if (!Array.isArray(registrations)) throw new Error('Registrations must be a list.');
    const ids = new Set();
    const playerIds = new Set();
    return registrations.map(entry => {
        const id = requireText(entry.id, 'Registration ID');
        if (ids.has(id)) throw new Error('Registration IDs must be unique.');
        ids.add(id);
        // Verified UIDs are supplied by the identity layer, never inferred from a name/email.
        const playerId = entry.playerId ?? null;
        if (playerId !== null) {
            if (requireText(playerId, 'Player ID') !== playerId) throw new Error('Player ID cannot contain surrounding whitespace.');
            if (playerIds.has(playerId)) throw new Error('A verified player can register only once.');
            playerIds.add(playerId);
        }
        if (typeof entry.tag !== 'string' || entry.tag.trim().length > 100) {
            throw new Error('Card / team tags must be strings of at most 100 characters.');
        }
        for (const flag of ['paid', 'checkedIn', 'standby']) {
            if (typeof entry[flag] !== 'boolean') throw new Error('Roster flags must be true or false.');
        }
        return {
            id, playerId, name: requireText(entry.name, 'Player name'), tag: entry.tag.trim(),
            paid: entry.paid, checkedIn: entry.checkedIn, standby: entry.standby,
        };
    });
}

function rosterTeams(registrations, previousTeams = []) {
    const groups = new Map();
    for (const entry of registrations) {
        if (entry.standby || !entry.tag) continue;
        if (!groups.has(entry.tag)) groups.set(entry.tag, []);
        const members = groups.get(entry.tag);
        members.push(entry.id);
        if (members.length > 2) throw new Error(`Team ${entry.tag} already has two players; choose another tag or standby.`);
    }
    return Array.from(groups, ([tag, memberIds]) => {
        // Injective tag-derived IDs survive roster reorder, swaps, removal and re-addition.
        const id = `team-${encodeURIComponent(tag)}`;
        const previous = previousTeams.find(team => team.id === id);
        return { id, name: previous?.name || `Team ${tag}`, memberIds };
    });
}

export function saveRoster(tournament, registrations) {
    requireRegistration(tournament);
    const normalized = normalizeRoster(registrations);
    const teams = rosterTeams(normalized, tournament.teams);
    const next = clone(tournament);
    next.registrations = normalized;
    next.teams = teams;
    next.matches = [];
    next.revision += 1;
    return next;
}

/** Start blockers; payment is tracked but is deliberately not an eligibility rule. */
export function readiness(tournament) {
    const blockers = [];
    if (tournament.status !== 'registration') blockers.push('Registration is closed.');
    if (tournament.matches.length) blockers.push('The bracket has already been generated.');
    try {
        validateFormat(tournament);
        normalizeRoster(tournament.registrations);
        rosterTeams(tournament.registrations);
    } catch (error) {
        blockers.push(error.message);
    }
    if (tournament.teams.length < 2 || tournament.teams.length > 32) {
        blockers.push('Team count must be between 2 and 32.');
    }
    const registrations = new Map(tournament.registrations.map(entry => [entry.id, entry]));
    const assigned = new Set();
    const teamIds = new Set();
    for (const team of tournament.teams) {
        if (!team.id || teamIds.has(team.id)) blockers.push('Team IDs must be unique and nonempty.');
        teamIds.add(team.id);
        if (team.memberIds.length !== 2) blockers.push(`${team.name} must contain exactly two players.`);
        for (const id of team.memberIds) {
            const entry = registrations.get(id);
            if (!entry) blockers.push(`${team.name} has a player not registered in this tournament.`);
            else if (!entry.checkedIn || entry.standby) blockers.push(`${entry.name} must be checked in and not on standby.`);
            if (assigned.has(id)) blockers.push('A player cannot belong to more than one team.');
            assigned.add(id);
        }
    }
    for (const entry of registrations.values()) {
        if (entry.checkedIn && !entry.standby && !assigned.has(entry.id)) {
            blockers.push(`${entry.name} needs a team tag and partner.`);
        }
    }
    return [...new Set(blockers)];
}

function matchSpec(code, bracket, round, position, sourceA, sourceB) {
    return {
        id: code, code, bracket, round, position, sourceA, sourceB,
        teamA: null, teamB: null, status: 'pending',
        winnerId: null, scoreA: null, scoreB: null, forfeit: false,
    };
}

function generateBracket(teamIds) {
    if (teamIds.length < 2 || teamIds.length > 32 || new Set(teamIds).size !== teamIds.length) {
        throw new Error('A bracket needs between 2 and 32 unique teams.');
    }
    const size = 2 ** Math.ceil(Math.log2(teamIds.length));
    let order = [1, 2];
    while (order.length < size) {
        const nextSize = order.length * 2;
        order = order.flatMap(seed => [seed, nextSize + 1 - seed]);
    }
    let upper = order.map(seed => seed <= teamIds.length ? { teamId: teamIds[seed - 1] } : null);
    const matches = [];
    function pair(round, slots, bracket) {
        const winners = [];
        const losers = [];
        for (let index = 0; index < slots.length; index += 2) {
            const a = slots[index];
            const b = slots[index + 1];
            const position = index / 2 + 1;
            const code = `${bracket === 'winners' ? 'W' : 'L'}${round}.${position}`;
            matches.push(matchSpec(code, bracket, round, position, a, b));
            winners.push(a || b ? ref(code, 'winner') : null);
            // Structural byes advance, but never produce a loser or a played win.
            losers.push(a && b ? ref(code, 'loser') : null);
        }
        return [winners, losers];
    }
    let dropped;
    [upper, dropped] = pair(1, upper, 'winners');
    let lower = dropped;
    const rounds = Math.log2(size);
    if (rounds > 1) [lower] = pair(1, dropped, 'losers');
    for (let round = 2; round <= rounds; round += 1) {
        [upper, dropped] = pair(round, upper, 'winners');
        if (round > 2) [lower] = pair(round * 2 - 3, lower, 'losers');
        const reversed = lower.slice().reverse();
        const slots = dropped.flatMap((source, index) => [reversed[index], source]);
        [lower] = pair(round * 2 - 2, slots, 'losers');
    }
    matches.push(matchSpec('GF1', 'final', 1, 1, upper[0], lower[0]));
    matches.push(matchSpec('GF2', 'reset', 2, 1, ref('GF1', 'winner'), ref('GF1', 'loser')));
    return matches;
}

function clearResult(match) {
    match.winnerId = null;
    match.scoreA = null;
    match.scoreB = null;
    match.forfeit = false;
}

function rebuild(tournament) {
    const byCode = new Map(tournament.matches.map(match => [match.code, match]));
    function resolve(source) {
        if (!source) return [true, null];
        if ('teamId' in source) return [true, source.teamId];
        const match = byCode.get(source.matchCode);
        if (!match || !['winner', 'loser'].includes(source.outcome)) throw new Error('Invalid bracket source.');
        if (match.status === 'pending' || match.status === 'ready') return [false, null];
        if (source.outcome === 'winner') return [true, match.winnerId];
        if (match.status !== 'complete') return [true, null];
        return [true, match.winnerId === match.teamA ? match.teamB : match.teamA];
    }
    for (const match of tournament.matches) {
        if (match.code === 'GF2') {
            const gf1 = byCode.get('GF1');
            if (gf1.status === 'complete' && gf1.winnerId === gf1.teamA) {
                match.status = 'void';
                match.teamA = null;
                match.teamB = null;
                clearResult(match);
                continue;
            }
        }
        const [resolvedA, teamA] = resolve(match.sourceA);
        const [resolvedB, teamB] = resolve(match.sourceB);
        match.teamA = teamA;
        match.teamB = teamB;
        if (match.status === 'complete') {
            if (!resolvedA || !resolvedB || !teamA || !teamB || ![teamA, teamB].includes(match.winnerId)) {
                throw new Error(`Completed match ${match.code} has inconsistent sources.`);
            }
            continue;
        }
        clearResult(match);
        if (!resolvedA || !resolvedB) match.status = 'pending';
        else if (!teamA && !teamB) match.status = 'void';
        else if (!teamA || !teamB) {
            match.status = 'bye';
            match.winnerId = teamA || teamB;
        } else match.status = 'ready';
    }
    const gf1 = byCode.get('GF1');
    const gf2 = byCode.get('GF2');
    tournament.status = gf1.status === 'complete' && ['complete', 'void'].includes(gf2.status) ? 'complete' : 'live';
}

export function createPreview(tournament) {
    requireRegistration(tournament);
    const registrations = normalizeRoster(tournament.registrations);
    const teams = rosterTeams(registrations, tournament.teams).filter(team => team.memberIds.length === 2);
    if (teams.length < 2) return { teams, matches: [] };
    const preview = { teams, matches: generateBracket(teams.map(team => team.id)) };
    rebuild(preview);
    return { teams: clone(teams), matches: preview.matches };
}

export function startTournament(tournament) {
    const blockers = readiness(tournament);
    if (blockers.length) throw new Error(blockers.join('\n'));
    const next = clone(tournament);
    const teamIds = next.teams.map(team => team.id);
    for (let index = teamIds.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [teamIds[index], teamIds[other]] = [teamIds[other], teamIds[index]];
    }
    next.matches = generateBracket(teamIds);
    rebuild(next);
    next.revision += 1;
    return next;
}

function hasPlayedDescendant(matches, code) {
    const descendants = new Set([code]);
    // The generated list is topological, including paths through structural byes.
    for (const match of matches) {
        if ([match.sourceA, match.sourceB].some(source => source && descendants.has(source.matchCode))) {
            if (match.status === 'complete') return true;
            descendants.add(match.code);
        }
    }
    return false;
}

export function recordResult(tournament, matchId, { winnerId, scoreA = null, scoreB = null, forfeit = false }) {
    if (!['live', 'complete'].includes(tournament.status)) throw new Error('The tournament has not started.');
    validateFormat(tournament);
    const match = tournament.matches.find(item => item.id === matchId);
    if (!match || !['ready', 'complete'].includes(match.status)) {
        throw new Error('Only ready or safely correctable complete matches can be recorded.');
    }
    if (match.status === 'complete' && hasPlayedDescendant(tournament.matches, match.code)) {
        throw new Error('This result cannot be corrected because a dependent match already has a result.');
    }
    if (!winnerId || !match.teamA || !match.teamB || ![match.teamA, match.teamB].includes(winnerId)) {
        throw new Error('Winner must be one of the two teams in the match.');
    }
    if (typeof forfeit !== 'boolean') throw new Error('Forfeit must be true or false.');
    if (forfeit) {
        if (scoreA !== null || scoreB !== null) throw new Error('Forfeits cannot include scores.');
    } else {
        const threshold = Math.floor(tournament.bestOf / 2) + 1;
        const winnerScore = winnerId === match.teamA ? scoreA : scoreB;
        const loserScore = winnerId === match.teamA ? scoreB : scoreA;
        if (!Number.isSafeInteger(scoreA) || !Number.isSafeInteger(scoreB) || scoreA < 0 || scoreB < 0 ||
            winnerScore !== threshold || loserScore >= threshold) {
            throw new Error('Leg scores must match the winner and tournament best-of length.');
        }
    }
    const next = clone(tournament);
    Object.assign(next.matches.find(item => item.id === matchId), {
        status: 'complete', winnerId, scoreA, scoreB, forfeit,
    });
    rebuild(next);
    next.revision += 1;
    return next;
}
