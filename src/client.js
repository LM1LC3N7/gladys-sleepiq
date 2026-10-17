// -----------------------------------------------------------------------------
// The SleepIQ account: the key sign-in (e-mail and password), the key kept and
// reused across cycles (never a sign-in per cycle: a new one only when the API
// refuses the key), and the calls the integration makes. Every request goes
// through the transport of src/sleepiq.js. Ported from asyncsleepiq (MIT).
// -----------------------------------------------------------------------------

import {
  API_URL,
  BAMKEY,
  HEADERS,
  LIMITS,
  PATHS,
  SOURCE_APPLICATION,
  TIMINGS,
} from './constants.js';
import {
  SleepIQError,
  apiError,
  bamkeyText,
  httpRequest,
  loginError,
  parseJson,
} from './sleepiq.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The key of a sign-in answer: a short opaque string. */
const validKey = (key) => typeof key === 'string' && /^[\x21-\x7e]{1,512}$/.test(key);

export class SleepIQClient {
  constructor({ transport = httpRequest, now = Date.now, onChange } = {}) {
    this.transport = transport;
    this.now = now;
    /** Called after the session changed (persist it; never throws). */
    this.onChange = onChange;
    this.email = '';
    this.password = '';
    /** { key, at } | null */
    this.session = null;
    /** The cookies of the API (load balancer), in memory only: name -> value. */
    this.cookies = new Map();
    /** One sign-in at a time. */
    this.authenticating = undefined;
    /** One new sign-in per cycle at most (beginCycle resets it). */
    this.relogged = false;
    /** Per-request timeout; undefined = the default (shorter for the test button). */
    this.timeout = undefined;
    /** Until then, a 404 of a main read is a real 404 (it survived a fresh sign-in). */
    this.realNotFoundUntil = -Infinity;
  }

  configure({ email, password, session = null }) {
    this.email = email;
    this.password = password;
    this.session = session && validKey(session.key) ? { key: session.key, at: session.at } : null;
    this.cookies = new Map();
    this.relogged = false;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  beginCycle() {
    this.relogged = false;
  }

  async changed() {
    try {
      await this.onChange?.();
    } catch {
      // Persisting is best effort: the key still works in memory.
    }
  }

  /** The timeout of a request that must be answered before `deadline` (if any). */
  timeoutFor(deadline) {
    const base = this.timeout ?? TIMINGS.requestTimeout;
    if (deadline === undefined) {
      return base;
    }
    const left = deadline - this.now();
    if (left < 300) {
      throw new SleepIQError('timeout', 'no time left to send the request', { notSent: true });
    }
    return Math.min(base, left);
  }

  /** Keeps the cookies the API sets (name=value only), as the aiohttp session of asyncsleepiq does. */
  storeCookies(headers) {
    const raw = headers?.['set-cookie'];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const pair = String(line).split(';', 1)[0];
      const at = pair.indexOf('=');
      const name = at > 0 ? pair.slice(0, at).trim() : '';
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name) || pair.length > LIMITS.cookieLength) {
        continue;
      }
      if (this.cookies.size >= LIMITS.cookies && !this.cookies.has(name)) {
        continue;
      }
      this.cookies.set(name, pair.slice(at + 1).trim());
    }
  }

  headers(body) {
    const headers = { ...HEADERS, Accept: 'application/json' };
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    return headers;
  }

  /** One sign-in at a time: a second caller joins the running one. */
  authenticate(fn) {
    if (!this.authenticating) {
      this.authenticating = fn().finally(() => {
        this.authenticating = undefined;
      });
    }
    return this.authenticating;
  }

  /** Signs in with the e-mail and the password (asyncsleepiq's login_key). */
  signIn({ deadline } = {}) {
    return this.authenticate(() => this.signInNow(deadline));
  }

  /** The sign-in itself; only ever run inside authenticate(). */
  async signInNow(deadline) {
    if (!this.hasCredentials) {
      throw new SleepIQError('no_credentials', 'no e-mail or password');
    }
    const { email } = this;
    const body = JSON.stringify({ login: email, password: this.password });
    const answer = await this.transport(`${API_URL}/${PATHS.login}`, {
      method: 'PUT',
      headers: this.headers(body),
      body,
      timeout: this.timeoutFor(deadline),
    });
    this.storeCookies(answer.headers);
    const error = loginError(answer, { now: this.now() });
    if (error) {
      throw error;
    }
    const json = parseJson(answer.body);
    if (!isObject(json) || !validKey(json.key)) {
      throw new SleepIQError('bad_response', 'the sign-in sent no key');
    }
    if (this.email !== email) {
      throw new SleepIQError('network', 'the account changed during the sign-in');
    }
    this.session = { key: json.key, at: this.now() };
    await this.changed();
    return this.session;
  }

  /**
   * A usable key: the one kept, else one sign-in (one per cycle at most).
   * Resolves true when the key is a new one. A caller arriving during a
   * sign-in joins it and gets its outcome, its real error included.
   */
  async ensureKey({ deadline } = {}) {
    if (this.authenticating) {
      await this.authenticating;
      if (this.session) {
        return true;
      }
    }
    if (this.session) {
      return false;
    }
    if (this.relogged) {
      throw new SleepIQError('not_signed_in', 'not signed in to SleepIQ', { notSent: true });
    }
    this.relogged = true;
    await this.authenticate(() => this.signInNow(deadline));
    return true;
  }

  /** Forgets the key the API refused (the next main read signs in again). */
  async expire() {
    if (this.session) {
      this.session = null;
      await this.changed();
    }
  }

  /** One API request with the current key; resolves the parsed JSON (or undefined). */
  async call(method, path, { query = {}, payload, deadline, onSent, signal } = {}) {
    if (!this.session) {
      throw new SleepIQError('not_signed_in', 'not signed in to SleepIQ', { notSent: true });
    }
    const search = new URLSearchParams({ ...query, _k: this.session.key }).toString();
    const body = method === 'GET' ? undefined : JSON.stringify(payload ?? {});
    const answer = await this.transport(`${API_URL}/${path}?${search}`, {
      method,
      headers: this.headers(body),
      body,
      timeout: this.timeoutFor(deadline),
      onSent,
      ...(signal ? { signal } : {}),
    });
    this.storeCookies(answer.headers);
    const error = apiError(answer, { now: this.now() });
    if (error) {
      throw error;
    }
    return parseJson(answer.body);
  }

  /**
   * An authenticated read. A refused key (401, or a 404 as asyncsleepiq
   * reads it) signs in once and retries once; a 401 right after a new
   * sign-in is `session_refused` (the caller stops), a 404 then is a real 404.
   *
   * `secondary: true` (the reads after the main one): no sign-in, no new
   * try; every error comes back as is, never as a stop.
   */
  async read(path, { secondary = false, method = 'GET', ...options } = {}) {
    if (secondary) {
      return this.call(method, path, options);
    }
    const fresh = await this.ensureKey(options);
    try {
      return await this.call(method, path, options);
    } catch (err) {
      if (!this.signsInAgain(err)) {
        throw err;
      }
      if (fresh) {
        throw this.refusedAgain(err);
      }
    }
    await this.expire();
    await this.ensureKey(options);
    try {
      return await this.call(method, path, options);
    } catch (err) {
      throw this.refusedAgain(err);
    }
  }

  /**
   * Whether an error of a main read is worth a new sign-in: a 401, or a 404
   * (asyncsleepiq), unless a 404 lately survived a fresh sign-in (then it is
   * a real 404 for a few hours: no sign-in per cycle for it).
   */
  signsInAgain(err) {
    if (err.kind === 'unauthorized') {
      return true;
    }
    return err.kind === 'not_found' && this.now() >= this.realNotFoundUntil;
  }

  refusedAgain(err) {
    if (err.kind === 'not_found') {
      this.realNotFoundUntil = this.now() + TIMINGS.realNotFound;
    }
    if (err.kind !== 'unauthorized') {
      return err;
    }
    return new SleepIQError('session_refused', 'the key was refused right after a new sign-in', {
      status: err.status,
    });
  }

  /**
   * The status of a GET, for the "does it exist" checks of asyncsleepiq: no
   * sign-in, no new try. Resolves the status of a 2xx or 4xx; a 429, a 5xx or
   * no answer throws.
   */
  async check(path, { query, deadline } = {}) {
    try {
      await this.call('GET', path, { query, deadline });
      return 200;
    } catch (err) {
      if (err.status && err.status >= 400 && err.status < 500 && err.kind !== 'rate_limited') {
        return err.status;
      }
      if (err.kind === 'bad_response') {
        return 200;
      }
      throw err;
    }
  }

  /**
   * A command: sent once, never retried (a retry could act twice), and never
   * sent after `sendBy` (it is refused unsent instead). A command never signs
   * in and never drops the key: without a key it is `not_signed_in` (unsent),
   * and a refused key is left to the next main read, which signs in again.
   * `signal` aborts a request that has not fully left yet.
   */
  async command(method, path, { payload, query, sendBy, onSent, signal } = {}) {
    if (!this.session) {
      throw new SleepIQError('not_signed_in', 'not signed in to SleepIQ', { notSent: true });
    }
    if (sendBy !== undefined && sendBy - this.now() < 300) {
      throw new SleepIQError('timeout', 'no time left to send the command', { notSent: true });
    }
    return this.call(method, path, { payload, query, onSent, signal });
  }

  /** The body of a bamkey call (asyncsleepiq's bamkey). */
  static bamkeyPayload(key, args = []) {
    return { args: args.join(' '), key: BAMKEY[key], sourceApplication: SOURCE_APPLICATION };
  }

  /** A bamkey read of a fuzion bed: its text. */
  async bamkey(account, bed, key, args = [], options = {}) {
    const json = await this.read(PATHS.bamkey(account, bed), {
      ...options,
      method: 'PUT',
      payload: SleepIQClient.bamkeyPayload(key, args),
    });
    return bamkeyText(json);
  }

  /** A bamkey command of a fuzion bed (sent once). */
  async bamkeyCommand(account, bed, key, args = [], options = {}) {
    const json = await this.command('PUT', PATHS.bamkey(account, bed), {
      ...options,
      payload: SleepIQClient.bamkeyPayload(key, args),
    });
    return bamkeyText(json);
  }
}
