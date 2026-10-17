// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the SleepIQ API, and the errors
// they end with. Pure helpers for the answers.
//
// asyncsleepiq (MIT) is the reference: `PUT /rest/login` with the e-mail and
// the password answers a `key`; every call then carries `_k=<key>` in its
// query string. The key is a secret: no URL is ever logged.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed call. `kind`:
 * - `no_credentials`: no e-mail or password (never sent);
 * - `refused`: the sign-in refused the e-mail or the password (401);
 * - `login_rejected`: the sign-in request itself was rejected (403 "User
 *   Agent is blocked", another 4xx: the API changed, the integration needs an
 *   update);
 * - `unauthorized`: the API refused the key (401);
 * - `not_found`: 404 (asyncsleepiq signs in again on it for the main reads);
 * - `forbidden`: a 403 of the API;
 * - `session_refused`: the key was refused again right after a new sign-in;
 * - `rate_limited`: 429, `retryAfter` in ms;
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer; `notSent` tells the request never left;
 * - `bad_response`, `size`: an answer that is not the expected JSON;
 * - `bamkey_failed`: a fuzion bed answered a failure to a bamkey command;
 * - `http`: any other status.
 * The message never holds a secret nor any free text of the answer.
 */
export class SleepIQError extends Error {
  constructor(kind, message, { status, retryAfter, notSent } = {}) {
    super(message);
    this.name = 'SleepIQError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.notSent = Boolean(notSent);
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> SleepIQError (never the request: it carries the key or the password). */
export function networkError(err, notSent = false) {
  if (err instanceof SleepIQError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,32}$/.test(err.code) ? err.code : '';
  return new SleepIQError('network', NETWORK_REASONS[code] ?? (code || 'network error'), {
    notSent,
  });
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof SleepIQError) {
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return 'internal error';
}

/**
 * One request; resolves `{ status, headers, body }` whatever the status. The
 * promise settles once; the body read is bounded. `onSent` is called once the
 * request has fully left (a command must know whether it was sent).
 */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.responseBytes,
    onSent,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    let sent = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new SleepIQError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    req.on('finish', () => {
      sent = true;
      onSent?.();
    });
    timer = setTimeout(() => {
      settle(
        reject,
        new SleepIQError('timeout', `no answer within ${Math.round(timeout / 1000)} s`, {
          notSent: !sent,
        }),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err, !sent)));
    // Aborted before it fully left: never sent (a command past its deadline).
    // Once sent, the answer is awaited as usual.
    const abort = () => {
      if (!sent) {
        settle(reject, new SleepIQError('timeout', 'not sent in time', { notSent: true }));
        req.destroy();
      }
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** The JSON of a body; `undefined` for an empty body. */
export function parseJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new SleepIQError('bad_response', 'an answer that is not JSON');
  }
}

const rateLimited = (status, headers, now) =>
  new SleepIQError('rate_limited', 'too many requests', {
    status,
    retryAfter: parseRetryAfter(headers?.['retry-after'], now),
  });

/** The error of a sign-in answer, or undefined when it is a success. */
export function loginError({ status, headers = {} }, { now } = {}) {
  if (status === 200 || status === 201) {
    return undefined;
  }
  if (status === 429) {
    return rateLimited(status, headers, now);
  }
  if (status >= 500) {
    return new SleepIQError('unavailable', 'the SleepIQ sign-in is unavailable', { status });
  }
  if (status === 401) {
    return new SleepIQError('refused', 'e-mail or password refused', { status });
  }
  return new SleepIQError('login_rejected', 'sign-in request rejected', { status });
}

/** The error of an API answer, or undefined when it is a success. */
export function apiError({ status, headers = {} }, { now } = {}) {
  if (status === 200 || status === 201 || status === 204) {
    return undefined;
  }
  if (status === 401) {
    return new SleepIQError('unauthorized', 'key refused', { status });
  }
  if (status === 403) {
    return new SleepIQError('forbidden', 'request refused', { status });
  }
  if (status === 404) {
    return new SleepIQError('not_found', 'not found', { status });
  }
  if (status === 429) {
    return rateLimited(status, headers, now);
  }
  if (status >= 500) {
    return new SleepIQError('unavailable', 'SleepIQ is unavailable', { status });
  }
  return new SleepIQError('http', 'request failed', { status });
}

/**
 * The text of a bamkey answer (`{ cdcResponse: "PASS:<text>" }`), as
 * asyncsleepiq reads it; a `FAIL`/`ERR` answer is an error.
 */
export function bamkeyText(json) {
  const raw = json && typeof json === 'object' ? json.cdcResponse : undefined;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (/^(FAIL|ERR)/i.test(text)) {
    throw new SleepIQError('bamkey_failed', 'the bed refused the bamkey command');
  }
  return text.replace(/^PASS:/, '').trim();
}
