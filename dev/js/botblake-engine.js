// Pure dart simulation. Inject RNG for reproducible tests; no network or AI service.
export const LEVELS = { easy: .25, medium: .45, hard: .65, expert: .85 };
export const SUPPORTED_CRICKET = ['cricket', 'spanish', 'cutthroat'];
export function supportsBot(type) {
    return /^\d+01$/.test(type) || SUPPORTED_CRICKET.includes(type);
}
export function strength(state, bot) {
    if (bot.skill !== 'auto') return LEVELS[bot.skill] ?? LEVELS.medium;
    const humans = (state.teamMode ? state.teams.flatMap(t => t.members) : state.players).filter(p => !p.bot);
    let sum = 0, turns = 0;
    for (const p of humans) {
        if (state.teamMode) { sum += p.practice?.[SUPPORTED_CRICKET.includes(state.type) ? 'marks' : 'points'] || 0; turns += p.practice?.turns || 0; continue; }
        if (SUPPORTED_CRICKET.includes(state.type)) { sum += p.totalMarks; turns += p.throws; }
        else for (const h of p.history) { sum += typeof h === 'number' ? h : h.bust ? 0 : h.score || 0; turns++; }
    }
    return turns ? Math.max(.04, Math.min(.95, (SUPPORTED_CRICKET.includes(state.type) ? sum / turns / 6.9 : (sum / turns - 4.5) / 133.5))) : LEVELS.medium;
}
export function throwDart(target, skill, rng = Math.random) {
    const roll = rng();
    if (roll >= skill) {
        // A miss can land in an adjacent wedge, or outside the board.
        const wheel = [20,1,18,4,13,6,10,15,2,17,3,19,7,16,8,11,14,9,12,5];
        const i = wheel.indexOf(target.n);
        if (i < 0 || rng() < .5) return { n: 0, m: 1 };
        return { n: wheel[(i + (rng() < .5 ? 1 : 19)) % 20], m: 1 };
    }
    return { n: target.n, m: roll < skill * .65 ? target.m : 1 };
}
const value = d => d.n * d.m;
const double = d => d.m === 2;
const segments = [ { n: 25, m: 2 }, ...Array.from({length:20}, (_,i)=>({n:20-i,m:2})), ...[3,1].flatMap(m=>Array.from({length:20},(_,i)=>({n:20-i,m}))), {n:25,m:1} ];
const routes = new Map();
function route(score, darts, open) {
    if (score > darts * 60 || score < 1) return null;
    const key = `${score}/${darts}/${open}`;
    if (routes.has(key)) return routes.get(key);
    const result = findRoute(score, darts, open); routes.set(key, result); return result;
}
function findRoute(score, darts, open) {
    const finish = segments.find(d => value(d) === score && (open || double(d)));
    if (finish) return finish;
    if (darts <= 1) return null;
    for (const d of segments) if (score > value(d) && route(score-value(d), darts-1, open)) return d;
    return null;
}
export function x01Turn(state, rng = Math.random, bot = activeBot(state)) {
    const player = state.players[state.currentPlayer];
    const skill = strength(state, bot);
    let remaining = player.score;
    let opened = state.finishType !== 'double-in-out' || player.history.some(h => (typeof h === 'number' ? h : h.bust ? 0 : h.score) > 0);
    const openOut = state.finishType === 'open';
    const darts = [];
    for (let i=0;i<3;i++) {
        const target = !opened ? {n:20,m:2} : route(remaining,3-i,openOut) || (remaining > 60 ? {n:20,m:3} : {n:Math.max(1,Math.min(20,remaining-32)),m:1});
        const dart = throwDart(target,skill,rng); darts.push(dart);
        if (!opened) { if (!double(dart)) continue; opened = true; }
        remaining -= value(dart);
        if (remaining < 0 || (!openOut && (remaining === 1 || (remaining === 0 && !double(dart))))) return {score:0,bust:true,opened,darts};
        if (!remaining) break;
    }
    return {score:player.score-remaining,bust:false,opened,darts};
}
export function cricketTurn(state, rng = Math.random, bot = activeBot(state)) {
    const player = state.players[state.currentPlayer];
    const marks = Object.fromEntries(state.cricketTargets.map(t=>[t,player.cricketData[t].marks]));
    const skill = strength(state,bot), darts=[];
    // Planning uses projected scores, leaving actual scoring to cricket.js.
    const opponents = state.players.filter(p=>p!==player).map(p=>({ score:p.score, cricketData:p.cricketData }));
    let projectedScore = player.score;
    const cutthroat = state.type === 'cutthroat';
    for(let i=0;i<3;i++) {
        const behind = state.cricketPoints && opponents.some(p=>cutthroat ? p.score<projectedScore : p.score>projectedScore);
        const scoring = state.cricketTargets.find(t=>marks[t]>=3 && opponents.some(p=>
            !p.cricketData[t].closed && (!cutthroat || !behind || p.score<projectedScore)));
        const target = (behind && scoring) || state.cricketTargets.find(t=>marks[t]<3) || scoring;
        if (!target) break;
        const d=throwDart({n:target==='Bull'?25:Number(target),m:target==='Bull'?2:3},skill,rng);
        const landed = d.n === 25 ? 'Bull' : String(d.n);
        darts.push({target:state.cricketTargets.includes(landed)?landed:'MISS',multiplier:d.m});
        if(state.cricketTargets.includes(landed)) {
            const before = marks[landed];
            marks[landed] += d.m;
            const excess = Math.max(0,marks[landed]-3)-Math.max(0,before-3);
            if (state.cricketPoints && excess) {
                const points = excess * d.n;
                if (cutthroat) opponents.forEach(p=>{ if (!p.cricketData[landed].closed) p.score+=points; });
                else if (opponents.some(p=>!p.cricketData[landed].closed)) projectedScore+=points;
            }
        }
    }
    return darts;
}

export function activeBot(state) {
    const side = state.teams?.[state.currentPlayer];
    return (state.teamMode ? side?.members[side.rotationIndex % side.members.length] : state.players[state.currentPlayer])?.bot;
}
export function hasBots(state) {
    return state.players.some(p => p.bot) || !!state.teams?.some(t => t.members.some(p => p.bot));
}
// Called within the scorer's existing undo transaction, before team rotation.
export function recordPracticeTurn(state, points, marks = 0) {
    if (!hasBots(state)) return;
    const side = state.teams?.[state.currentPlayer];
    const person = state.teamMode ? side.members[side.rotationIndex % side.members.length] : state.players[state.currentPlayer];
    if (person.bot) return;
    person.practice ||= { turns: 0, points: 0, marks: 0 };
    person.practice.turns++; person.practice.points += points; person.practice.marks += marks;
}
