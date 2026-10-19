// Deterministic bounded directory reads. Auth/session checks belong to platform.
export async function readProfilePage(db, sdk, collectionName, cursor = null) {
    if (cursor !== null && (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(cursor))) throw new Error('Invalid profile page cursor.');
    const constraints = [sdk.orderBy(sdk.documentId()), sdk.limit(50)];
    if (cursor !== null) constraints.push(sdk.startAfter(cursor));
    const snapshot = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, collectionName), ...constraints));
    const profiles = snapshot.docs.map(item => ({ id: item.id, name: item.data().name }));
    return { profiles, nextCursor: profiles.length === 50 ? profiles.at(-1).id : null };
}
