import { CLOUD_RESUME_ENABLED } from './cloud-resume-config.js';
import { BACKEND_KEY } from './backend-context.js';
export function cloudResumeAvailable() {
    return CLOUD_RESUME_ENABLED && ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname)
        && /^demo-[a-z0-9-]+:/.test(BACKEND_KEY);
}
export function requireCloudResume() {
    if (!cloudResumeAvailable()) throw new Error('Cloud resume is disabled outside the isolated local candidate.');
}
export function encodeActiveSnapshot(snapshot) {
    const data = JSON.stringify(snapshot);
    if (!data || new TextEncoder().encode(data).length > 450000) throw new Error('Active game is too large to sync safely. Local recovery is retained.');
    decodeActiveSnapshot(data);
    return data;
}
export function decodeActiveSnapshot(data) {
    if (typeof data !== 'string' || new TextEncoder().encode(data).length > 450000) throw new Error('Invalid active game payload.');
    const s = JSON.parse(data, (key, value) => {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe active game field.');
        return value;
    });
    if (!s || !/^(301|501|701|801|901|1101|1501|cricket|spanish|minnesota|chaos|quickie|cutthroat|wildcard|hammer|teamhammer|chicago|121|baseball|bermuda|golf|shanghai|countup|gotcha|sharktank|tictactoe|robinhood|doubledown|teamcricket)$/.test(s.type)
        || !Array.isArray(s.players) || !s.players.length || s.players.length > 128
        || s.players.some(p => !p || typeof p.name !== 'string' || p.name.length > 160 || !Number.isFinite(p.score))
        || !Number.isInteger(s.currentPlayer) || s.currentPlayer < 0 || s.currentPlayer >= s.players.length
        || typeof s.currentInput !== 'string' || s.currentInput.length > 256
        || !Array.isArray(s.pendingDarts) || !Array.isArray(s.undoHistory) || !Array.isArray(s.redoHistory)) throw new Error('Invalid active game snapshot.');
    if (s.tournament?.localOnly) throw new Error('Device-only tournaments stay on this device.');
    return s;
}
