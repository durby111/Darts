/* ============================================
   Max Visibility Mode — screen brightness handling.

   Goal: keep the display bright (target ≥ 70%) and awake during play
   in a dim bar. Reality: the web platform has NO API to set device
   screen brightness (the Screen Brightness API proposal never
   shipped). Strategy, in order of capability:

   1. Best-effort native hooks — probe the handful of non-standard
      brightness surfaces that exist in webview shells / legacy
      devices. On the open web these are all absent; the probe is
      cheap and harmless and means we automatically light up if a
      platform ever exposes one.
   2. Screen Wake Lock API — supported in all modern Chromium +
      Safari 16.4+. Keeps the display from dimming/sleeping while a
      game is on. Re-acquired on visibilitychange (the lock is
      released by the OS whenever the tab is hidden).
   3. Fallback UX —
      - one-time onboarding prompt offering Max Visibility Mode
      - per-platform "how to set brightness to 70%+" instructions
      - persistent indicator chip showing wake-lock state and a
        warning while brightness hasn't been confirmed
      - a luminance boost class (html.vis-boost) that pushes the
        active theme's output brighter for OLED/LCD punch.

   Persisted prefs: localStorage 'blakeout_visibility'
     { enabled, onboarded, boost, brightnessConfirmedAt }
   Brightness confirmation expires after 12h — bars dim, tablets
   auto-revert, people fiddle.
   ============================================ */

const STORAGE_KEY = 'blakeout_visibility';
const CONFIRM_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

let prefs = loadPrefs();
let wakeLock = null;          // active WakeLockSentinel or null
let wakeLockSupported = ('wakeLock' in navigator);

function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return Object.assign({ enabled: false, onboarded: false, boost: true, brightnessConfirmedAt: 0 }, JSON.parse(raw));
    } catch { /* fall through */ }
    return { enabled: false, onboarded: false, boost: true, brightnessConfirmedAt: 0 };
}

function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { }
}

export function isEnabled() { return !!prefs.enabled; }

export function isBrightnessConfirmed() {
    return prefs.brightnessConfirmedAt && (Date.now() - prefs.brightnessConfirmedAt) < CONFIRM_TTL_MS;
}

// --- 1. Best-effort native brightness (no-op on the open web) ---

// Returns true if some platform hook accepted the request.
export function tryNativeBrightness(level /* 0..1 */) {
    try {
        // Cordova / old PhoneGap shells
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.brightness) {
            window.cordova.plugins.brightness.setBrightness(level);
            return true;
        }
        // Samsung Internet legacy / misc webview shells
        if (typeof navigator.setScreenBrightness === 'function') {
            navigator.setScreenBrightness(level);
            return true;
        }
        if (window.AndroidBridge && typeof window.AndroidBridge.setBrightness === 'function') {
            window.AndroidBridge.setBrightness(level);
            return true;
        }
    } catch { /* any hook throwing means "not available" */ }
    return false;
}

// --- 2. Wake lock ---

async function acquireWakeLock() {
    if (!wakeLockSupported || !prefs.enabled) return false;
    if (wakeLock && !wakeLock.released) return true;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { updateIndicator(); });
        updateIndicator();
        return true;
    } catch {
        // Denied (low battery mode, iframe permissions, etc.)
        wakeLock = null;
        updateIndicator();
        return false;
    }
}

async function releaseWakeLock() {
    try { if (wakeLock && !wakeLock.released) await wakeLock.release(); } catch { }
    wakeLock = null;
    updateIndicator();
}

function wakeLockActive() {
    return !!(wakeLock && !wakeLock.released);
}

// --- Boost class ---

function applyBoost() {
    document.documentElement.classList.toggle('vis-boost', !!(prefs.enabled && prefs.boost));
}

// --- Platform brightness instructions ---

export function brightnessInstructions() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
        return [
            'Swipe down from the top-right corner to open Control Center.',
            'Drag the brightness slider (sun icon) to at least 70%.',
            'Optional: Settings → Display & Brightness → turn OFF Auto-Lock while playing.'
        ];
    }
    if (/Android/.test(ua)) {
        return [
            'Swipe down from the top of the screen (twice for the full panel).',
            'Drag the brightness slider to at least 70%.',
            'Optional: turn off Adaptive Brightness so the bar lighting doesn\u2019t dim you back down.'
        ];
    }
    return [
        'Use your device\u2019s brightness keys or system settings.',
        'Set brightness to at least 70% and disable auto-dim / battery saver while playing.'
    ];
}

// --- UI: modals, banner, indicator ---

function el(id) { return document.getElementById(id); }

function showOnboardIfNeeded() {
    if (prefs.onboarded) return;
    // Inline, non-blocking card on the setup screen — a first-launch modal
    // would block the whole UI before the user ever threw a dart.
    const card = el('visOnboardCard');
    if (card) card.classList.remove('hidden');
}

function hideOnboardCard() {
    const card = el('visOnboardCard');
    if (card) card.classList.add('hidden');
}

function openTips() {
    const steps = brightnessInstructions();
    const list = el('visTipsSteps');
    if (list) {
        list.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    }
    const support = el('visTipsSupport');
    if (support) {
        support.textContent = wakeLockSupported
            ? 'Screen sleep is handled automatically while a game is on (wake lock supported on this device).'
            : 'This browser can\u2019t stop the screen from sleeping — also raise your screen timeout while playing.';
    }
    const modal = el('visTipsModal');
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) {
    const modal = el(id);
    if (modal) modal.style.display = 'none';
}

export function setEnabled(on) {
    prefs.enabled = !!on;
    prefs.onboarded = true;
    savePrefs();
    applyBoost();
    if (on) {
        // Native hook first (almost always a no-op on the web) …
        tryNativeBrightness(0.85);
        // … then wake lock. Needs a user gesture on some platforms, and
        // setEnabled is always called from one (toggle/onboard buttons).
        acquireWakeLock();
    } else {
        releaseWakeLock();
    }
    updateIndicator();
    updateBanner();
    syncToggle();
}

export function setBoost(on) {
    prefs.boost = !!on;
    savePrefs();
    applyBoost();
    syncToggle();
}

function confirmBrightness() {
    prefs.brightnessConfirmedAt = Date.now();
    savePrefs();
    updateBanner();
    updateIndicator();
}

function syncToggle() {
    const t = el('visModeToggle');
    if (t) t.checked = !!prefs.enabled;
    const b = el('visBoostToggle');
    if (b) b.checked = !!prefs.boost;
    const boostRow = el('visBoostRow');
    if (boostRow) boostRow.classList.toggle('hidden', !prefs.enabled);
}

// Indicator chip lives on the setup header; mirrors into the game screen
// banner. Three states: off / active / warn.
function updateIndicator() {
    const chip = el('visIndicator');
    if (!chip) return;
    chip.classList.remove('vis-off', 'vis-ok', 'vis-warn');
    if (!prefs.enabled) {
        chip.classList.add('vis-off');
        chip.title = 'Max Visibility Mode is off';
        chip.textContent = '☀ off';
        return;
    }
    const lockOk = !wakeLockSupported || wakeLockActive() || document.visibilityState !== 'visible';
    if (isBrightnessConfirmed() && lockOk) {
        chip.classList.add('vis-ok');
        chip.title = 'Max Visibility: wake lock on, brightness confirmed';
        chip.textContent = '☀ on';
    } else {
        chip.classList.add('vis-warn');
        chip.title = isBrightnessConfirmed()
            ? 'Max Visibility: could not keep the screen awake — check device settings'
            : 'Max Visibility: set screen brightness to 70%+ (tap for how)';
        chip.textContent = '☀ !';
    }
}

// Banner strip on the game screen — shown while Max Visibility is on but
// brightness hasn't been confirmed recently.
function updateBanner() {
    const banner = el('visBanner');
    if (!banner) return;
    const show = prefs.enabled && !isBrightnessConfirmed();
    banner.classList.toggle('hidden', !show);
}

// --- Init ---

export function initVisibility() {
    // Onboard prompt buttons
    const enableBtn = el('visOnboardEnableBtn');
    if (enableBtn) enableBtn.addEventListener('click', () => {
        hideOnboardCard();
        setEnabled(true);
        openTips();
    });
    const skipBtn = el('visOnboardSkipBtn');
    if (skipBtn) skipBtn.addEventListener('click', () => {
        prefs.onboarded = true;
        savePrefs();
        hideOnboardCard();
    });

    // Tips modal
    const tipsBtn = el('visTipsBtn');
    if (tipsBtn) tipsBtn.addEventListener('click', openTips);
    const tipsDone = el('visTipsDoneBtn');
    if (tipsDone) tipsDone.addEventListener('click', () => {
        confirmBrightness();
        closeModal('visTipsModal');
    });
    const tipsClose = el('visTipsCloseBtn');
    if (tipsClose) tipsClose.addEventListener('click', () => closeModal('visTipsModal'));

    // Setup toggles
    const toggle = el('visModeToggle');
    if (toggle) toggle.addEventListener('change', () => setEnabled(toggle.checked));
    const boostToggle = el('visBoostToggle');
    if (boostToggle) boostToggle.addEventListener('change', () => setBoost(boostToggle.checked));

    // Indicator chip opens the tips (the quick action to fix brightness)
    const chip = el('visIndicator');
    if (chip) chip.addEventListener('click', openTips);

    // Banner actions
    const bannerHow = el('visBannerHowBtn');
    if (bannerHow) bannerHow.addEventListener('click', openTips);
    const bannerDone = el('visBannerDoneBtn');
    if (bannerDone) bannerDone.addEventListener('click', confirmBrightness);

    // Re-acquire the wake lock whenever we come back to the foreground —
    // the OS silently releases it on tab switch / screen off.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && prefs.enabled) {
            acquireWakeLock();
        }
        updateIndicator();
    });

    // First user gesture: wake lock requests are gesture-gated on some
    // platforms, so if enabled at boot, hook the first pointerdown.
    if (prefs.enabled) {
        const once = () => { acquireWakeLock(); document.removeEventListener('pointerdown', once); };
        document.addEventListener('pointerdown', once);
    }

    applyBoost();
    syncToggle();
    updateIndicator();
    updateBanner();
    showOnboardIfNeeded();
}

// Called by setup.js when a game starts — the natural moment to grab the
// lock (guaranteed user gesture) and to surface the brightness banner.
export function onGameStart() {
    if (!prefs.enabled) return;
    tryNativeBrightness(0.85);
    acquireWakeLock();
    updateBanner();
    updateIndicator();
}
