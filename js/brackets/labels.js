// View-only labels within one event snapshot. IDs remain the identity keys.
// No signup rejection, profile rename, private flags or persistent alias fields.
const nameKey = name => String(name).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

export function registrationLabels(registrations) {
    const groups = new Map();
    for (const entry of registrations) {
        const key = nameKey(entry.name);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }
    // Reserve literal names too: an existing "(1) Alex" keeps its name.
    const used = new Set(registrations.map(entry => nameKey(entry.name)));
    const labels = new Map();
    for (const key of [...groups.keys()].sort()) {
        const entries = groups.get(key).slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        let number = 1;
        for (const entry of entries) {
            let label = entry.name;
            if (entries.length > 1) {
                do { label = `(${number++}) ${entry.name.trim()}`; }
                while (used.has(nameKey(label)));
                used.add(nameKey(label));
            }
            labels.set(entry.id, label);
        }
    }
    return labels;
}
