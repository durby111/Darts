/* Load current feature markup and modules, exchanging only their transport for
   memory fixtures. The real feature bootstrap/availability flags are untouched. */
import { PREVIEW_ONLY, SCENARIOS, configurePreview } from './fixture-platform.js';
import { SCORE_SKINS, applyScoreAppearance } from '../js/score-appearance.js';

if (PREVIEW_ONLY !== true || typeof import.meta.resolve !== 'function'
    || import.meta.resolve('../js/platform.js') !== new URL('./fixture-platform.js', import.meta.url).href) {
    throw Error('This browser could not verify the sample import map. No feature was loaded.');
}
const $ = id => document.getElementById(id);
const page = document.body.dataset.previewPage;
if (!Object.hasOwn(SCENARIOS, page)) throw Error('Unknown sample page.');
const params = new URLSearchParams(location.search);
const scenario = configurePreview({ page, selectedScenario: params.get('scenario') });
const previewRoot = new URL('./', import.meta.url);
const scorerURL = new URL('../', previewRoot);
const templateURL = new URL(`../${page}/index.html`, previewRoot);
const blockedButtons = new Set(['passwordSignIn', 'passwordRegister', 'passwordReset', 'sendLink', 'completeLink', 'sendVerification', 'refreshVerification', 'exportRecords', 'launchScorer']);
const blockedForms = new Set(['passwordForm', 'emailForm']);
const credentials = ['accountEmail', 'accountPassword', 'linkEmail'];
let featureReady = false;
const themes = { blue: 'Classic', red: 'Crimson', neon: 'Neon', sunburst: 'Sunburst', volt: 'Volt', inferno: 'Inferno', miami: 'Miami', grape: 'Grape', aqua: 'Aqua', royal: 'Royal', shamrock: 'Shamrock', arctic: 'Arctic' };

function sampleNotice(text) { $('previewActionStatus').textContent = text; }
function disabledReason(id) {
    return id === 'launchScorer' ? 'Scorer launch is disabled in this preview. Try a sample manual result instead.'
        : id === 'exportRecords' ? 'Downloads are disabled so invented records cannot be mistaken for real results.'
            : 'Credentials and email actions are disabled. Use the sample-state selector above.';
}

// Capture before the real UI attaches listeners, including synthetic submissions.
// The disabled property is visual reinforcement, not the only safety boundary.
document.addEventListener('submit', event => {
    if ((!featureReady && $('previewContent').contains(event.target)) || blockedForms.has(event.target.id)) {
        event.preventDefault(); event.stopImmediatePropagation();
        sampleNotice(disabledReason(event.target.id));
    }
}, true);
document.addEventListener('click', event => {
    const target = event.target.closest?.('button, a');
    if (!target) return;
    if (!featureReady && $('previewContent').contains(target)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (blockedButtons.has(target.id)) {
        event.preventDefault(); event.stopImmediatePropagation();
        sampleNotice(disabledReason(target.id));
        return;
    }
    if (target.tagName !== 'A') return;
    const url = new URL(target.getAttribute('href') || '', location.href);
    const preview = url.origin === previewRoot.origin && url.pathname.startsWith(previewRoot.pathname);
    const back = target.dataset.leavePreview === 'true' && url.href === scorerURL.href;
    if (!preview && !back) {
        event.preventDefault(); event.stopImmediatePropagation();
        sampleNotice('This link is unavailable in the sample preview. Use its preview navigation or Back to scoring.');
    }
}, true);

function normalizeText(value) {
    return value
        .replace(/Signed in with a verified email address\./g, 'Simulated verified identity. No authentication occurred.')
        .replace(/Verified account connected\./g, 'Simulated verified identity selected.')
        .replace(/You are signed in, but your email is not verified\./g, 'This is the simulated unverified state.')
        .replace(/\bcloud\b/gi, 'sample memory')
        .replace(/\bserver\b/gi, 'sample adapter')
        .replace(/Check Firebase setup below if configuration or permissions are unavailable\./g, 'Choose another sample scenario to retry.')
        .replace(/Connecting to Firebase…/g, 'Loading sample identity…');
}
function guardDOM(root = document) {
    for (const id of credentials) {
        const field = $(id);
        if (!field) continue;
        field.disabled = true; field.readOnly = true;
        field.type = 'text'; field.removeAttribute('name');
        field.removeAttribute('autocomplete'); field.removeAttribute('required');
        field.value = ''; field.placeholder = 'Disabled in preview · no real credentials';
    }
    for (const id of blockedButtons) {
        const button = $(id);
        if (!button) continue;
        if (!button.disabled) button.disabled = true;
        if (button.title !== disabledReason(id)) button.title = disabledReason(id);
        if (!button.hasAttribute('aria-describedby')) button.setAttribute('aria-describedby', 'previewRestrictions');
    }
    for (const status of document.querySelectorAll('#accountStatus, #message, #accountNotice, #draftStatus, #guestJoinHelp, #joinHelp, #startFeedbackTitle')) {
        if (status.textContent && !status.textContent.startsWith('Sample · ')) status.textContent = 'Sample · ' + status.textContent;
    }
    for (const message of document.querySelectorAll('.platform-confirm-message')) {
        const prefix = 'Preview · sample data · nothing is saved or sent. ';
        if (!message.textContent.startsWith(prefix)) message.textContent = prefix + message.textContent;
    }
    // Module status messages keep their shape but cannot suggest real persistence.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.parentElement?.closest('script, style, #previewTools')) continue;
        const next = normalizeText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
    }
}
function prepareTemplate(fragment) {
    // Fetched HTML is data only. Never bring bootstrap, resource or event handlers.
    fragment.querySelectorAll('script, style, link, iframe, object, embed, base, meta').forEach(node => node.remove());
    for (const element of fragment.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            if (/^on/i.test(attribute.name) || ['src', 'srcset', 'poster', 'action', 'formaction'].includes(attribute.name)) element.removeAttribute(attribute.name);
        }
    }
    for (const link of fragment.querySelectorAll('a[href]')) {
        const original = new URL(link.getAttribute('href'), templateURL);
        if (original.pathname === scorerURL.pathname) {
            link.href = scorerURL.href;
            link.dataset.leavePreview = 'true';
            link.textContent = 'Back to scoring (leave preview)';
        } else if (/\/accounts\/$/.test(original.pathname)) link.href = new URL('./accounts/', previewRoot).href;
        else if (/\/brackets\/$/.test(original.pathname)) link.href = new URL('./brackets/', previewRoot).href;
        else link.removeAttribute('href');
    }
    if (page === 'accounts') {
        const main = fragment.querySelector('main');
        main.querySelector('h1').textContent = 'Players & Records · sample account';
        main.querySelector('h1 + p').textContent = 'Explore the current account layout with invented identities and results. “Verified” and “unverified” are simulated UI states; this preview does not authenticate anyone or demonstrate live account readiness.';
        fragment.querySelector('#signInPanel > p').textContent = 'Choose a sample state above. Real email addresses and passwords cannot be entered here.';
        fragment.querySelector('#emailLinkPanel').hidden = true;
        fragment.querySelector('#profilePanel h2').textContent = 'Sample profile';
        fragment.querySelector('#recordsPanel h2').textContent = 'Sample recorded matches';
        fragment.querySelector('#recordsPanel > p').textContent = 'Invented tournament and casual records exercise the current counters and layout. They are not real player statistics. Downloads are disabled.';
        for (const paragraph of fragment.querySelectorAll('#verificationPanel > p:not(#verificationIdentity)')) paragraph.textContent = 'Sample unverified state only. No account was created and no email can be sent. Choose Verified sample above to inspect the profile and records layout.';
        main.querySelector(':scope > details')?.remove();
        fragment.querySelector('#exportRecords').textContent = 'Sample exports disabled';
    } else {
        fragment.querySelector('h1 + p').textContent = 'Invented doubles events · 2–32 teams · edits and results exist only until you leave or reload';
        fragment.querySelector('#refresh').textContent = 'Refresh sample data';
        fragment.querySelector('#launchScorer').textContent = 'Scorer launch disabled in preview';
    }
    return fragment;
}

for (const item of SCENARIOS[page]) {
    const option = new Option(item.replaceAll('-', ' '), item);
    $('previewScenario').append(option);
}
$('previewScenario').value = scenario;
function scenarioURL() {
    const url = new URL(location.href);
    url.search = ''; url.hash = '';
    url.searchParams.set('scenario', $('previewScenario').value);
    if (page === 'brackets' && !['empty', 'loading', 'error'].includes($('previewScenario').value)) url.searchParams.set('id', 'sample-cup');
    return url;
}
$('previewScenario').addEventListener('change', () => location.assign(scenarioURL().href));
$('previewReset').addEventListener('click', () => location.assign(scenarioURL().href));
for (const [value, label] of Object.entries(themes)) $('previewTheme').append(new Option(label, value));
let theme = 'blue';
try { const saved = localStorage.getItem('blakeout_theme'); if (Object.hasOwn(themes, saved)) theme = saved; } catch { /* read-only preference unavailable */ }
document.documentElement.dataset.theme = theme;
$('previewTheme').value = theme;
$('previewTheme').addEventListener('change', () => { document.documentElement.dataset.theme = $('previewTheme').value; });
for (const skin of SCORE_SKINS) $('previewStyle').append(new Option(skin.label, skin.id));
$('previewStyle').value = applyScoreAppearance();
$('previewStyle').addEventListener('change', () => applyScoreAppearance($('previewStyle').value));

const response = await fetch(templateURL.href, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
if (!response.ok) throw Error('The current DEV template is unavailable. No feature was started.');
const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
const template = parsed.getElementById('featurePageTemplate');
if (!template?.content || !template.content.querySelector('main')) throw Error('The current DEV template is missing.');
$('previewContent').inert = true;
$('previewContent').replaceChildren(prepareTemplate(template.content.cloneNode(true)));
guardDOM();
const observer = new MutationObserver(() => {
    // Disconnect while normalizing to avoid an attribute-observer feedback loop.
    observer.disconnect(); guardDOM(); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'type', 'readonly', 'name'] });
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'type', 'readonly', 'name'] });
if (page === 'brackets' && !params.has('id') && !['empty', 'loading', 'error'].includes(scenario)) {
    const url = new URL(location.href); url.searchParams.set('id', 'sample-cup'); history.replaceState(null, '', url.href);
}
await import(page === 'accounts' ? '../js/accounts-page.js' : '../js/brackets/page.js');
featureReady = true;
$('previewContent').inert = false;
guardDOM();
$('previewBootStatus').hidden = true;
