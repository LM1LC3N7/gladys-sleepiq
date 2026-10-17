// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { validTimezone } from './model.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  allow_commands: false,
  timezone: 'America/Chicago',
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the e-mail: the account a key belongs to, without the e-mail itself. */
export const accountKey = (email) =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

/** A boolean field: only `true` (or the strings Gladys may send) turns it on. */
const flag = (value) => value === true || value === 'true' || value === 1 || value === '1';

export function normalizeConfig(raw = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const timezone = String(raw?.timezone ?? '').trim();
  return {
    email,
    password,
    /** The hash of the e-mail: the key and the stops in /data belong to it. */
    account: email === '' ? '' : accountKey(email),
    allowCommands: flag(raw?.allow_commands),
    timezone: validTimezone(timezone) ? timezone : DEFAULTS.timezone,
    /** The time zone typed, when it is not one Node knows (logged; the default is used). */
    invalidTimezone:
      timezone !== '' && !validTimezone(timezone) ? timezone.slice(0, 64) : undefined,
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
