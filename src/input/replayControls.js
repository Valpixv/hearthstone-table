// Small on-screen transport bar for replay mode: play/pause, step, speed, loop, progress.
// Keys: K play/pause, . step one tick, [ / ] slower / faster, L loop.

export function mountReplayControls(replay) {
  const el = document.createElement('div');
  el.id = 'replay-controls';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Replay controls');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:12px', 'transform:translateX(-50%)', 'z-index:50',
    'display:flex', 'gap:6px', 'align-items:center', 'padding:6px 10px', 'border-radius:10px',
    'background:rgba(20,16,12,.82)', 'color:#f3e6cc', 'font:12px/1.2 system-ui,sans-serif',
    'box-shadow:0 2px 10px rgba(0,0,0,.4)', 'user-select:none', 'max-width:calc(100vw - 32px)', 'flex-wrap:wrap',
  ].join(';');
  const btn = (label, title, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'background:#3a2d20;color:inherit;border:1px solid #6b5338;border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit;min-width:28px';
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    el.appendChild(b);
    return b;
  };
  const name = document.createElement('span');
  name.style.cssText = 'opacity:.8;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  name.textContent = `▶ ${replay.meta?.name ?? replay.url ?? 'replay'}`;
  el.appendChild(name);
  const playBtn = btn('❚❚', 'Play / pause (K)', () => replay.toggle());
  btn('⏭', 'Step one tick (.)', () => replay.step(1));
  btn('−', 'Slower ([)', () => replay.slower());
  const speed = document.createElement('span');
  speed.style.cssText = 'min-width:36px;text-align:center';
  el.appendChild(speed);
  btn('+', 'Faster (])', () => replay.faster());
  const loopBtn = btn('⟲', 'Loop (L)', () => replay.setLoop(!replay.loop));
  const prog = document.createElement('progress');
  prog.max = 1;
  prog.style.cssText = 'width:120px;height:8px';
  el.appendChild(prog);
  const counter = document.createElement('span');
  counter.style.cssText = 'font-variant-numeric:tabular-nums;min-width:74px;text-align:right';
  el.appendChild(counter);
  document.body.appendChild(el);

  const render = () => {
    playBtn.textContent = replay.paused ? '▶' : '❚❚';
    speed.textContent = `${replay.speed}×`;
    loopBtn.style.background = replay.loop ? '#7a5a2a' : '#3a2d20';
    prog.value = replay.duration ? Math.min(1, replay.time / replay.duration) : 0;
    counter.textContent = `${Math.min(replay.frameIndex + 1, replay.frameCount)}/${replay.frameCount}${replay.done ? ' ✓' : ''}`;
  };
  const off = replay.onChange(render);
  render();

  const onKey = (e) => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key === 'k' || e.key === 'K') replay.toggle();
    else if (e.key === '.') replay.step(1);
    else if (e.key === '[') replay.slower();
    else if (e.key === ']') replay.faster();
    else if (e.key === 'l' || e.key === 'L') replay.setLoop(!replay.loop);
    else return;
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  return {
    el,
    remove() {
      off();
      window.removeEventListener('keydown', onKey, true);
      el.remove();
    },
  };
}
