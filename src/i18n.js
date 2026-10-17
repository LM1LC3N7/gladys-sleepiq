// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, command errors, device,
// feature and value names), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

const both = (en, fr) => ({ en, fr });

export const SIDE_NAMES = {
  left: both('left side', 'côté gauche'),
  right: both('right side', 'côté droit'),
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  occupied: both('Someone in bed', "Quelqu'un au lit"),
  'in-bed': both('In bed', 'Au lit'),
  firmness: both('Firmness (Sleep Number)', 'Fermeté (Sleep Number)'),
  'set-firmness': both('Set the firmness', 'Régler la fermeté'),
  pressure: both('Pressure (raw)', 'Pression (brute)'),
  'sleep-score': both('Sleep score of last night', 'Score de sommeil de la nuit'),
  'head-position': both('Head position', 'Position de la tête'),
  'foot-position': both('Foot position', 'Position des pieds'),
  'foundation-preset': both('Foundation position', 'Position de la base'),
  'set-foundation-preset': both('Move the foundation to', 'Mettre la base en position'),
  'stop-foundation': both('Stop the foundation', 'Arrêter la base'),
  'night-light': both('Night light', 'Veilleuse'),
  'foot-warming': both('Foot warming', 'Chauffe-pieds'),
  climate: both('Heating / cooling', 'Chauffage / refroidissement'),
};

export const PRESET_NAMES = {
  flat: both('Flat', 'À plat'),
  favorite: both('Favorite', 'Favorite'),
  read: both('Read', 'Lecture'),
  watch_tv: both('Watch TV', 'Télévision'),
  zero_g: both('Zero G', 'Zéro gravité'),
  snore: both('Snore', 'Anti-ronflement'),
  none: both('Not at a preset', 'Hors position enregistrée'),
};

export const FOOT_WARMING_NAMES = {
  off: both('Off', 'Arrêt'),
  low: both('Low', 'Faible'),
  medium: both('Medium', 'Moyen'),
  high: both('High', 'Fort'),
};

export const CLIMATE_NAMES = {
  off: both('Off', 'Arrêt'),
  heating_low: both('Heating, low', 'Chauffage faible'),
  heating_medium: both('Heating, medium', 'Chauffage moyen'),
  heating_high: both('Heating, high', 'Chauffage fort'),
  cooling_low: both('Cooling, low', 'Refroidissement faible'),
  cooling_medium: both('Cooling, medium', 'Refroidissement moyen'),
  cooling_high: both('Cooling, high', 'Refroidissement fort'),
};

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

export const T = {
  noCredentials: both(
    'Enter the e-mail and the password of your SleepIQ account (those of the SleepIQ app).',
    "Saisissez l'e-mail et le mot de passe de votre compte SleepIQ (ceux de l'application SleepIQ).",
  ),
  connecting: both('Signing in to SleepIQ…', 'Connexion à SleepIQ…'),
  connected: (beds) =>
    both(
      `Connected to SleepIQ: ${beds} bed${beds > 1 ? 's' : ''}. Open Discovery to add ${beds > 1 ? 'them' : 'it'}.`,
      `Connecté à SleepIQ : ${beds} lit${beds > 1 ? 's' : ''}. Ouvrez Découverte pour ${beds > 1 ? 'les ajouter' : "l'ajouter"}.`,
    ),
  noBed: both(
    'Connected to SleepIQ, but the account has no bed.',
    "Connecté à SleepIQ, mais le compte n'a aucun lit.",
  ),
  refused: (wait) =>
    both(
      `SleepIQ refused the e-mail or the password: check them in the configuration. One new try in ${wait.en}, or save corrected credentials, or click "Test the connection".`,
      `SleepIQ a refusé l'e-mail ou le mot de passe : vérifiez-les dans la configuration. Nouvel essai dans ${wait.fr}, ou enregistrez des identifiants corrigés, ou cliquez sur « Tester la connexion ».`,
    ),
  loginRejected: (status, wait) =>
    both(
      `The sign-in request was rejected (HTTP ${status}): the SleepIQ API has probably changed, update the integration. One new try in ${wait.en}.`,
      `La demande de connexion a été rejetée (HTTP ${status}) : l'API SleepIQ a sans doute changé, mettez l'intégration à jour. Nouvel essai dans ${wait.fr}.`,
    ),
  sessionRefused: (wait) =>
    both(
      `SleepIQ refused the session again right after a new sign-in: the integration paused. New try in ${wait.en}, or click "Test the connection".`,
      `SleepIQ a de nouveau refusé la session juste après une nouvelle connexion : l'intégration est en pause. Nouvel essai dans ${wait.fr}, ou cliquez sur « Tester la connexion ».`,
    ),
  busy: both(
    'A read of SleepIQ is in progress: try again in a minute.',
    'Une lecture de SleepIQ est en cours : réessayez dans une minute.',
  ),
  unreachable: (reason, wait) =>
    both(
      `SleepIQ cannot be reached (${reason}). Next try in ${wait.en}.`,
      `SleepIQ est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
    ),
  rateLimited: (wait) =>
    both(
      `SleepIQ asks to slow down: pausing for ${wait.en}.`,
      `SleepIQ demande de ralentir : pause de ${wait.fr}.`,
    ),
  forbidden: (wait) =>
    both(
      `SleepIQ refuses the requests (HTTP 403): pausing for ${wait.en}.`,
      `SleepIQ refuse les requêtes (HTTP 403) : pause de ${wait.fr}.`,
    ),
  test: {
    refusedWait: (wait) =>
      both(
        `The password was refused a moment ago: wait ${wait.en} before testing again.`,
        `Le mot de passe vient d'être refusé : attendez ${wait.fr} avant de tester à nouveau.`,
      ),
    cooldown: both(
      'Already read less than 30 seconds ago.',
      'Déjà lu il y a moins de 30 secondes.',
    ),
    summary: (lines) => both(lines.map((l) => l.en).join(' '), lines.map((l) => l.fr).join(' ')),
    bed: ({ name, inBed }) =>
      both(
        `${name}: ${inBed.length === 0 ? 'nobody in bed' : `in bed on the ${inBed.map((s) => SIDE_NAMES[s].en).join(' and the ')}`}.`,
        `${name} : ${inBed.length === 0 ? 'personne au lit' : `au lit ${inBed.map((s) => SIDE_NAMES[s].fr).join(' et ')}`}.`,
      ),
  },
};

/** Command errors: one language, the one of the configuration (Gladys shows the message as is). */
export const ERRORS = {
  readOnly: both('This feature is read only.', 'Cette fonctionnalité est en lecture seule.'),
  disabled: both(
    'Commands are disabled: turn on "Allow the commands" in the configuration of the integration.',
    "Les commandes sont désactivées : activez « Autoriser les commandes » dans la configuration de l'intégration.",
  ),
  notConnected: both('Not connected to SleepIQ.', 'Pas connecté à SleepIQ.'),
  invalidValue: both('Invalid value.', 'Valeur invalide.'),
  invalidFirmness: both(
    'The firmness goes from 5 to 100, by 5.',
    'La fermeté va de 5 à 100, par pas de 5.',
  ),
  queuedTooLong: both(
    'The previous command took too long: this one was not sent, try again.',
    "La commande précédente a pris trop de temps : celle-ci n'a pas été envoyée, réessayez.",
  ),
  adjusting: both(
    'The bed is already adjusting its firmness: try again when it is done.',
    'Le lit est déjà en train de régler sa fermeté : réessayez quand il aura fini.',
  ),
  tooSlow: both(
    'SleepIQ answered too slowly: the command was not sent, try again.',
    "SleepIQ a répondu trop lentement : la commande n'a pas été envoyée, réessayez.",
  ),
  unknownState: both(
    'The state of the bed could not be read: the command was not sent.',
    "L'état du lit n'a pas pu être lu : la commande n'a pas été envoyée.",
  ),
  refused: (reason) =>
    both(`SleepIQ refused the command (${reason}).`, `SleepIQ a refusé la commande (${reason}).`),
  unsure: (reason) =>
    both(
      `The command may not have reached SleepIQ (${reason}): check the state before trying again.`,
      `La commande n'est peut-être pas arrivée chez SleepIQ (${reason}) : vérifiez l'état avant de réessayer.`,
    ),
};
