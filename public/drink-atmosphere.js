import {selectedToppings, manualToppings} from './topping-selection.js';
import {drawTopping} from './topping-scene.js';
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
  let readingAreas = [];
  function updateReadingAreas() {
    readingAreas = [...document.querySelectorAll('.hero > div:first-child, .results-heading, #result-status, #feedback-note, footer')].map(element => {
      const box = element.getBoundingClientRect();
      return {left:box.left,right:box.right,top:box.top+scrollY,bottom:box.bottom+scrollY};
    });
  }
  function ingredientOpacity(x, y, radius) {
    return readingAreas.some(box => x+radius>box.left && x-radius<box.right && y+scrollY+radius>box.top && y+scrollY-radius<box.bottom) ? 0.16 : 0.82;
  }
  const particles = Array.from({ length: 36 }, () => ({
    x: Math.random(), y: Math.random(), radius: 13 + Math.random() * 12,
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
    for (const [index, particle] of particles.slice(0, count).entries()) {
      particle.y = (particle.y + delta * particle.speed * slow) % 1;
      const x = particle.x * width + Math.sin(elapsed * 0.4 + particle.phase) * 15;
      const topping = current.toppings[index % current.toppings.length] || '';
      const solid = topping && !/奶蓋|冰淇淋/.test(topping);
      const y = solid ? particle.y * (height + 60) - 30 : height - particle.y * (height + 60);
      const radius = particle.radius * (width < 700 ? 0.9 : 1);
      if (topping) {
        drawTopping(context, topping, x, y, radius, /珍珠|波霸/.test(topping) ? 0 : Math.sin(elapsed * 0.3 + particle.phase) * 0.3, ingredientOpacity(x, y, radius));
      } else {
        context.beginPath();context.arc(x, y, radius * 0.5, 0, Math.PI * 2);
        context.strokeStyle = palette.bubble; context.lineWidth = 1.2; context.stroke();
      }
    }
    // A small settled layer makes the viewport feel like the bottom of a cup.
    const settled = current.toppings.filter(t => !/奶蓋|冰淇淋/.test(t));
    if (settled.length) {
      for (let i = 0; i < Math.ceil(width / 39); i++) {
        const x=i*39+15,y=height-7-(i%3)*9,radius=13+(i%4);
        drawTopping(context, settled[i % settled.length], x, y, radius, (i % 3 - 1) * 0.15, ingredientOpacity(x,y,radius));
      }
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
    updateReadingAreas();
    const inChat = document.querySelector('#chat-mode').getAttribute('aria-pressed') === 'true';
    const filters = inChat ? chat.filters : {
      tea: document.querySelector('#tea-filter').value,
      toppings: manualToppings(),
    };
    current = { tea: teaTheme(filters.tea), toppings: selectedToppings(filters), mood: override || (inChat ? chat.mood : manualMood) };
    root.dataset.tea = current.tea; root.dataset.mood = current.mood;
    root.dataset.animation = enabled ? 'on' : 'off';
    toggle.setAttribute('aria-pressed', String(enabled)); toggle.textContent = `背景動畫：${enabled ? '開' : '關'}`;
    note.textContent = [filters.tea || '日常的一杯', current.toppings.join('＋'), moods[current.mood]].filter(Boolean).join(' · ');
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
  new ResizeObserver(updateReadingAreas).observe(document.querySelector('#main'));
  resize();
}
