"""Test-only route mock for preserved future account/bracket regression suites.

The actual shipped module has both flags false. Never expose a URL, storage
switch or app UI bypass; this helper is only installed by a local test runner.
"""
ENABLED_FEATURE_MODULE = '''
export const FEATURE_AVAILABILITY = Object.freeze({brackets:true, accounts:true});
export const isFeatureAvailable = feature => FEATURE_AVAILABILITY[feature] === true;
export const featureLabel = feature => feature === 'brackets' ? 'Brackets' : 'Players & Records';
'''

async def enable_future_features(context):
    await context.route('**/js/feature-availability.js', lambda route: route.fulfill(
        status=200, content_type='text/javascript', body=ENABLED_FEATURE_MODULE))
