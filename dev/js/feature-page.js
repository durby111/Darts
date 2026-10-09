import { isFeatureAvailable } from './feature-availability.js';
import './feature-appearance.js';

// Feature markup lives in an inert template. A locked or failed-to-load
// entrypoint never starts auth, consumes an email link, or starts polling.
const feature = document.body.dataset.appFeature;
const modulePath = feature === 'accounts' ? './accounts-page.js'
    : feature === 'brackets' ? './brackets/page.js' : null;
if (modulePath && isFeatureAvailable(feature)) {
    const template = document.getElementById('featurePageTemplate');
    const shell = document.getElementById('featureUnavailableShell');
    if (template && shell) {
        shell.replaceWith(template.content.cloneNode(true));
        template.remove();
        import(modulePath).catch(() => {
            const notice = document.createElement('p');
            notice.className = 'platform-notice platform-error';
            notice.setAttribute('role', 'alert');
            notice.textContent = 'This section could not load. Return to scoring or try again later.';
            document.querySelector('main')?.prepend(notice);
        });
    }
}
