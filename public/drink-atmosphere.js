// Decorative atmosphere only. Never changes recommendation filters or stores messages.
export function detectMood(message = '') {
  const text = message.replace(/(?:不開心|不快樂)/g, '難過').replace(/(?:不是|沒有|不覺得|不感到|不太|不)(?:很|太|再|那麼)?(?:開心|快樂|興奮|難過|傷心|疲累|疲倦|累|焦慮|緊張|煩躁|生氣|放鬆|平靜)/g, '');
  const groups = [
    ['quiet', /焦慮|緊張|煩躁|生氣|壓力很大|壓力大/],
    ['comfort', /難過|傷心|失落|低落|孤單|不開心/],
    ['rest', /疲累|疲倦|好累|很累|累了|放鬆|平靜|休息/],
    ['bright', /開心|快樂|興奮|慶祝|心情好/],
  ];
  // The latest explicit mood phrase wins when a message includes several moods.
  let result = '', position = -1;
  for (const [mood, pattern] of groups) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
      if (match.index > position) { result = mood; position = match.index; }
    }
  }
  return result;
}

export function teaTheme(tea = '') {
  if (/紅茶/.test(tea)) return 'red';
  if (/綠茶|抹茶|碧螺春/.test(tea)) return 'green';
  if (/烏龍|青茶|鐵觀音/.test(tea)) return 'amber';
  return 'default';
}

export function initAtmosphere() {
  const root = document.documentElement;
  const canvas = document.querySelector('#drink-scene');
  const context = canvas.getContext('2d');
  const toggle = document.querySelector('#animation-toggle');
  const moodControl = document.querySelector('#atmosphere-mood');
  const note = document.querySelector('#atmosphere-note');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'drinks-mk2-animation';
  let preference = null;
  try { preference = localStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
  let enabled = preference === 'on' || (preference !== 'off' && !reduced.matches);
  let chat = { filters: {}, mood: '' }, manualMood = '', override = '';
  let frame = 0, lastTime = 0, elapsed = 0, width = 0, height = 0, palette, current;
  const particles = Array.from({ length: 36 }, () => ({
    x: Math.random(), y: Math.random(), radius: 5 + Math.random() * 9,
    speed: 0.018 + Math.random() * 0.025, phase: Math.random() * Math.PI * 2,
  }));
  const moods = { bright: '輕快', rest: '放鬆', comfort: '溫柔', quiet: '安靜' };

  function resize() {
    width = innerWidth; height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    sync();
  }
  function draw(delta = 0) {
    if (!context) return;
    elapsed += delta;
    context.clearRect(0, 0, width, height);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, palette.top); gradient.addColorStop(1, palette.bottom);
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    const slow = current.mood === 'quiet' ? 0.35 : current.mood === 'rest' || current.mood === 'comfort' ? 0.55 : 1;
    const count = current.mood === 'quiet' ? 14 : width < 700 ? 22 : particles.length;
    for (const particle of particles.slice(0, count)) {
      particle.y = (particle.y + delta * particle.speed * slow) % 1;
      const x = particle.x * width + Math.sin(elapsed * 0.4 + particle.phase) * 15;
      const solid = /珍珠|芋圓|椰果|仙草|茶凍|布丁|果肉/.test(current.topping);
      const color = /芋/.test(current.topping) ? '#9e83b1' : /布丁|果肉|茶凍/.test(current.topping) ? '#dfad55' : /椰果|奶蓋|冰淇淋/.test(current.topping) ? '#fff7dc' : '#51372f';
      const y = solid ? particle.y * (height + 60) - 30 : height - particle.y * (height + 60);
      const radius = particle.radius * (width < 700 ? 0.8 : 1);
      context.beginPath();
      if (/椰果|仙草|茶凍/.test(current.topping)) context.roundRect(x - radius, y - radius, radius * 2, radius * 2, 4);
      else context.arc(x, y, radius, 0, Math.PI * 2);
      if (current.topping) {
        context.fillStyle = color;
        context.globalAlpha = 0.24; context.fill();
        context.globalAlpha = 0.22;
        context.beginPath(); context.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.22, 0, Math.PI * 2);
        context.fillStyle = '#fff8ed'; context.fill(); context.globalAlpha = 1;
      } else {
        context.strokeStyle = palette.bubble; context.lineWidth = 1.2; context.stroke();
      }
    }
    // A small settled layer makes the viewport feel like the bottom of a cup.
    if (/珍珠|芋圓|椰果|仙草|茶凍|布丁|果肉/.test(current.topping)) {
      context.fillStyle = /芋/.test(current.topping) ? '#9e83b1' : /布丁|果肉|茶凍/.test(current.topping) ? '#dfad55' : /椰果/.test(current.topping) ? '#fff7dc' : '#51372f';
      context.globalAlpha = 0.16;
      for (let i = 0; i < Math.ceil(width / 42); i++) {
        context.beginPath(); context.arc(i * 43 + 16, height - 6 - (i % 3) * 8, 8 + (i % 4), 0, Math.PI * 2); context.fill();
      }
      context.globalAlpha = 1;
    }
  }
  function animate(time) {
    frame = requestAnimationFrame(animate);
    // Cap drawing at about 30fps; hidden tabs and the off switch cancel the loop.
    if (time - lastTime < 32) return;
    const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
    lastTime = time; draw(delta);
  }
  function sync() {
    cancelAnimationFrame(frame); frame = 0; lastTime = 0;
    const inChat = document.querySelector('#chat-mode').getAttribute('aria-pressed') === 'true';
    const filters = inChat ? chat.filters : {
      tea: document.querySelector('#tea-filter').value,
      topping: document.querySelector('#topping-filter').value,
    };
    current = { tea: teaTheme(filters.tea), topping: filters.topping || '', mood: override || (inChat ? chat.mood : manualMood) };
    if (filters.excludedToppings?.includes(current.topping)) current.topping = '';
    root.dataset.tea = current.tea; root.dataset.mood = current.mood;
    root.dataset.animation = enabled ? 'on' : 'off';
    toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = `背景動畫：${enabled ? '開' : '關'}`;
    note.textContent = [filters.tea || '日常的一杯', current.topping, moods[current.mood]].filter(Boolean).join(' · ');
    const style = getComputedStyle(root);
    palette = { top: style.getPropertyValue('--liquid-top').trim(), bottom: style.getPropertyValue('--liquid-bottom').trim(), bubble: style.getPropertyValue('--bubble').trim() };
    const visible = enabled && !document.hidden && !['catalog', 'favorites', 'graph'].includes(location.hash.slice(1));
    canvas.hidden = !visible;
    if (visible) { draw(); frame = requestAnimationFrame(animate); }
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled; preference = enabled ? 'on' : 'off';
    try { localStorage.setItem(storageKey, preference); } catch { /* Still works for this page. */ }
    sync();
  });
  reduced.addEventListener('change', () => { if (preference !== 'on' && preference !== 'off') enabled = !reduced.matches; sync(); });
  moodControl.addEventListener('change', () => { override = moodControl.value; sync(); });
  document.querySelector('#query').addEventListener('input', event => { manualMood = detectMood(event.target.value); sync(); });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-query], #inspiration')) { manualMood = detectMood(document.querySelector('#query').value); sync(); }
  });
  for (const selector of ['#tea-filter', '#topping-filter']) document.querySelector(selector).addEventListener('change', sync);
  document.querySelector('#recommend-form').addEventListener('reset', () => { manualMood = ''; setTimeout(sync, 0); });
  document.addEventListener('drink-atmosphere', event => {
    if (event.detail?.source === 'chat') {
      chat.filters = event.detail.filters || {};
      if (event.detail.reset) chat.mood = '';
      else chat.mood = detectMood(event.detail.message) || chat.mood;
    }
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('resize', resize);
  resize();
}
