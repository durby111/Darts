// A changed revision does not prove why a write was denied. Preserve the denial
// code and original cause; diagnostic reads must never trigger another write.
export async function explainRevisionDenial(error, { expectedRevision, readCurrentRevision, assertSession }) {
    if (error?.code !== 'permission-denied' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return error;
    try {
        assertSession();
        const currentRevision = await readCurrentRevision();
        assertSession();
        if (!Number.isSafeInteger(currentRevision) || currentRevision <= expectedRevision) return error;
        return Object.assign(new Error(
            'The write was denied. This tournament has also changed on another device. Reload before trying again; if the write is still denied, check your account access.',
            { cause: error }
        ), { code: error.code, revisionChanged: true, expectedRevision, currentRevision });
    } catch {
        // Failed authorization, offline diagnostics or a changed session cannot
        // establish a safe revision hint. Keep the original error unchanged.
        return error;
    }
}
