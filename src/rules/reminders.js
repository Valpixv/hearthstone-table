// Display-only reminder text for SRD 5.2 conditions (System Reference Document 5.2, CC-BY-4.0).
// Short paraphrases for the table; the DM applies the actual rules.

/** Condition name -> one-line reminder. */
export const CONDITION_REMINDERS = {
  blinded: "Can't see; fails sight checks. Attacks vs it have Advantage; its attacks have Disadvantage.",
  charmed: "Can't attack or harm the charmer; the charmer has Advantage on social checks vs it.",
  deafened: "Can't hear; fails hearing checks.",
  exhaustion: 'Each level: -2 to d20 Tests and -5 ft Speed. Level 6 is death.',
  frightened: "Disadvantage on checks and attacks while the source is in sight; can't move closer to it.",
  grappled: 'Speed 0; Disadvantage on attacks vs anyone but the grappler; the grappler can drag it.',
  incapacitated: "No actions, Bonus Actions or Reactions; concentration breaks; can't speak; Disadvantage on Initiative.",
  invisible: "Can't be seen: its attacks have Advantage, attacks vs it have Disadvantage.",
  paralyzed: 'Incapacitated, Speed 0; fails Str/Dex saves; attacks vs it have Advantage; hits within 5 ft are crits.',
  petrified: 'Turned to stone: Incapacitated, Speed 0, Resistance to all damage, immune to poison; fails Str/Dex saves.',
  poisoned: 'Disadvantage on attack rolls and ability checks.',
  prone: 'Melee attacks vs it have Advantage; ranged have Disadvantage; it crawls; its attacks have Disadvantage.',
  restrained: 'Speed 0; attacks vs it have Advantage; its attacks and Dex saves have Disadvantage.',
  stunned: 'Incapacitated; fails Str/Dex saves; attacks vs it have Advantage.',
  unconscious: 'Incapacitated, Prone, drops what it holds; fails Str/Dex saves; attacks vs it have Advantage; hits within 5 ft are crits.',
};

/** Reminder strings for a list of condition names (or { name } objects). Unknown names are skipped. */
export function conditionReminders(conditionNames = []) {
  return conditionNames.map((k) => CONDITION_REMINDERS[typeof k === 'string' ? k : k?.name]).filter(Boolean);
}
