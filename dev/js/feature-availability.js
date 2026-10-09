/* Release availability, not an authorization/security boundary. Existing
   records and feature implementations stay intact while these areas are paused. */
export const FEATURE_AVAILABILITY = Object.freeze({
    brackets: false,
    accounts: false
});

export function isFeatureAvailable(feature) {
    return FEATURE_AVAILABILITY[feature] === true;
}

export function featureLabel(feature) {
    return feature === 'brackets' ? 'Brackets' : 'Players & Records';
}
