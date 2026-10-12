// Release switches, not a security boundary. Enable only after the isolated
// project/provider and its approved-domain behavior have been verified.
export const ACCOUNT_PROVIDER_PROJECT = 'blakeout-darts-dev';
export const ACCOUNT_PROVIDERS = Object.freeze({
    google: Object.freeze({ enabled: false, redirectEnabled: false }),
    apple: Object.freeze({ enabled: false, redirectEnabled: false })
});
