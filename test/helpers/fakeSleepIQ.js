// -----------------------------------------------------------------------------
// A fake SleepIQ API behind the transport the integration is given, answering
// like asyncsleepiq expects (`PUT /rest/login` -> `{ key }`, `_k=<key>` on
// every call, bamkey texts for the fuzion beds). Records every request. No
// network.
// -----------------------------------------------------------------------------

import { BAMKEY } from '../../src/constants.js';
import { SleepIQError } from '../../src/sleepiq.js';
import {
  ACCOUNT_ID,
  BED,
  EMAIL,
  FUZION_BED,
  PASSWORD,
  bed,
  familyStatus,
  footWarming,
  foundationStatus,
  foundationSystem,
  fuzionBed,
  sleepData,
  sleepers,
} from '../fixtures/sleepiq.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
});

const CODES = Object.fromEntries(Object.entries(BAMKEY).map(([name, code]) => [code, name]));

export function fakeSleepIQ({ beds = [bed()] } = {}) {
  const server = {
    email: EMAIL,
    password: PASSWORD,
    beds,
    sides: {},
    system: { [BED]: foundationSystem() },
    status: { [BED]: foundationStatus() },
    outlets: { [BED]: { 3: 0, 4: 1 } },
    warming: { [BED]: footWarming() },
    score: 82,
    /** The fuzion bed: bamkey key name -> text answer (per side when an object). */
    bamkeys: {
      GET_PRIVACY_STATE: 'active',
      GET_SYSTEM_CONFIGURATION: 'dual yes yes yes yes no yes yes yes yes yes yes no yes no no',
      GET_FOOT_WARMING_PRESENCE: { left: '1', right: '0' },
      GET_HEIDI_PRESENCE: { left: 'false', right: 'false' },
      GET_CLIMATE_PRESENCE: { left: 'true', right: 'false' },
      GET_ACTUATOR_POSITION: '15',
      GET_CURRENT_PRESET: 'favorite',
      GET_UNDERBED_LIGHT: 'off 0',
      GET_FOOT_WARMING: 'medium 60',
      GET_CLIMATE_MODE: 'cooling_pull_low 120',
      GET_SLEEP_NUMBER_CONTROLS: 'false 30 45',
    },
    /** { method, path, query, json, headers, key } */
    requests: [],
    keys: new Set(),
    /** Every secret ever issued, to check none reaches the logs. */
    secrets: [],
    issued: 0,
    down: false,
    /** One-shot answers: { match(request), status, body, headers, wait, error } */
    queue: [],
    of(path, method) {
      return this.requests.filter((r) => r.path === path && (!method || r.method === method));
    },
    logins() {
      return this.requests.filter((r) => r.path === '/rest/login');
    },
    commands() {
      // Every PUT but the sign-in and the bamkey reads (GET_*).
      return this.requests.filter(
        (r) =>
          r.method === 'PUT' &&
          r.path !== '/rest/login' &&
          !(r.path.endsWith('/bamkey') && String(CODES[r.json?.key] ?? '').startsWith('GET_')),
      );
    },
    bamkeyCalls(name) {
      return this.requests.filter((r) => r.path.endsWith('/bamkey') && CODES[r.json?.key] === name);
    },
    revoke() {
      this.keys.clear();
    },
  };

  server.transport = async (url, { method = 'GET', headers = {}, body, onSent } = {}) => {
    const target = new URL(url);
    const query = Object.fromEntries(target.searchParams);
    const request = {
      method,
      host: target.host,
      path: target.pathname,
      query,
      headers,
      json: body ? JSON.parse(body) : undefined,
      key: query._k,
    };
    server.requests.push(request);
    if (server.down) {
      throw new SleepIQError('network', 'connection refused', { notSent: true });
    }
    onSent?.();
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [entry] = server.queue.splice(forced, 1);
      if (entry.wait) {
        await entry.wait;
      }
      if (entry.error) {
        throw entry.error;
      }
      return answer(entry.status, entry.body, entry.headers);
    }

    if (request.path === '/rest/login') {
      const { login, password } = request.json ?? {};
      if (method !== 'PUT' || login !== server.email || password !== server.password) {
        return answer(401, { Error: { Code: 401, Message: 'Incorrect username or password' } });
      }
      server.issued += 1;
      const key = `key-${server.issued}-secret`;
      server.keys.add(key);
      server.secrets.push(key);
      return answer(
        200,
        { userId: 'user-1', key, registrationState: 13, edpLoginStatus: 200 },
        { 'set-cookie': [`AWSALB=lb${server.issued}; Path=/; Secure`, 'JSESSIONID=abc; HttpOnly'] },
      );
    }
    if (!server.keys.has(request.key)) {
      return answer(401, { Error: { Code: 50002, Message: 'Session is invalid' } });
    }
    const p = request.path.replace(/^\/rest\//, '');
    const route = `${method} ${p}`;
    const bedOf = (id) => server.beds.find((b) => b.bedId === id);
    let m;
    if (route === 'GET bed') {
      return answer(200, { beds: server.beds });
    }
    if (route === 'GET sleeper') {
      return answer(200, sleepers());
    }
    if (route === 'GET bed/familyStatus') {
      return answer(
        200,
        familyStatus(
          server.beds.map((b) => b.bedId),
          server.sides,
        ),
      );
    }
    if (route === 'GET sleepData') {
      return answer(200, sleepData(server.score));
    }
    if ((m = p.match(/^bed\/([^/]+)\/(.+)$/))) {
      const [, id, rest] = m;
      const b = bedOf(decodeURIComponent(id));
      if (!b || b.generation === 'fuzion') {
        return answer(404, { Error: { Code: 404, Message: 'Not found' } });
      }
      const bedId = b.bedId;
      switch (`${method} ${rest}`) {
        case 'GET pauseMode':
          return answer(200, { accountId: ACCOUNT_ID, bedId, pauseMode: 'off' });
        case 'GET foundation/system':
          return server.system[bedId]
            ? answer(200, server.system[bedId])
            : answer(404, { Error: { Code: 404 } });
        case 'GET foundation/status':
          return answer(200, server.status[bedId]);
        case 'GET foundation/outlet': {
          const setting = server.outlets[bedId]?.[query.outletId];
          return setting === undefined
            ? answer(404, { Error: { Code: 404 } })
            : answer(200, { bedId, outlet: Number(query.outletId), setting, timer: null });
        }
        case 'GET foundation/footwarming':
          return answer(200, server.warming[bedId]);
        case 'PUT sleepNumber':
        case 'PUT foundation/preset':
        case 'PUT foundation/motion':
          return answer(200, {});
        case 'PUT foundation/outlet':
          server.outlets[bedId][request.json.outletId] = request.json.setting;
          return answer(200, {});
        default:
          return answer(404, { Error: { Code: 404 } });
      }
    }
    if ((m = p.match(/^sn\/v1\/accounts\/([^/]+)\/beds\/([^/]+)\/bamkey$/)) && method === 'PUT') {
      const [, account, id] = m;
      if (decodeURIComponent(account) !== ACCOUNT_ID || decodeURIComponent(id) !== FUZION_BED) {
        return answer(404, { Error: { Code: 404 } });
      }
      const name = CODES[request.json?.key];
      const args = String(request.json?.args ?? '').split(' ');
      const value = server.bamkeys[name];
      if (value !== undefined) {
        const text = typeof value === 'object' ? value[args[0]] : value;
        return answer(200, { cdcResponse: `PASS:${text ?? ''}` });
      }
      if (name && !name.startsWith('GET_')) {
        return answer(200, { cdcResponse: 'PASS:' });
      }
      return answer(200, { cdcResponse: 'FAIL:unknown' });
    }
    return answer(404, { Error: { Code: 404 } });
  };

  return server;
}

export { bed, fuzionBed };

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
