// View-only interaction. The browser's scroll range keeps the bracket in bounds.
const views = new WeakMap();
const MAX_SCALE = 2.5, PADDING = 16, DRAG_THRESHOLD = 5;

export function diagramViewport(host) {
    if (views.has(host)) return views.get(host);
    let canvas, spacer, width = 0, height = 0, key;
    let scale = 1, fitMode = true, offsetX = PADDING, offsetY = PADDING;
    let controls = {}, dragging = false, suppressClickUntil = 0, savedWorld;
    const pointers = new Map();
    const size = () => ({ width: host.clientWidth, height: host.clientHeight });
    const fitScale = () => {
        const box = size();
        return width && height && box.width && box.height
            ? Math.min(1, Math.max(1, box.width - PADDING * 2) / width,
                Math.max(1, box.height - PADDING * 2) / height) : 1;
    };
    const minimumScale = () => Math.min(.1, fitScale());
    const point = event => {
        const rect = host.getBoundingClientRect();
        return { x: event.clientX - rect.left - host.clientLeft, y: event.clientY - rect.top - host.clientTop };
    };
    const center = () => ({ x: host.clientWidth / 2, y: host.clientHeight / 2 });
    const worldPoint = anchor => ({
        x: (host.scrollLeft + anchor.x - offsetX) / scale,
        y: (host.scrollTop + anchor.y - offsetY) / scale,
    });
    const updateControls = () => {
        const empty = !canvas;
        for (const control of Object.values(controls)) if (control && 'disabled' in control) control.disabled = empty;
        if (controls.zoomOut) controls.zoomOut.disabled = empty || scale <= minimumScale() + .0001;
        if (controls.zoomIn) controls.zoomIn.disabled = empty || scale >= MAX_SCALE - .0001;
        if (controls.label) controls.label.textContent = empty ? 'No bracket' : `${Math.round(scale * 100)}%${fitMode ? ' · fit' : ''}`;
        if (controls.select) {
            const custom = controls.select.querySelector('[data-custom-scale]');
            if (custom) custom.remove();
            const value = fitMode ? 'fit' : String(scale);
            if (![...controls.select.options].some(option => Number(option.value) === scale) && !fitMode) {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = `${Math.round(scale * 100)}%`;
                option.dataset.customScale = '';
                controls.select.append(option);
            }
            controls.select.value = value;
        }
    };
    const layout = () => {
        if (!canvas) { updateControls(); return; }
        const box = size();
        offsetX = Math.max(PADDING, (box.width - width * scale) / 2);
        offsetY = Math.max(PADDING, (box.height - height * scale) / 2);
        spacer.style.width = `${Math.max(box.width, width * scale + PADDING * 2)}px`;
        spacer.style.height = `${Math.max(box.height, height * scale + PADDING * 2)}px`;
        canvas.style.left = `${offsetX}px`;
        canvas.style.top = `${offsetY}px`;
        canvas.style.transform = `scale(${scale})`;
        host.dataset.zoom = String(scale);
        updateControls();
    };
    const zoomTo = (value, anchor = center()) => {
        if (!canvas) return;
        const world = worldPoint(anchor);
        const nextFit = value === 'fit';
        const requested = nextFit ? fitScale() : Number(value);
        if (!Number.isFinite(requested) || requested <= 0) return;
        fitMode = nextFit;
        scale = Math.max(minimumScale(), Math.min(MAX_SCALE, requested));
        layout();
        host.scrollLeft = fitMode ? 0 : world.x * scale + offsetX - anchor.x;
        host.scrollTop = fitMode ? 0 : world.y * scale + offsetY - anchor.y;
    };
    const zoomBy = (factor, anchor) => zoomTo(scale * factor, anchor);
    const pan = (x, y) => {
        host.scrollLeft += x;
        host.scrollTop += y;
    };
    const reveal = target => {
        if (!canvas || !target) return;
        // A source jump should reveal a readable match, even from a tiny overview.
        if (scale < .75) zoomTo(1);
        const rect = target.getBoundingClientRect(), box = host.getBoundingClientRect();
        pan(rect.left - box.left - host.clientLeft + rect.width / 2 - host.clientWidth / 2,
            rect.top - box.top - host.clientTop + rect.height / 2 - host.clientHeight / 2);
        target.focus({ preventScroll: true });
    };
    const endGesture = event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.delete(event.pointerId);
        if (host.hasPointerCapture?.(event.pointerId)) host.releasePointerCapture(event.pointerId);
        if (dragging) suppressClickUntil = Date.now() + 500;
        if (!pointers.size) {
            dragging = false;
            host.classList.remove('is-panning');
        }
    };
    const cancelGesture = () => {
        for (const pointerId of [...pointers.keys()]) endGesture({ pointerId });
    };
    host.addEventListener('pointerdown', event => {
        if (!canvas || (event.pointerType !== 'touch' && event.button !== 0)) return;
        const position = point(event);
        pointers.set(event.pointerId, { ...position, startX: position.x, startY: position.y });
        if (pointers.size > 1) {
            dragging = true;
            host.classList.add('is-panning');
            for (const pointerId of pointers.keys()) host.setPointerCapture?.(pointerId);
        }
    });
    host.addEventListener('pointermove', event => {
        if (!pointers.has(event.pointerId)) return;
        const previous = pointers.get(event.pointerId), position = point(event);
        const before = [...pointers.values()];
        pointers.set(event.pointerId, { ...previous, ...position });
        if (pointers.size >= 2) {
            const after = [...pointers.values()];
            const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
            const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const oldCenter = midpoint(before), newCenter = midpoint(after), oldDistance = distance(before);
            if (oldDistance > 0) zoomBy(distance(after) / oldDistance, oldCenter);
            pan(oldCenter.x - newCenter.x, oldCenter.y - newCenter.y);
        } else {
            if (!dragging && Math.hypot(position.x - previous.startX, position.y - previous.startY) < DRAG_THRESHOLD) return;
            if (!dragging) {
                dragging = true;
                host.classList.add('is-panning');
                host.setPointerCapture?.(event.pointerId);
                host.focus({ preventScroll: true });
            }
            pan(previous.x - position.x, previous.y - position.y);
        }
        event.preventDefault();
    });
    for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, endGesture);
    host.addEventListener('lostpointercapture', event => {
        // Touch may transfer implicit capture from a card/button to this host.
        // The child's bubbled loss is not loss of the host's active gesture.
        if (event.target === host) endGesture(event);
    });
    window.addEventListener('blur', cancelGesture);
    window.addEventListener('pagehide', cancelGesture);
    host.addEventListener('dragstart', event => event.preventDefault());
    host.addEventListener('click', event => {
        if (dragging || (event.detail !== 0 && Date.now() < suppressClickUntil)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    }, true);
    host.addEventListener('wheel', event => {
        // Plain wheel/trackpad scrolling stays native; Ctrl/Command + wheel zooms.
        if (!canvas || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
        zoomBy(Math.exp(-Math.max(-100, Math.min(100, delta)) * .01), point(event));
    }, { passive: false });
    host.addEventListener('keydown', event => {
        if (event.target !== host || event.altKey || event.ctrlKey || event.metaKey) return;
        const actions = {
            '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(.8),
            '0': () => zoomTo('fit'), '1': () => zoomTo(1),
            ArrowLeft: () => pan(-80, 0), ArrowRight: () => pan(80, 0),
            ArrowUp: () => pan(0, -80), ArrowDown: () => pan(0, 80),
        };
        if (actions[event.key]) { event.preventDefault(); actions[event.key](); }
    });
    host.addEventListener('focusin', event => {
        if (event.target === host || pointers.size || dragging || !canvas) return;
        const target = event.target, rect = target.getBoundingClientRect(), box = host.getBoundingClientRect();
        if (scale < .75 || rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom) reveal(target);
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
        if (!canvas || !host.clientWidth || !host.clientHeight) return;
        if (fitMode) zoomTo('fit');
        else layout();
    }).observe(host);
    const api = {
        configure(next) {
            controls = next;
            controls.select?.addEventListener('change', () => zoomTo(controls.select.value));
            controls.zoomOut?.addEventListener('click', () => zoomBy(.8));
            controls.zoomIn?.addEventListener('click', () => zoomBy(1.25));
            controls.fit?.addEventListener('click', () => zoomTo('fit'));
            controls.reset?.addEventListener('click', () => zoomTo(1));
            controls.left?.addEventListener('click', () => pan(-host.clientWidth * .7, 0));
            controls.right?.addEventListener('click', () => pan(host.clientWidth * .7, 0));
            updateControls();
        },
        beforeRender() { savedWorld = worldPoint(center()); },
        setContent(nextCanvas, nextSpacer, dimensions, nextKey, requestedScale) {
            const anchor = center(), world = savedWorld || worldPoint(anchor), changed = key !== nextKey;
            savedWorld = null;
            if (changed) cancelGesture();
            canvas = nextCanvas; spacer = nextSpacer;
            width = dimensions.width; height = dimensions.height; key = nextKey;
            if (changed) fitMode = true;
            if (requestedScale !== undefined) {
                fitMode = requestedScale === 'fit';
                if (!fitMode && Number.isFinite(Number(requestedScale))) scale = Number(requestedScale);
            }
            scale = fitMode ? fitScale() : Math.max(minimumScale(), Math.min(MAX_SCALE, scale));
            layout();
            host.scrollLeft = fitMode ? 0 : world.x * scale + offsetX - anchor.x;
            host.scrollTop = fitMode ? 0 : world.y * scale + offsetY - anchor.y;
        },
        clear() {
            cancelGesture(); savedWorld = null; canvas = null; spacer = null; width = height = 0;
            host.removeAttribute('data-zoom'); updateControls();
        },
        zoomTo, reveal,
    };
    views.set(host, api);
    return api;
}
