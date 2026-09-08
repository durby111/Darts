const WORKER_URL = 'https://blakeout-email-dev.dartsblakeout.workers.dev';
const ERROR_MESSAGES = {
    'email/rate-limited': 'Too many email requests. Wait before requesting another email.',
    'email/unavailable': 'The email service is unavailable. Please try again later.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/requires-recent-login': 'Sign in again before requesting a verification email.',
    'auth/invalid-token': 'Your sign-in session could not be verified. Sign in again.',
    'auth/email-already-verified': 'This email address is already verified. Refresh your account.'
};

async function serviceJSON(response) {
    try {
        return await response.json();
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error('The email service returned an invalid response. Please try again later.');
        }
        throw error;
    }
}

export async function sendAccountEmail(serviceURL, kind, { token, email } = {}) {
    if (serviceURL !== WORKER_URL || !['verify-email', 'reset-password'].includes(kind)) {
        throw new Error('Invalid account email service configuration.');
    }
    if (kind === 'verify-email' && (typeof token !== 'string' || !token)) {
        throw new Error('Sign in before requesting a verification email.');
    }
    const headers = { 'Content-Type': 'application/json' };
    if (kind === 'verify-email') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${serviceURL}/${kind}`, {
        method: 'POST',
        headers,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(kind === 'verify-email' ? {} : { email })
    });
    if (!response.ok) {
        const fallbackCode = response.status === 429 ? 'email/rate-limited'
            : response.status === 401 ? 'auth/invalid-token' : 'email/unavailable';
        const result = response.headers.get('Content-Type')?.includes('application/json')
            ? await serviceJSON(response) : null;
        const code = Object.hasOwn(ERROR_MESSAGES, result?.error?.code)
            ? result.error.code : fallbackCode;
        const error = new Error(ERROR_MESSAGES[code]);
        error.code = code;
        const retryAfter = response.headers.get('Retry-After');
        if (response.status === 429 && retryAfter && /^\d{1,7}$/.test(retryAfter)) {
            error.message += ` Wait at least ${Math.max(1, Math.ceil(Number(retryAfter) / 60))} minute(s) before retrying. Daily or monthly limits may take longer to reset.`;
        }
        throw error;
    }
    const result = await serviceJSON(response);
    const expected = kind === 'verify-email' ? 'sent' : 'accepted';
    if (result?.status !== expected) {
        throw new Error('The email service did not confirm your request. Please try again later.');
    }
}
