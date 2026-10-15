import '../js/feature-appearance.js';
if (import.meta.resolve('../js/platform.js') !== new URL('./platform.js', import.meta.url).href)
    throw Error('Local adapter mapping is unavailable. Tournament not opened.');
try {
    const response = await fetch(new URL('../brackets/index.html', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw Error('Tournament template unavailable.');
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    const content = parsed.querySelector('#featurePageTemplate').content.cloneNode(true);
    content.querySelectorAll('script').forEach(node => node.remove());
    content.querySelectorAll('a[href]').forEach(link => {
        link.href = new URL(link.getAttribute('href'), new URL('../brackets/', import.meta.url)).href;
    });
    content.querySelector('nav [aria-current]').href = './';
    content.querySelector('h1 + p').textContent = 'Device-local DEV · double elimination · saved in this browser only. No accounts, cloud writes or cross-device sync. Clearing browser storage removes these tournaments.';
    content.querySelector('#refresh').textContent = 'Reload saved tournaments';
    content.querySelector('#lockedNote').textContent = 'Roster locked. Byes do not count as played wins. Corrections are allowed only before any dependent match is played; original scorer records are retained separately.';
    content.querySelectorAll('.join-panel').forEach(node => { node.hidden = true; });
    document.querySelector('#localContent').append(content);
    await import('../js/brackets/page.js');
    document.querySelector('#localBoot').remove();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {
        const warning = document.createElement('p');
        warning.textContent = 'Offline page caching is unavailable. Local saves still require browser storage; keep a connection when reopening pages.';
        document.querySelector('main').prepend(warning);
    });
} catch (error) { document.querySelector('#localBoot').textContent = `Could not open local tournaments: ${error.message}`; }
