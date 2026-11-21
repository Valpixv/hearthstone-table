// Registry of canned gesture scripts: name -> loader for a module whose default export builds a
// HandRecording. Add a line here to make a new script available to `npm run synth -- --script <name>`.
export const SCRIPTS = {
  'pinch-spawn': () => import('./pinch-spawn.js'),
  'grab-and-hold': () => import('./grab-and-hold.js'),
  'gentle-drop': () => import('./gentle-drop.js'),
  'hard-throw': () => import('./hard-throw.js'),
  'poke-die': () => import('./poke-die.js'),
  'flick-die': () => import('./flick-die.js'),
  'two-hand-grab': () => import('./two-hand-grab.js'),
  'jitter-grab': () => import('./jitter-grab.js'),
  'dropout-grab': () => import('./dropout-grab.js'),
};
