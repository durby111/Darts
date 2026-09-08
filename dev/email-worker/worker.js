// Dashboard-ready ES module. No packages, Firebase Admin SDK, or client secrets.
const ORIGIN = 'https://blakeoutdarts.com';
const CONTINUE_URL = `${ORIGIN}/dev/accounts/`;
const ACTION_URL = 'https://blakeout.firebaseapp.com/__/auth/action';
const PROJECT = 'blakeout';
const SERVICE_ACCOUNT = 'blakeout-dev-email@blakeout.iam.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const API_URL = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:`;
const enc = new TextEncoder();
let oauthCache;
let oauthPending;
let jwksCache;
let jwksPending;

// MATERIALIZED freezes eligibility before ANY row is incremented. One SQLite
// write statement reserves every supplied counter or none, across all isolates.
export const RESERVE_SQL = `
WITH wanted AS MATERIALIZED (
  SELECT json_extract(value, '$[0]') AS key,
         json_extract(value, '$[1]') AS maximum,
         json_extract(value, '$[2]') AS expires
  FROM json_each(?1)
), allowed AS MATERIALIZED (
  SELECT NOT EXISTS (
    SELECT 1 FROM wanted w JOIN email_limits c ON c.key = w.key
    WHERE c.expires > ?2 AND c.count >= w.maximum
  ) AS ok
)
INSERT INTO email_limits (key, count, expires)
SELECT key, 1, expires FROM wanted WHERE (SELECT ok FROM allowed)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN email_limits.expires <= ?2 THEN 1 ELSE email_limits.count + 1 END,
  expires = CASE WHEN email_limits.expires <= ?2 THEN excluded.expires ELSE email_limits.expires END
RETURNING key`;

class SafeError extends Error {
  constructor(status, code, diagnostic) {
    super(code);
    this.status = status;
    this.code = code;
    this.diagnostic = diagnostic;
  }
}
const fail = (status, code, diagnostic) => { throw new SafeError(status, code, diagnostic); };
const DIAGNOSTIC_STAGES = new Set(['oauth', 'jwks', 'account_lookup', 'generate_link', 'validate_link', 'resend', 'runtime']);
const PROVIDER_REASONS = {
  oauth: ['invalid_grant', 'invalid_client', 'unauthorized_client', 'access_denied', 'invalid_scope', 'invalid_request', 'unsupported_grant_type'],
  google: [
    'IAM_PERMISSION_DENIED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'SERVICE_DISABLED',
    'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_SERVICE_BLOCKED', 'CONSUMER_INVALID',
    'INSUFFICIENT_PERMISSION', 'PROJECT_NOT_FOUND', 'CONFIGURATION_NOT_FOUND',
    'OPERATION_NOT_ALLOWED', 'INVALID_CONTINUE_URI', 'UNAUTHORIZED_DOMAIN',
    'INVALID_EMAIL', 'EMAIL_NOT_FOUND', 'USER_DISABLED', 'TOO_MANY_ATTEMPTS_TRY_LATER',
    'ADMIN_ONLY_OPERATION', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_ARGUMENT',
    'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'NOT_FOUND', 'INTERNAL', 'UNAVAILABLE'
  ],
  resend: [
    'validation_error', 'missing_api_key', 'invalid_api_key', 'restricted_api_key',
    'suspended_api_key', 'invalid_permission', 'not_found', 'method_not_allowed',
    'invalid_parameter', 'missing_required_field', 'missing_required_parameter',
    'daily_quota_exceeded', 'monthly_quota_exceeded', 'rate_limit_exceeded',
    'application_error', 'service_unavailable'
  ]
};
const DIAGNOSTIC_REASONS = new Set([
  ...Object.values(PROVIDER_REASONS).flat(), 'unclassified_provider_error',
  'network_error', 'redirect_rejected', 'invalid_json', 'invalid_response', 'missing_link',
  'invalid_link', 'unexpected_handler', 'unexpected_action', 'missing_action_parameters',
  'unexpected_continue_url', 'unexpected_link_parameters', 'backend_failure'
]);

function providerReason(stage, data) {
  if (stage === 'oauth') return PROVIDER_REASONS.oauth.find(reason => data?.error === reason) || 'unclassified_provider_error';
  if (stage === 'resend') return PROVIDER_REASONS.resend.find(reason => data?.name === reason) || 'unclassified_provider_error';
  const error = data?.error;
  const details = Array.isArray(error?.details) ? error.details.slice(0, 10) : [];
  const detailReason = PROVIDER_REASONS.google.find(reason => details.some(detail => detail?.reason === reason));
  if (detailReason) return detailReason;
  // Google may append sensitive context after a canonical code. Return only a
  // matching constant, never the message, its suffix, or an arbitrary code.
  return PROVIDER_REASONS.google.find(reason => error?.message === reason ||
    (typeof error?.message === 'string' && error.message.startsWith(`${reason} :`))) ||
    PROVIDER_REASONS.google.find(reason => error?.status === reason) || 'unclassified_provider_error';
}

function providerFailure(stage, httpStatus, reason, code = 'provider_unavailable') {
  fail(502, code, { stage, httpStatus, reason });
}

function logFailure(error) {
  const details = error instanceof SafeError ? error.diagnostic : null;
  // This is the sole logging sink. Only fixed allowlisted constants and a
  // numeric HTTP status reach it; no exception/provider/request objects do.
  console.warn(JSON.stringify({
    stage: DIAGNOSTIC_STAGES.has(details?.stage) ? details.stage : 'runtime',
    httpStatus: Number.isInteger(details?.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599 ? details.httpStatus : 0,
    reason: DIAGNOSTIC_REASONS.has(details?.reason) ? details.reason : 'backend_failure'
  }));
}
const nowSeconds = () => Math.floor(Date.now() / 1000);
const configured = env => Boolean(
  typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.trim() &&
  typeof env.FIREBASE_SERVICE_ACCOUNT === 'string' && env.FIREBASE_SERVICE_ACCOUNT.trim() &&
  env.EMAIL_LIMITS && typeof env.EMAIL_LIMITS.prepare === 'function'
);

function credentialRecord(env) {
  let account;
  try {
    account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
    if (!/^re_[A-Za-z0-9_-]{10,}$/.test(env.RESEND_API_KEY) ||
        account.type !== 'service_account' || account.project_id !== PROJECT ||
        account.client_email !== SERVICE_ACCOUNT || account.token_uri !== TOKEN_URL ||
        typeof account.private_key !== 'string') throw new Error('Invalid configuration');
  } catch { fail(503, 'credentials_unavailable'); }
  return account;
}

async function credentialKey(env) {
  const account = credentialRecord(env);
  try {
    const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
    return await crypto.subtle.importKey('pkcs8', unbase64(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch { fail(503, 'credentials_unavailable'); }
}

async function readiness(env) {
  if (!configured(env)) return false;
  try {
    await credentialKey(env);
    const result = await env.EMAIL_LIMITS.prepare('SELECT key, count, expires FROM email_limits LIMIT 0').all();
    return result?.success === true && Array.isArray(result.results);
  } catch {
    // A readiness failure is intentionally reduced to one non-sensitive state.
    return false;
  }
}

function json(status, body, origin) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  };
  if (origin === ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ORIGIN;
    headers['Access-Control-Expose-Headers'] = 'Retry-After';
  }
  // Advisory backoff; hourly/daily/monthly quotas may require a longer wait.
  if (status === 429) headers['Retry-After'] = '60';
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error, origin) {
  const status = error instanceof SafeError ? error.status : 503;
  const internal = error instanceof SafeError ? error.code : 'backend_unavailable';
  const errors = {
    rate_limited: ['email/rate-limited', 'Too many email requests. Please wait before trying again.'],
    unauthorized: ['auth/requires-recent-login', 'Please sign in again before requesting a verification email.'],
    already_verified: ['auth/email-already-verified', 'Your email address is already verified.'],
    invalid_email: ['auth/invalid-email', 'Please enter a valid email address.'],
    invalid_request: ['email/invalid-request', 'The email request is invalid.'],
    invalid_content_type: ['email/invalid-request', 'The email request is invalid.'],
    request_too_large: ['email/invalid-request', 'The email request is too large.'],
    origin_not_allowed: ['email/origin-not-allowed', 'This website cannot request account emails.'],
    headers_not_allowed: ['email/invalid-request', 'The email request is invalid.'],
    not_found: ['email/not-found', 'This email endpoint does not exist.'],
    method_not_allowed: ['email/method-not-allowed', 'This request method is not supported.']
  };
  const [code, message] = errors[internal] || ['email/unavailable', 'Account email is temporarily unavailable. Please try again later.'];
  return json(status, { error: { code, message } }, origin);
}

function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254) fail(400, 'invalid_email');
  const email = value.trim().toLowerCase();
  // Deliberately accept common ASCII mailbox syntax, not quoted/Unicode addresses.
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) ||
      email.split('@')[0].length > 64 || email.startsWith('.') ||
      email.includes('..') || email.includes('.@')) fail(400, 'invalid_email');
  return email;
}

async function bodyJSON(request, route) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') || '')) {
    fail(415, 'invalid_content_type');
  }
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) fail(413, 'request_too_large');
  if (!request.body) fail(400, 'invalid_request');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) {
      await reader.cancel();
      fail(413, 'request_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'invalid_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'invalid_request');
  const keys = Object.keys(body);
  if (route === '/verify-email' ? keys.length !== 0 : keys.length !== 1 || keys[0] !== 'email') fail(400, 'invalid_request');
  return body;
}

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function reserve(db, counters, now) {
  let result;
  try { result = await db.prepare(RESERVE_SQL).bind(JSON.stringify(counters), now).all(); }
  catch { fail(503, 'limits_unavailable'); }
  if (!result || result.success !== true || !Array.isArray(result.results)) fail(503, 'limits_unavailable');
  if (result.results.length !== 0 && result.results.length !== counters.length) fail(503, 'limits_unavailable');
  return result.results.length === counters.length;
}

async function reserveRequest(env, request, now) {
  // CF-Connecting-IP is trusted only because Cloudflare sets it at this public Worker.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || ip.length > 64 || !/^[0-9a-fA-F:.]+$/.test(ip)) fail(503, 'client_address_unavailable');
  const digest = await hash(`ip:${ip}`);
  const hour = Math.floor(now / 3600) * 3600;
  const day = Math.floor(now / 86400) * 86400;
  const date = new Date(now * 1000);
  const nextMonth = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
  const counters = [
    [`ip:${digest}:hour`, 10, hour + 3600],
    [`ip:${digest}:day`, 25, day + 86400],
    ['global:day', 80, day + 86400],
    ['global:month', 2400, nextMonth]
  ];
  // No month value is embedded in keys: expired counters are reused, not accumulated.
  if (!await reserve(env.EMAIL_LIMITS, counters, now)) fail(429, 'rate_limited');
}

async function reserveAccount(env, email, now) {
  const digest = await hash(`account:${email}`);
  return reserve(env.EMAIL_LIMITS, [
    [`account:${digest}:cooldown`, 1, now + 60],
    [`account:${digest}:hour`, 3, (Math.floor(now / 3600) + 1) * 3600],
    [`account:${digest}:day`, 5, (Math.floor(now / 86400) + 1) * 86400]
  ], now);
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unbase64(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
function encodeJSON(value) { return b64url(enc.encode(JSON.stringify(value))); }

async function providerJSON(stage, url, options = {}) {
  let response;
  // workerd supports manual/follow, not redirect:error. Never forward provider
  // credentials to a redirect target, or parse a redirect's untrusted body.
  try { response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
  catch { providerFailure(stage, 0, 'network_error'); }
  if (response.status >= 300 && response.status < 400) providerFailure(stage, response.status, 'redirect_rejected');
  let data;
  try { data = await response.json(); }
  catch { providerFailure(stage, response.status, 'invalid_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) providerFailure(stage, response.status, 'invalid_response');
  return { response, data };
}

async function accessToken(env) {
  const now = nowSeconds();
  if (oauthCache && oauthCache.expires > now && oauthCache.source === env.FIREBASE_SERVICE_ACCOUNT) return oauthCache.token;
  if (oauthPending) return oauthPending;
  oauthPending = (async () => {
    const key = await credentialKey(env);
    const unsigned = `${encodeJSON({ alg: 'RS256', typ: 'JWT' })}.${encodeJSON({
      iss: SERVICE_ACCOUNT, scope: 'https://www.googleapis.com/auth/cloud-platform',
      aud: TOKEN_URL, iat: now, exp: now + 3600
    })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned));
    const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;
    const { response, data } = await providerJSON('oauth', TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString()
    });
    if (!response.ok) providerFailure('oauth', response.status, providerReason('oauth', data), 'credentials_unavailable');
    if (typeof data.access_token !== 'string' || !data.access_token ||
        !Number.isFinite(data.expires_in) || data.expires_in <= 60) providerFailure('oauth', response.status, 'invalid_response', 'credentials_unavailable');
    oauthCache = { source: env.FIREBASE_SERVICE_ACCOUNT, token: data.access_token, expires: now + Math.min(data.expires_in, 3600) - 60 };
    return data.access_token;
  })();
  try { return await oauthPending; }
  finally { oauthPending = undefined; }
}

async function signingKeys() {
  const now = nowSeconds();
  if (jwksCache && jwksCache.expires > now) return jwksCache.keys;
  if (jwksPending) return jwksPending;
  jwksPending = (async () => {
    const { response, data } = await providerJSON('jwks', JWKS_URL);
    if (!response.ok) providerFailure('jwks', response.status, providerReason('jwks', data), 'auth_unavailable');
    if (!Array.isArray(data.keys) || !data.keys.length || data.keys.length > 10) providerFailure('jwks', response.status, 'invalid_response', 'auth_unavailable');
    const maxAge = Number((response.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 300);
    jwksCache = { keys: data.keys, expires: now + Math.max(1, Math.min(maxAge, 3600)) };
    return data.keys;
  })();
  try { return await jwksPending; }
  finally { jwksPending = undefined; }
}

async function authenticate(request) {
  const authorization = request.headers.get('Authorization') || '';
  if (!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization) || authorization.length > 8192) fail(401, 'unauthorized');
  const token = authorization.slice(7);
  const parts = token.split('.');
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64(parts[0])));
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(unbase64(parts[1])));
  } catch { fail(401, 'unauthorized'); }
  const now = nowSeconds();
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 ||
      claims.aud !== PROJECT || claims.iss !== `https://securetoken.google.com/${PROJECT}` ||
      typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 128 ||
      !Number.isInteger(claims.exp) || claims.exp <= now ||
      !Number.isInteger(claims.iat) || claims.iat > now || claims.iat >= claims.exp ||
      !Number.isInteger(claims.auth_time) || claims.auth_time > now || claims.auth_time > claims.iat ||
      claims.firebase?.sign_in_provider !== 'password' || claims.firebase?.tenant ||
      typeof claims.email !== 'string') fail(401, 'unauthorized');
  const jwk = (await signingKeys()).find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) fail(401, 'unauthorized');
  let valid;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unbase64(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  } catch { fail(401, 'unauthorized'); }
  if (!valid) fail(401, 'unauthorized');
  return claims;
}

async function firebase(env, method, body) {
  const token = await accessToken(env);
  return providerJSON(method === 'lookup' ? 'account_lookup' : 'generate_link', `${API_URL}${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Referer: `${ORIGIN}/dev/accounts/` },
    body: JSON.stringify(body)
  });
}

async function lookup(env, query) {
  const { response, data } = await firebase(env, 'lookup', query);
  if (!response.ok) providerFailure('account_lookup', response.status, providerReason('account_lookup', data), 'auth_unavailable');
  if (data.users !== undefined && !Array.isArray(data.users)) providerFailure('account_lookup', response.status, 'invalid_response', 'auth_unavailable');
  if (!data.users?.length) return null;
  if (data.users.length !== 1) providerFailure('account_lookup', response.status, 'invalid_response', 'auth_unavailable');
  return data.users[0];
}

function usable(user) {
  return user && !user.disabled && typeof user.localId === 'string' &&
    typeof user.email === 'string' && user.providerUserInfo?.some(provider => provider.providerId === 'password');
}

function actionLink(value, mode, httpStatus) {
  const rejected = reason => providerFailure('validate_link', httpStatus, reason, 'auth_unavailable');
  if (typeof value !== 'string' || !value) rejected('missing_link');
  let url;
  try { url = new URL(value); } catch { rejected('invalid_link'); }
  // Only Google's fixed hosted handler, a fixed continuation, and expected action.
  if (`${url.origin}${url.pathname}` !== ACTION_URL || url.username || url.password || url.hash) rejected('unexpected_handler');
  if (url.searchParams.get('mode') !== mode) rejected('unexpected_action');
  if (!url.searchParams.get('oobCode') || !url.searchParams.get('apiKey')) rejected('missing_action_parameters');
  if (url.searchParams.get('continueUrl') !== CONTINUE_URL) rejected('unexpected_continue_url');
  const allowed = new Set(['mode', 'oobCode', 'apiKey', 'continueUrl', 'lang']);
  const seen = new Set();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) rejected('unexpected_link_parameters');
    seen.add(key);
  }
  return url.href;
}

const escapeHTML = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function emailContent(link, verification) {
  const title = verification ? 'Verify your email' : 'Reset your password';
  const explanation = verification
    ? 'Confirm your email address to finish setting up your BlakeOut account.'
    : 'A password reset was requested for your BlakeOut account.';
  const safety = verification
    ? 'If you did not create this account, you can ignore this email.'
    : 'If you did not request this, ignore this email. Your password will not change unless you complete the reset.';
  const safeLink = escapeHTML(link);
  return {
    subject: `${title} — BlakeOut`,
    text: `BlakeOut\n\n${title}\n\n${explanation}\n\n${title}: ${link}\n\n${safety}\n\nNeed help? Reply to this email.\nBlakeOut`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — BlakeOut</title></head><body style="margin:0;background:#10131b;color:#f4f6fa;font-family:Arial,sans-serif"><table role="presentation" style="width:100%;padding:32px 16px"><tr><td align="center"><table role="presentation" style="width:100%;max-width:560px;background:#1b2230;border-radius:16px;padding:32px"><tr><td><img src="${ORIGIN}/dev/assets/logo.png" width="176" height="96" alt="BlakeOut" style="display:block;max-width:100%;height:auto;margin-bottom:20px"><p style="color:#67e8d0;font-size:22px;font-weight:bold">BlakeOut</p><h1 style="font-size:26px">${title}</h1><p style="line-height:1.6">${explanation}</p><p style="padding:20px 0"><a href="${safeLink}" style="display:inline-block;background:#67e8d0;color:#10131b;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold">${title}</a></p><p style="line-height:1.6">${safety}</p><p style="font-size:13px;line-height:1.6">Button not working? Copy this link into your browser:<br><a href="${safeLink}" style="color:#67e8d0;word-break:break-all">${safeLink}</a></p><p style="font-size:13px;color:#b8c2d4">Need help? Reply to this email.<br>BlakeOut</p></td></tr></table></td></tr></table></body></html>`
  };
}

async function send(env, email, verification) {
  const { response, data } = await firebase(env, 'sendOobCode', {
    requestType: verification ? 'VERIFY_EMAIL' : 'PASSWORD_RESET',
    email, returnOobLink: true, continueUrl: CONTINUE_URL, canHandleCodeInApp: false
  });
  // Account deletion between lookup and generation is still enumeration-safe.
  if (!verification && response.status === 400 && data?.error?.message === 'EMAIL_NOT_FOUND') return;
  if (!response.ok) providerFailure('generate_link', response.status, providerReason('generate_link', data), 'auth_unavailable');
  const link = actionLink(data.oobLink, verification ? 'verifyEmail' : 'resetPassword', response.status);
  const result = await providerJSON('resend', 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BlakeOut <noreply@blakeoutdarts.com>',
      to: [email], reply_to: 'DartsBlakeOut@gmail.com', ...emailContent(link, verification)
    })
  });
  if (!result.response.ok) providerFailure('resend', result.response.status, providerReason('resend', result.data), 'email_unavailable');
  if (typeof result.data.id !== 'string' || !result.data.id) providerFailure('resend', result.response.status, 'invalid_response', 'email_unavailable');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    try {
      const url = new URL(request.url);
      if (origin !== null && origin !== ORIGIN) fail(403, 'origin_not_allowed');
      if (url.search || !['/health', '/verify-email', '/reset-password'].includes(url.pathname)) fail(404, 'not_found');
      if (request.method === 'OPTIONS') {
        if (origin !== ORIGIN || url.pathname === '/health' ||
            request.headers.get('Access-Control-Request-Method') !== 'POST') fail(405, 'method_not_allowed');
        const requested = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (requested.some(value => !['authorization', 'content-type'].includes(value))) fail(403, 'headers_not_allowed');
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600', 'Vary': 'Origin', 'Cache-Control': 'no-store'
        } });
      }
      if (url.pathname === '/health') {
        if (request.method !== 'GET') fail(405, 'method_not_allowed');
        const ready = await readiness(env);
        return json(ready ? 200 : 503, { status: ready ? 'ready' : 'not-ready' }, origin);
      }
      if (request.method !== 'POST') fail(405, 'method_not_allowed');
      if (!configured(env)) fail(503, 'not_configured');
      const body = await bodyJSON(request, url.pathname);
      const email = url.pathname === '/reset-password' ? normalizeEmail(body.email) : null;
      const now = nowSeconds();
      await reserveRequest(env, request, now);
      if (url.pathname === '/reset-password') {
        if (await reserveAccount(env, email, now)) {
          const user = await lookup(env, { email: [email] });
          if (usable(user) && normalizeEmail(user.email) === email) await send(env, email, false);
        }
        return json(200, { status: 'accepted' }, origin);
      }
      const claims = await authenticate(request);
      const user = await lookup(env, { localId: [claims.sub] });
      if (!usable(user) || user.localId !== claims.sub || user.email.toLowerCase() !== claims.email.toLowerCase() ||
          !/^\d+$/.test(String(user.validSince)) || claims.auth_time < Number(user.validSince)) fail(401, 'unauthorized');
      if (user.emailVerified) fail(409, 'already_verified');
      const currentEmail = normalizeEmail(user.email);
      if (!await reserveAccount(env, currentEmail, now)) fail(429, 'rate_limited');
      await send(env, currentEmail, true);
      return json(200, { status: 'sent' }, origin);
    } catch (error) {
      // Provider bodies, credentials, ID tokens, recipients and action links must
      // never reach responses or logs, even on unexpected runtime/D1 failures.
      if (!(error instanceof SafeError) || error.status >= 500) logFailure(error);
      return errorResponse(error, origin);
    }
  }
};
