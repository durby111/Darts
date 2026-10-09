/* Classic bootstrap intentionally runs before any feature module is requested.
   Unsupported or altered import maps must fail closed, never fall back to live. */
(() => {
    const status = document.getElementById('previewBootStatus');
    const source = document.currentScript?.src;
    try {
        if (!source || !HTMLScriptElement.supports?.('importmap')) {
            throw Error('This browser cannot safely load the sample preview. Use a current browser; the real features remain locked.');
        }
        const root = new URL('./', source);
        const mapping = JSON.parse(document.getElementById('previewImportMap').textContent);
        const entries = Object.entries(mapping.imports || {});
        if (Object.keys(mapping).length !== 1 || !Object.hasOwn(mapping, 'imports')
            || entries.length !== 1 || typeof entries[0][1] !== 'string' || new URL(entries[0][0], location.href).href !== new URL('../js/platform.js', root).href
            || new URL(entries[0][1], location.href).href !== new URL('./fixture-platform.js', root).href) {
            throw Error('The sample adapter could not be verified. No feature was loaded.');
        }
        import(new URL('./preview.js', root).href).catch(error => {
            status.hidden = false;
            status.textContent = `Preview unavailable: ${error.message}`;
            status.setAttribute('role', 'alert');
        });
    } catch (error) {
        status.textContent = error.message;
        status.setAttribute('role', 'alert');
    }
})();
