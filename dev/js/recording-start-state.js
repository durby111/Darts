// UI prerequisite only: the handler must still verify account and profiles online.
export function recordingStartProblem({ loading, ownerId, profileIds, selectedIds }) {
    if (loading) return 'Checking verified profiles…';
    if (!ownerId) return 'Sign in and verify your email address on the Accounts page, then reload verified profiles. You can also play without recording.';
    const linked = selectedIds.filter(Boolean);
    if (!linked.length) return 'Choose at least one verified player profile, or choose Play without recording. Guests alone do not create verified player statistics.';
    if (new Set(linked).size !== linked.length) return 'A verified player may occupy only one human slot.';
    if (linked.some(id => !profileIds.has(id))) return 'A selected profile is unavailable. Reload verified profiles.';
    return '';
}
