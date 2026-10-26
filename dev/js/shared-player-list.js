// Participation labels only: this module is not a server authorization boundary.
export function createPlayerVisit() {
    let owner = null; const players = new Map();
    return {
        setOwner(id) { if (id !== owner) { owner = id; players.clear(); } },
        add(player, expectedOwner) {
            if (!owner || owner !== expectedOwner || !player || !/^[A-Za-z0-9_-]{1,128}$/.test(player.id)
                || !player.name?.trim() || player.name.length > 40) return false;
            players.set(player.id, Object.freeze({ id: player.id, name: player.name.trim() })); return true;
        },
        remove(id) { players.delete(id); },
        clear() { players.clear(); },
        list() { return [...players.values()].map(p => ({ ...p })); }
    };
}
