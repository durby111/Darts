import { BACKEND_KEY } from '../backend-context.js';
// Device-local observation only: never a cross-device lock or cloud match status.
export function activeScorerMatch(tournament, localOnly, storage) {
    try {
        const game = JSON.parse(storage.getItem(localOnly ? 'blakeout_dev_local_active_game' : 'blakeout_dev_active_game'));
        const session = game?.tournament;
        if (!session || session.tournamentId !== tournament.id || !!session.localOnly !== !!localOnly
            || (!localOnly && session.backendKey !== BACKEND_KEY)
            || !['scoring', 'pending', 'saving'].includes(session.status)) return null;
        const match = tournament.matches.find(item => item.id === session.matchId && item.status === 'ready');
        if (!match || session.teams?.[0]?.id !== match.teamA || session.teams?.[1]?.id !== match.teamB) return null;
        return match.id;
    } catch { return null; }
}
