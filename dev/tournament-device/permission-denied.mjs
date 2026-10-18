/** Strict test-only Firebase denial matcher, including Playwright-wrapped errors. */
export function isPermissionDenied(error) {
 if (!error || typeof error !== 'object') return false;
 if (typeof error.code === 'string' && error.code.length) {
  const code=error.code.toLowerCase().replaceAll('_','-');
  return code==='permission-denied' || code==='firestore/permission-denied';
 }
 if (typeof error.message !== 'string') return false;
 return /(?:^|\bFirebaseError:\s*)permission[-_]denied(?=\s|:|\.|$)/i.test(error.message);
}
