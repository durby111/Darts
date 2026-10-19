/* Real-provider availability, not an authorization/security boundary.
   DEV navigation opens the separate interactive sample test surfaces below;
   those do not unlock authentication, cloud records or tournament writes. */
export const FEATURE_AVAILABILITY = Object.freeze({
    brackets: false,
    accounts: true,
    history: false
});

export function isFeatureAvailable(feature) {
    return FEATURE_AVAILABILITY[feature] === true;
}

export function featureLabel(feature) {
    return feature === 'brackets' ? 'Brackets' : 'Players & Records';
}

// Relative to the DEV root. Never forward real event IDs or email-action tokens.
export const FEATURE_TEST_ROUTES = Object.freeze({
    brackets: 'preview/brackets/',
    accounts: 'preview/accounts/'
});

export function featureTestPath(feature) {
    return Object.hasOwn(FEATURE_TEST_ROUTES, feature) ? FEATURE_TEST_ROUTES[feature] : null;
}
