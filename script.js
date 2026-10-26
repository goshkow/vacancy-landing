import { NODES, EDGES, SCENARIO_IDS, scenarioLabel, buildRun, DOKKY_QUESTIONS, findQuestion, APP_FLOW, APP_DIFF, INTRO_NODES, INTRO_EDGES, INTRO_RUN } from './demo-data.js?v=20261021-key';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const SVG_NS = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') el.style.cssText = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) el.append(child);
  return el;
}

function icon(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${id}`);
  svg.append(use);
  return svg;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, reduced.matches ? Math.min(ms, 60) : ms));
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const segment = (p, from, to) => clamp((p - from) / (to - from));
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// запускает колбэк один раз, когда элемент заметно виден
function onceVisible(el, callback, threshold = .4) {
  if (!el) return;
  const io = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      io.disconnect();
      callback();
    }
  }, { threshold });
  io.observe(el);
}

/* навигация */
function initNav() {
  const nav = document.querySelector('[data-nav]');
  const toggle = nav.querySelector('[data-nav-toggle]');
  const links = [...nav.querySelectorAll('.nav__links a')];
  const setOpen = open => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  links.forEach(link => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
  document.addEventListener('click', event => {
    if (nav.classList.contains('is-open') && !nav.contains(event.target)) setOpen(false);
  });

  const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      links.forEach(link => {
        if (link.getAttribute('href') === `#${entry.target.id}`) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach(section => io.observe(section));
}

/* появление блоков */
function initReveal() {
  const items = [...document.querySelectorAll('.reveal')];
  const groups = new Map();
  items.forEach(item => {
    const index = groups.get(item.parentElement) ?? 0;
    groups.set(item.parentElement, index + 1);
    item.style.setProperty('--delay', `${Math.min(index, 4) * 90}ms`);
  });
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  items.forEach(item => io.observe(item));
}

/* общий вид блока: иконка, название, подпись и место под статус */
function buildNode(node, tag = 'div', attrs = {}) {
  return h(tag, { class: `node node--${node.kind}`, ...attrs },
    h('span', { class: 'node__icon' }, icon(node.icon)),
    h('span', { class: 'node__text' }, h('span', { class: 'node__title', text: node.title }), h('span', { class: 'node__preview', text: node.preview })),
    h('span', { class: 'node__state', 'data-state': '' })
  );
}

/* hero: сборка сценария. всё состояние - функция от прогресса 0..1: до ключевой точки его двигает прокрутка, дальше время */
const INTRO = {
  flatten: [.02, .15], cursorIn: [.12, .2], click: [.2, .235], emptyOut: [.23, .28],
  build: [.28, .71], toRun: [.71, .75], leave: [.76, .81], run: [.76, .85], out: [.86, .97]
};

function initIntro() {
  const root = document.querySelector('[data-intro]');
  if (!root) return;
  const q = sel => root.querySelector(sel);
  const stage = q('.intro__stage');
  const win = q('[data-intro-win]');
  const copy = q('[data-intro-copy]');
  const title = q('[data-intro-title]');
  const canvas = q('[data-intro-canvas]');
  const scene = q('[data-intro-scene]');
  const svg = q('[data-intro-edges]');
  const empty = q('[data-intro-empty]');
  const create = q('[data-intro-create]');
  const runBtn = q('[data-intro-run]');
  const cursor = q('[data-intro-cursor]');
  const status = q('[data-intro-status]');
  const chip = q('[data-intro-chip]');

  const nodes = {};
  INTRO_NODES.forEach(node => {
    const el = buildNode({ ...node, title: node.draft ?? node.title });
    scene.append(el);
    nodes[node.id] = { el, titleEl: el.querySelector('.node__title'), stateEl: el.querySelector('[data-state]'), node };
  });
  const runEdges = new Set(INTRO_RUN.slice(1).map((id, i) => `${INTRO_RUN[i]}>${id}`));
  const edges = INTRO_EDGES.map(([from, to]) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'iedge');
    path.setAttribute('pathLength', '1');
    const flow = document.createElementNS(SVG_NS, 'path');
    svg.append(path, flow);
    const onRun = runEdges.has(`${from}>${to}`);
    flow.setAttribute('class', onRun ? 'iflow is-run' : 'iflow');
    return { from, to, path, flow, onRun };
  });

  // слоты сборки: по одному на блок, после блока e - его переименование
  const slots = [];
  INTRO_NODES.forEach(node => {
    slots.push({ type: 'add', id: node.id });
    if (node.draft) slots.push({ type: 'rename', id: node.id });
  });
  const slotLen = (INTRO.build[1] - INTRO.build[0]) / slots.length;
  const slotStart = i => INTRO.build[0] + i * slotLen;
  const addSlot = Object.fromEntries(slots.map((slot, i) => [slot, i]).filter(([slot]) => slot.type === 'add').map(([slot, i]) => [slot.id, i]));
  const renameSlot = slots.findIndex(slot => slot.type === 'rename');

  let geo = null;
  let last = -1;

  // координаты внутри окна без учёта его transform: offsetLeft/Top не зависят от наклона
  const offsetIn = (el, x, y) => {
    let cur = el;
    while (cur && cur !== win) { x += cur.offsetLeft; y += cur.offsetTop; cur = cur.offsetParent; }
    return [x, y];
  };

  const measure = () => {
    const mode = canvas.clientWidth < 560 ? 'narrow' : 'wide';
    const nw = mode === 'narrow' ? 160 : 200;
    win.classList.toggle('is-narrow', mode === 'narrow');
    Object.values(nodes).forEach(item => { item.el.style.width = `${nw}px`; });
    const nh = nodes.a.el.offsetHeight;
    const pts = INTRO_NODES.map(node => node[mode]);
    const W = Math.max(...pts.map(p => p[0])) + nw;
    const H = Math.max(...pts.map(p => p[1])) + nh;
    const pad = mode === 'narrow' ? 12 : 28;
    const scale = Math.min(1, (canvas.clientWidth - pad * 2) / W, (canvas.clientHeight - pad * 2) / H);
    const left = (canvas.clientWidth - W * scale) / 2;
    const top = (canvas.clientHeight - H * scale) / 2;
    scene.style.width = `${W}px`;
    scene.style.height = `${H}px`;
    scene.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    const target = {};
    const spawn = {};
    INTRO_NODES.forEach(node => {
      target[node.id] = node[mode];
      spawn[node.id] = node.spawn?.[mode] ?? [node[mode][0] + (mode === 'narrow' ? 14 : 26), node[mode][1] + (mode === 'narrow' ? 22 : 34)];
    });
    for (const edge of edges) {
      const [fx, fy] = target[edge.from];
      const [tx, ty] = target[edge.to];
      let d;
      if (mode === 'wide') {
        const x1 = fx + nw, y1 = fy + nh / 2, x2 = tx - 6, y2 = ty + nh / 2, mx = (x1 + x2) / 2;
        d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
      } else {
        const x1 = fx + nw / 2, y1 = fy + nh, x2 = tx + nw / 2, y2 = ty - 6, my = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      }
      edge.path.setAttribute('d', d);
      edge.flow.setAttribute('d', d);
    }

    const canvasAt = offsetIn(canvas, 0, 0);
    const center = ([x, y]) => [canvasAt[0] + left + (x + nw / 2) * scale, canvasAt[1] + top + (y + nh / 2) * scale];
    const createAt = offsetIn(create, create.offsetWidth / 2, create.offsetHeight / 2);
    const runAt = offsetIn(runBtn, runBtn.offsetWidth / 2, runBtn.offsetHeight / 2);
    const outside = [win.offsetWidth + 60, win.offsetHeight + 60];

    // маршрут курсора: точки [прогресс, x, y], между ними плавный переход
    const keys = [[INTRO.cursorIn[0], ...outside], [INTRO.cursorIn[1], ...createAt], [INTRO.build[0], ...createAt]];
    slots.forEach((slot, i) => {
      const s = slotStart(i);
      if (slot.type === 'add') {
        keys.push([s + slotLen * .35, ...center(spawn[slot.id])], [s + slotLen * .45, ...center(spawn[slot.id])], [s + slotLen * .7, ...center(target[slot.id])]);
      } else {
        keys.push([s + slotLen * .3, ...center(target[slot.id])], [s + slotLen, ...center(target[slot.id])]);
      }
    });
    keys.push([INTRO.toRun[1], ...runAt], [INTRO.leave[0], ...runAt], [INTRO.leave[1], ...outside]);

    // где окно стоит в начале: прямо под текстом hero
    const winTop = win.offsetTop;
    const copyBottom = copy.offsetTop + copy.offsetHeight;
    geo = {
      nw, nh, target, spawn, keys,
      lift: Math.max(0, copyBottom + 28 - winTop),
      flyUp: winTop + win.offsetHeight + 80
    };
    last = -1;
  };

  const cursorAt = p => {
    const { keys } = geo;
    if (p <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i += 1) {
      if (p <= keys[i][0]) {
        const [p0, x0, y0] = keys[i - 1];
        const [p1, x1, y1] = keys[i];
        const t = ease(p1 === p0 ? 1 : (p - p0) / (p1 - p0));
        return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
      }
    }
    return keys.at(-1).slice(1);
  };

  const inRange = (p, a, b) => p >= a && p <= b;

  const render = p => {
    if (!geo || p === last) return;
    last = p;
    const flat = ease(segment(p, ...INTRO.flatten));
    const out = ease(segment(p, ...INTRO.out));

    copy.style.opacity = String(1 - segment(p, 0, .06));
    copy.style.transform = `translateY(${-segment(p, 0, .1) * 60}px)`;
    copy.style.visibility = p > .07 ? 'hidden' : '';
    win.style.transform = `translateY(${(1 - flat) * geo.lift - out * geo.flyUp}px) perspective(1800px) rotateX(${(1 - flat) * 34}deg) scale(${.9 + .1 * flat - .06 * out})`;
    win.style.opacity = String(1 - segment(p, .92, .97));
    const t = ease(segment(p, .91, .99));
    title.style.opacity = String(t);
    title.style.transform = `translateY(${(1 - t) * 80}px) scale(${.94 + .06 * t})`;

    // пустое окно и кнопка «Создать»
    const gone = segment(p, ...INTRO.emptyOut);
    empty.style.opacity = String(1 - gone);
    empty.style.transform = `scale(${1 - gone * .06})`;
    empty.style.visibility = gone >= 1 ? 'hidden' : '';
    create.classList.toggle('is-pressed', inRange(p, INTRO.click[0] + .006, INTRO.click[1] - .004));

    // блоки: появляются под курсором и перетаскиваются на место
    for (const node of INTRO_NODES) {
      const item = nodes[node.id];
      const s = slotStart(addSlot[node.id]);
      const k = segment(p, s, s + slotLen);
      const show = segment(k, .35, .45);
      const drag = ease(segment(k, .45, .7));
      const [sx, sy] = geo.spawn[node.id];
      const [tx, ty] = geo.target[node.id];
      item.el.style.transform = `translate(${sx + (tx - sx) * drag}px, ${sy + (ty - sy) * drag}px) scale(${.9 + .1 * show})`;
      item.el.style.opacity = String(show);
      item.el.classList.toggle('is-grabbed', k > .4 && k < .7);
    }
    // переименование: стираем черновик и набираем новое название
    const rename = INTRO_NODES.find(node => node.draft);
    if (rename) {
      const s = slotStart(renameSlot);
      const k = segment(p, s, s + slotLen);
      const erase = segment(k, .4, .55);
      const type = segment(k, .58, .92);
      let text = rename.draft;
      if (k >= .92) text = rename.title;
      else if (type > 0) text = rename.title.slice(0, Math.round(rename.title.length * type));
      else if (erase > 0) text = rename.draft.slice(0, Math.round(rename.draft.length * (1 - erase)));
      const item = nodes[rename.id];
      if (item.titleEl.textContent !== text) item.titleEl.textContent = text;
      item.el.classList.toggle('is-editing', k > .3 && k < .92);
    }

    // связи тянутся после того, как блок встал на место
    const run = segment(p, ...INTRO.run);
    for (const edge of edges) {
      const s = slotStart(addSlot[edge.to]);
      const k = segment(segment(p, s, s + slotLen), .7, 1);
      edge.path.style.strokeDashoffset = String(1 - ease(k));
      edge.path.classList.toggle('is-drawn', k >= 1);
      const lit = edge.onRun && run > (INTRO_RUN.indexOf(edge.from) + .6) / INTRO_RUN.length;
      edge.path.classList.toggle('is-lit', lit);
    }

    // тестовый запуск: блоки по очереди загораются и отмечаются
    INTRO_RUN.forEach((id, i) => {
      const n = INTRO_RUN.length;
      const running = run > i / n && run < (i + 1) / n;
      const done = run >= (i + 1) / n;
      const item = nodes[id];
      item.el.classList.toggle('is-running', running);
      item.el.classList.toggle('is-done', done);
      const state = done ? 'done' : running ? 'run' : '';
      if (item.stateEl.dataset.state !== state) {
        item.stateEl.dataset.state = state;
        item.stateEl.replaceChildren(...(done ? [icon('check')] : running ? [h('span', { class: 'node__spin' })] : []));
      }
    });
    win.classList.toggle('is-live', run >= 1);
    runBtn.classList.toggle('is-pressed', inRange(p, INTRO.toRun[1] - .012, INTRO.toRun[1] + .004));

    const statusText = run >= 1 ? 'Работает' : run > 0 ? 'Выполняется' : 'Черновик';
    if (status.textContent !== statusText) {
      status.textContent = statusText;
      status.className = `studio-app__status${run >= 1 ? ' is-done' : run > 0 ? ' is-running' : ''}`;
    }
    const chipText = p >= INTRO.build[1] ? 'Заявки из Telegram' : 'Новая автоматизация';
    if (chip.textContent !== chipText) chip.textContent = chipText;

    const [cx, cy] = cursorAt(p);
    const pressed = inRange(p, INTRO.click[0] + .006, INTRO.click[1] - .004)
      || slots.some((slot, i) => slot.type === 'add' && inRange(p, slotStart(i) + slotLen * .4, slotStart(i) + slotLen * .7))
      || inRange(p, INTRO.toRun[1] - .012, INTRO.toRun[1] + .004);
    const visible = p > INTRO.cursorIn[0] && p < INTRO.leave[1];
    cursor.style.opacity = visible ? '1' : '0';
    cursor.style.transform = `translate(${cx}px, ${cy}px) scale(${pressed ? .84 : 1})`;
  };

  // без анимации показываем собранный и запущенный сценарий
  if (reduced.matches) {
    root.classList.add('is-static');
    measure();
    render(INTRO.run[1]);
    return;
  }

  // до ключевой точки окно выпрямляется прокруткой. в ключевой точке сцена дальше идёт сама,
  // страница стоит на месте до конца. прокрутку гасим событиями, а не overflow: так не прыгает полоса прокрутки
  const KEY = INTRO.flatten[1];
  const DURATION = 9000;
  let mode = 'idle';
  let startAt = 0;
  let frame = 0;
  let current = 0;
  let scrollFrame = 0;
  const keyY = () => root.offsetTop + root.offsetHeight - window.innerHeight;
  const jump = y => window.scrollTo({ top: y, behavior: 'instant' });
  const finish = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    mode = 'done';
    current = 1;
    render(1);
  };
  const tick = now => {
    current = KEY + (1 - KEY) * clamp((now - startAt) / DURATION);
    render(current);
    if (current >= 1) finish();
    else frame = requestAnimationFrame(tick);
  };
  const play = () => {
    mode = 'playing';
    jump(keyY());
    startAt = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const reset = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    mode = 'idle';
    current = 0;
    render(0);
  };
  const onScroll = () => {
    scrollFrame = 0;
    const y = window.scrollY;
    const key = keyY();
    if (mode === 'playing') {
      if (Math.abs(y - key) > 1) jump(key);
      return;
    }
    // вернулись в самый верх - сцена снова с начала
    if (mode === 'done') {
      if (y <= 1) reset();
      return;
    }
    if (y >= key) play();
    else {
      current = KEY * clamp(y / key);
      render(current);
    }
  };
  window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(onScroll); }, { passive: true });

  window.addEventListener('wheel', event => { if (mode === 'playing') event.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', event => { if (mode === 'playing') event.preventDefault(); }, { passive: false });
  const SCROLL_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ', 'ArrowUp', 'PageUp', 'Home']);
  window.addEventListener('keydown', event => {
    if (mode !== 'playing') return;
    if (event.key === 'Escape') finish();
    else if (SCROLL_KEYS.has(event.key) && !(event.key === ' ' && event.target.closest?.('input, textarea, button, a, [contenteditable]'))) event.preventDefault();
  });
  // переход по ссылке меню не ждёт сцену и не застревает в ключевой точке
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href^="#"]');
    if (link && link.getAttribute('href') !== '#top' && mode !== 'done') finish();
  }, true);

  // при перезагрузке страница открывается сверху, и сцена идёт с начала
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; measure(); render(current); });
  }).observe(stage);
  measure();
  if (location.hash && location.hash !== '#top') finish();
  else {
    jump(0);
    render(0);
  }
  document.fonts?.ready.then(() => { measure(); render(current); });
}

/* галерея карточек */
function initGallery() {
  const root = document.querySelector('[data-gallery]');
  if (!root) return;
  const track = root.querySelector('[data-gallery-track]');
  const items = [...root.querySelectorAll('[data-gallery-item]')];
  const dots = [...root.querySelectorAll('[data-gallery-dot]')];
  const playBtn = root.querySelector('[data-gallery-play]');
  const prevBtn = root.querySelector('[data-gallery-prev]');
  const nextBtn = root.querySelector('[data-gallery-next]');
  const DURATION = 5200;
  let active = 0;
  let playing = !reduced.matches;
  let visible = false;
  let started = 0;
  let elapsed = 0;
  let raf = 0;

  items.forEach(item => item.querySelectorAll('.agents li').forEach((li, i) => li.style.setProperty('--i', i)));

  const setActive = index => {
    active = index;
    items.forEach((item, i) => item.classList.toggle('is-active', i === index));
    dots.forEach((dot, i) => {
      dot.classList.toggle('is-active', i === index);
      dot.setAttribute('aria-current', i === index ? 'true' : 'false');
    });
    items[index].querySelectorAll('[data-count]').forEach(countUp);
  };
  const goTo = index => {
    const item = items[index];
    track.scrollTo({ left: item.offsetLeft - track.offsetLeft - parseFloat(getComputedStyle(track).paddingLeft), behavior: reduced.matches ? 'auto' : 'smooth' });
    setActive(index);
    elapsed = 0;
    started = performance.now();
  };
  const tick = now => {
    raf = 0;
    if (!playing || !visible) return;
    const progress = clamp((elapsed + now - started) / DURATION);
    dots[active].style.setProperty('--progress', progress.toFixed(3));
    if (progress >= 1) goTo((active + 1) % items.length);
    raf = requestAnimationFrame(tick);
  };
  const resume = () => {
    if (raf || !playing || !visible) return;
    started = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    elapsed += performance.now() - started;
  };
  const renderPlay = () => {
    playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    playBtn.querySelector('[data-icon-pause]').hidden = !playing;
    playBtn.querySelector('[data-icon-play]').hidden = playing;
  };

  dots.forEach((dot, i) => dot.addEventListener('click', () => {
    dots.forEach(item => item.style.setProperty('--progress', '0'));
    goTo(i);
  }));
  const step = dir => {
    dots.forEach(item => item.style.setProperty('--progress', '0'));
    goTo((active + dir + items.length) % items.length);
  };
  prevBtn?.addEventListener('click', () => step(-1));
  nextBtn?.addEventListener('click', () => step(1));
  // клик по соседней карточке листает к ней
  items.forEach((item, i) => item.addEventListener('click', event => {
    if (i === active || event.target.closest('a, button')) return;
    dots.forEach(dot => dot.style.setProperty('--progress', '0'));
    goTo(i);
  }));
  track.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1);
  });
  playBtn.addEventListener('click', () => {
    playing = !playing;
    renderPlay();
    if (playing) resume(); else pause();
  });

  // ручная прокрутка ленты тоже меняет активную карточку
  let scrollTimer = 0;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const left = track.scrollLeft + track.clientWidth * .3;
      let index = 0;
      items.forEach((item, i) => { if (item.offsetLeft - track.offsetLeft <= left) index = i; });
      if (index !== active) {
        dots.forEach(item => item.style.setProperty('--progress', '0'));
        setActive(index);
        elapsed = 0;
        started = performance.now();
      }
    }, 120);
  }, { passive: true });

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) resume(); else pause();
  }, { threshold: .35 }).observe(track);

  renderPlay();
  setActive(0);
}

/* счётчики */
const counted = new WeakSet();
function countUp(el) {
  if (counted.has(el)) return;
  counted.add(el);
  const target = Number(el.dataset.count);
  const suffix = el.dataset.suffix ?? '';
  const format = value => `${Math.round(value).toLocaleString('ru-RU')}${suffix}`;
  if (reduced.matches) { el.textContent = format(target); return; }
  const start = performance.now();
  const duration = 1600;
  const step = now => {
    const t = clamp((now - start) / duration);
    el.textContent = format(target * (1 - Math.pow(1 - t, 4)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function initCounters() {
  document.querySelectorAll('.spec [data-count]').forEach(el => onceVisible(el, () => countUp(el), .6));
}

/* Studio */
function renderJSON(target, value) {
  target.textContent = '';
  const write = (val, indent) => {
    const pad = '  '.repeat(indent);
    if (val === null) return target.append(h('span', { class: 'n', text: 'null' }));
    if (typeof val === 'boolean') return target.append(h('span', { class: 'b', text: String(val) }));
    if (typeof val === 'number') return target.append(h('span', { class: 'b', text: String(val) }));
    if (typeof val === 'string') return target.append(h('span', { class: 's', text: JSON.stringify(val) }));
    if (Array.isArray(val)) {
      target.append('[');
      val.forEach((item, i) => { write(item, indent + 1); if (i < val.length - 1) target.append(', '); });
      return target.append(']');
    }
    const entries = Object.entries(val);
    target.append('{\n');
    entries.forEach(([key, item], i) => {
      target.append(`${pad}  `, h('span', { class: 'k', text: JSON.stringify(key) }), ': ');
      write(item, indent + 1);
      target.append(i < entries.length - 1 ? ',\n' : '\n');
    });
    target.append(`${pad}}`);
  };
  write(value, 0);
}

function initStudio() {
  const root = document.querySelector('[data-studio]');
  if (!root) return;
  const canvas = root.querySelector('[data-canvas]');
  const scene = root.querySelector('[data-scene]');
  const edgesSvg = root.querySelector('[data-edges]');
  const nodesLayer = root.querySelector('[data-nodes]');
  const packets = root.querySelector('[data-packets]');
  const statusEl = root.querySelector('[data-studio-status]');
  const picker = root.querySelector('[data-scenarios]');
  const runBtn = root.querySelector('[data-run]');
  const runLabel = runBtn.querySelector('[data-run-label]');
  const feed = root.querySelector('[data-feed]');
  const stepsEl = root.querySelector('[data-steps]');
  const tabs = [...root.querySelectorAll('[data-view]')];

  const state = { scenario: SCENARIO_IDS[0], run: null, token: 0, view: 'chat', done: new Set() };
  const nodeEls = {};
  const edgeEls = {};

  for (const [id, node] of Object.entries(NODES)) {
    const el = buildNode(node, 'button', { type: 'button', 'data-node': id, 'aria-label': `${node.title}. ${node.preview}. Показать данные шага` });
    el.addEventListener('click', () => openStep(id));
    nodesLayer.append(el);
    nodeEls[id] = el;
  }

  // стрелки: обычная и подсвеченная, переключаются вместе с классом связи
  const defs = document.createElementNS(SVG_NS, 'defs');
  for (const [name, color] of [['default', 'var(--st-line-strong)'], ['lit', 'var(--st-run)']]) {
    const marker = document.createElementNS(SVG_NS, 'marker');
    Object.entries({ id: `studio-arrow-${name}`, viewBox: '0 0 12 12', refX: '10', refY: '6', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }).forEach(([k, v]) => marker.setAttribute(k, v));
    const tip = document.createElementNS(SVG_NS, 'path');
    tip.setAttribute('d', 'M 0 0 L 12 6 L 0 12 z');
    tip.style.fill = color;
    marker.append(tip);
    defs.append(marker);
  }
  edgesSvg.append(defs);
  const setLit = (path, on) => {
    path.classList.toggle('is-lit', on);
    path.setAttribute('marker-end', `url(#studio-arrow-${on ? 'lit' : 'default'})`);
  };
  for (const edge of EDGES) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'edge');
    path.setAttribute('marker-end', 'url(#studio-arrow-default)');
    edgesSvg.append(path);
    edgeEls[edge.id] = { path };
  }

  // раскладка: три колонки (L, C, R) и ряды сверху вниз, масштаб по ширине холста
  const layout = () => {
    const narrow = canvas.clientWidth < 520;
    canvas.classList.toggle('is-narrow', narrow);
    const NW = narrow ? 160 : 256;
    const GAP_X = narrow ? 14 : 56;
    const GAP_Y = narrow ? 30 : 30;
    const W = NW * 2 + GAP_X;
    const colX = { L: 0, C: (W - NW) / 2, R: W - NW };
    for (const id of Object.keys(NODES)) nodeEls[id].style.width = `${NW}px`;
    const nh = Math.max(...Object.keys(NODES).map(id => nodeEls[id].offsetHeight));
    const pos = {};
    for (const [id, node] of Object.entries(NODES)) {
      pos[id] = { x: colX[node.pos[0]], y: node.pos[1] * (nh + GAP_Y) };
      nodeEls[id].style.left = `${pos[id].x}px`;
      nodeEls[id].style.top = `${pos[id].y}px`;
    }
    const H = Math.max(...Object.values(pos).map(p => p.y)) + nh;
    for (const edge of EDGES) {
      const a = pos[edge.from], b = pos[edge.to];
      let d;
      if (NODES[edge.from].pos[1] === NODES[edge.to].pos[1]) {
        const y = a.y + nh / 2;
        d = `M ${a.x + NW} ${y} L ${b.x - 5} ${y}`;
      } else {
        const x1 = a.x + NW / 2, y1 = a.y + nh, x2 = b.x + NW / 2, y2 = b.y - 5, my = (y1 + y2) / 2;
        d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      }
      edgeEls[edge.id].path.setAttribute('d', d);
    }
    edgesSvg.setAttribute('width', W);
    edgesSvg.setAttribute('height', H);
    scene.style.width = `${W}px`;
    scene.style.height = `${H}px`;
    const pad = narrow ? 14 : 32;
    const scale = Math.min(1, (canvas.clientWidth - pad * 2) / W);
    scene.style.transform = `translate(${(canvas.clientWidth - W * scale) / 2}px, ${pad}px) scale(${scale})`;
    canvas.style.height = `${Math.ceil(H * scale + pad * 2)}px`;
  };

  // вкладки чат / JSON
  const setView = view => {
    state.view = view;
    tabs.forEach(tab => {
      const on = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    feed.hidden = view !== 'chat';
    stepsEl.hidden = view !== 'json';
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const next = tabs[(i + 1) % tabs.length];
      next.focus();
      next.click();
    });
  });

  const scrollEnd = el => { el.scrollTop = el.scrollHeight; };

  // чат: сообщения клиента и бота, между ними понятные строки о том, что сделал сценарий
  const feedEmpty = () => feed.replaceChildren(h('p', { class: 'feed__empty', text: 'Выберите сообщение клиента сверху. Здесь будет видно, что сценарий делает на каждом шаге.' }));
  const addFeed = el => { feed.querySelector('.feed__empty')?.remove(); feed.append(el); scrollEnd(feed); return el; };
  const voiceBubble = () => {
    const wave = h('span', { class: 'wave', 'aria-hidden': 'true' });
    [6, 12, 16, 9, 14, 18, 8, 13, 17, 10, 6, 12, 15, 7, 11].forEach(px => wave.append(h('i', { style: `height:${px}px` })));
    return h('div', { class: 'bubble bubble--in bubble--voice' }, icon('mic'), wave, h('span', { text: '0:09' }));
  };
  const eventRow = id => h('div', { class: 'ev is-running', 'data-ev': id },
    h('i', { class: 'ev__mark' }, h('span', { class: 'node__spin' })),
    h('div', { class: 'ev__body' }, h('b', { text: `${NODES[id].title}…` }))
  );
  const finishEvent = (row, note) => {
    row.classList.remove('is-running');
    row.querySelector('.ev__mark').replaceChildren(icon('check'));
    const body = row.querySelector('.ev__body');
    body.replaceChildren(h('b', { text: note.text }));
    if (note.detail) body.append(h('small', { class: 'selectable', text: note.detail }));
    if (note.fields?.length) {
      body.append(h('dl', { class: 'ev__fields selectable' }, note.fields.flatMap(([key, value]) => [h('dt', { text: key }), h('dd', { text: value })])));
    }
  };

  // JSON по шагам: у каждого выполненного блока свой вход и выход
  const stepsHint = h('p', { class: 'steps__hint' });
  const stepsList = h('div', { class: 'steps__list' });
  stepsEl.append(stepsHint, stepsList);
  const setHint = text => { stepsHint.textContent = text; };
  const addStep = id => {
    const node = NODES[id];
    const input = h('pre', { class: 'json selectable' });
    const output = h('pre', { class: 'json selectable' });
    const item = h('details', { class: 'step', 'data-step': id },
      h('summary', {}, h('span', { class: `node__icon node--${node.kind}` }, icon(node.icon)), h('b', { text: node.title }), h('i', { class: 'step__state', 'data-step-state': '' }, h('span', { class: 'node__spin' }))),
      h('div', { class: 'step__body' }, h('p', { text: 'Вход' }), input, h('p', { text: 'Выход' }), output)
    );
    renderJSON(input, state.run.data[id].input);
    output.textContent = '…';
    stepsList.append(item);
    return item;
  };
  const finishStep = (item, id) => {
    renderJSON(item.querySelectorAll('pre')[1], state.run.data[id].output);
    item.querySelector('[data-step-state]').replaceChildren(icon('check'));
  };

  // клик по блоку открывает его данные во вкладке JSON
  function openStep(id) {
    Object.entries(nodeEls).forEach(([key, el]) => el.classList.toggle('is-selected', key === id));
    setView('json');
    const item = stepsList.querySelector(`[data-step="${id}"]`);
    if (item) {
      stepsList.querySelectorAll('details').forEach(el => { el.open = el === item; });
      setHint('Вход и выход шага. Нажмите на другой блок слева, чтобы открыть его.');
      item.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' });
    } else if (!state.run) {
      setHint('Запустите сценарий, и здесь появятся данные каждого шага.');
    } else if (state.run.steps.includes(id)) {
      setHint(`«${NODES[id].title}» ещё выполняется.`);
    } else {
      setHint(`«${NODES[id].title}» в этом запуске не выполнялся: условие выбрало другую ветку.`);
    }
  }

  const setStatus = (text, mode) => {
    statusEl.textContent = text;
    statusEl.className = `studio-app__status${mode ? ` is-${mode}` : ''}`;
  };

  const reset = () => {
    state.token += 1;
    state.run = null;
    packets.replaceChildren();
    Object.values(nodeEls).forEach(el => {
      el.classList.remove('is-running', 'is-done', 'is-skipped', 'is-selected');
      el.querySelector('[data-state]').replaceChildren();
    });
    Object.values(edgeEls).forEach(({ path }) => { path.classList.remove('is-dim', 'is-on'); setLit(path, false); });
    feedEmpty();
    stepsList.replaceChildren();
    setHint('Запустите сценарий, и здесь появятся данные каждого шага.');
    setStatus('Готов к запуску');
  };

  // точка бежит по связи; над веткой условия на секунду появляется «да» или «нет»
  const travel = (edgeId, token) => new Promise(resolve => {
    const { path } = edgeEls[edgeId];
    const edge = EDGES.find(item => item.id === edgeId);
    path.classList.add('is-on');
    const total = path.getTotalLength();
    if (edge.branch) {
      const mid = path.getPointAtLength(total / 2);
      const tag = h('span', { class: `branch-tag branch-tag--${edge.branch}`, text: edge.branch === 'true' ? 'да' : 'нет' });
      tag.style.left = `${mid.x}px`;
      tag.style.top = `${mid.y}px`;
      packets.append(tag);
      setTimeout(() => tag.classList.add('is-out'), reduced.matches ? 400 : 1300);
      setTimeout(() => tag.remove(), reduced.matches ? 500 : 1700);
    }
    const dot = h('span', { class: 'packet' });
    packets.append(dot);
    const duration = reduced.matches ? 1 : 420;
    const start = performance.now();
    const step = now => {
      if (token !== state.token) { dot.remove(); return resolve(false); }
      const t = clamp((now - start) / duration);
      const pt = path.getPointAtLength(total * ease(t));
      dot.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      if (t < 1) requestAnimationFrame(step);
      else {
        dot.remove();
        path.classList.remove('is-on');
        setLit(path, true);
        resolve(true);
      }
    };
    requestAnimationFrame(step);
  });

  const play = async () => {
    reset();
    const token = state.token;
    const alive = () => token === state.token;
    const run = buildRun(state.scenario);
    state.run = run;
    runLabel.textContent = 'Выполняется…';
    feed.replaceChildren();

    for (let i = 0; i < run.steps.length; i += 1) {
      const id = run.steps[i];
      const el = nodeEls[id];
      el.classList.add('is-running');
      el.querySelector('[data-state]').replaceChildren(h('span', { class: 'node__spin' }));
      setStatus(NODES[id].title, 'running');

      if (id === 'incoming') {
        addFeed(h('p', { class: 'feed__who', text: 'Клиент' }));
        addFeed(run.channel === 'voice' ? voiceBubble() : h('div', { class: 'bubble bubble--in selectable', text: run.message }));
      }
      const row = addFeed(eventRow(id));
      const step = addStep(id);
      if (id === 'reply') addFeed(h('div', { class: 'bubble bubble--out typing', 'aria-label': 'Печатает' }, h('i'), h('i'), h('i')));
      await sleep(id === 'collect' || id === 'kb' || id === 'stt' ? 700 : 480);
      if (!alive()) return;

      el.classList.remove('is-running');
      el.classList.add('is-done');
      el.querySelector('[data-state]').replaceChildren(icon('check'));
      finishEvent(row, run.notes[id]);
      finishStep(step, id);
      if (id === 'reply') {
        feed.querySelector('.typing')?.replaceWith(h('p', { class: 'feed__who feed__who--out', text: 'Бот' }), h('div', { class: 'bubble bubble--out selectable', text: run.reply }));
      }
      scrollEnd(feed);

      // невыбранная ветка гаснет сразу после условия
      const cut = run.pruned[id];
      if (cut) {
        cut.nodes.forEach(key => nodeEls[key].classList.add('is-skipped'));
        cut.edges.forEach(key => edgeEls[key].path.classList.add('is-dim'));
      }

      const edgeId = run.edges[i];
      if (edgeId) {
        const ok = await travel(edgeId, token);
        if (!ok || !alive()) return;
      }
    }
    runLabel.textContent = 'Запустить снова';
    const summary = run.ready ? 'Готово: сделка в CRM, менеджер в курсе' : 'Готово: клиенту задан уточняющий вопрос';
    setStatus(summary, 'done');
    addFeed(h('p', { class: 'feed__done', text: `${summary} · ${run.steps.length} шагов` }));
  };

  // входящие сообщения
  SCENARIO_IDS.forEach(id => {
    const btn = h('button', { type: 'button', role: 'radio', 'aria-checked': String(id === state.scenario), 'data-scenario': id, text: scenarioLabel(id) });
    btn.tabIndex = id === state.scenario ? 0 : -1;
    btn.addEventListener('click', () => {
      state.scenario = id;
      picker.querySelectorAll('button').forEach(item => {
        const on = item.dataset.scenario === id;
        item.setAttribute('aria-checked', String(on));
        item.tabIndex = on ? 0 : -1;
      });
      play();
    });
    btn.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const list = [...picker.querySelectorAll('button')];
      const next = list[(list.indexOf(btn) + (event.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
      next.focus();
      next.click();
    });
    picker.append(btn);
  });
  runBtn.addEventListener('click', play);

  reset();
  setView('chat');
  layout();
  let resizeFrame = 0;
  new ResizeObserver(() => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; layout(); });
  }).observe(canvas);
  document.fonts?.ready.then(layout);
  onceVisible(root, () => { if (!state.run) play(); }, .45);
}

/* Докки */
// 3D-модель iPhone грузится отдельно: без WebGL остаётся плоская рамка
async function initPhone3d() {
  const frame = document.querySelector('.phone__frame');
  const screen = frame?.querySelector('.phone__screen');
  if (!frame || !screen) return;
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return;
    const { mountPhone } = await import('./assets/vendor/phone3d.js');
    await mountPhone(frame, screen);
  } catch {
    frame.classList.remove('has-webgl');
    screen.style.transform = '';
  }
}

function initDokky() {
  const asks = document.querySelector('[data-asks]');
  const body = document.querySelector('[data-dk-body]');
  const input = document.querySelector('[data-dk-input]');
  if (!asks || !body) return;
  const empty = body.querySelector('[data-dk-empty]');
  let token = 0;
  const buttons = DOKKY_QUESTIONS.map(item => {
    const btn = h('button', { type: 'button', 'aria-pressed': 'false', 'data-ask': item.id, text: item.question });
    btn.addEventListener('click', () => {
      // на узком экране вопросы стоят над телефоном, поэтому подводим к ответу
      const phone = document.querySelector('.phone');
      if (phone && phone.getBoundingClientRect().top > window.innerHeight * .5) {
        phone.scrollIntoView({ block: 'center', behavior: reduced.matches ? 'auto' : 'smooth' });
      }
      ask(item.id);
    });
    asks.append(btn);
    return btn;
  });

  const ask = async id => {
    const item = findQuestion(id);
    const my = ++token;
    const alive = () => my === token;
    buttons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.ask === id)));
    body.replaceChildren();
    empty.hidden = true;

    // вопрос набирается в поле ввода, как в настоящем чате
    input.classList.add('is-typing');
    if (!reduced.matches) {
      for (let i = 1; i <= item.question.length; i += 1) {
        input.textContent = item.question.slice(0, i);
        await new Promise(resolve => setTimeout(resolve, 22));
        if (!alive()) return;
      }
      await sleep(250);
      if (!alive()) return;
    }
    input.textContent = 'Спросить Докки';
    input.classList.remove('is-typing');
    body.append(h('div', { class: 'dk-user', text: item.question }));

    const steps = h('ul', { class: 'dk-steps' });
    body.append(steps);
    for (const text of item.steps) {
      const li = h('li', {}, h('i', {}, h('span', { class: 'node__spin' })), text);
      steps.append(li);
      await sleep(650);
      if (!alive()) return;
      li.querySelector('i').replaceChildren(icon('check'));
    }

    const answer = h('p', { class: 'dk-answer' });
    body.append(answer);
    const words = item.answer.split(' ');
    words.forEach((word, i) => {
      answer.append(h('span', { class: 'wd', style: `animation-delay:${reduced.matches ? 0 : i * 32}ms`, text: word }), i < words.length - 1 ? ' ' : '');
    });
    await sleep(words.length * 32 + 200);
    if (!alive()) return;
    body.append(h('div', { class: 'dk-sources' }, item.sources.map(source => h('a', { href: source.href, text: source.label }))));
    body.scrollTop = body.scrollHeight;
  };

  onceVisible(document.querySelector('.phone'), () => { if (!token) ask(DOKKY_QUESTIONS[0].id); }, .55);
}

/* Докки App */
function initApp() {
  const root = document.querySelector('[data-app]');
  if (!root) return;
  const feed = root.querySelector('[data-app-feed]');
  const replay = root.querySelector('[data-app-replay]');
  const work = {
    context: root.querySelector('[data-w-context]'),
    diff: root.querySelector('[data-w-diff]'),
    plan: root.querySelector('[data-w-plan]')
  };
  const planSteps = APP_FLOW.filter(item => item.type === 'step').map(item => item.text);
  let token = 0;
  // новые строки держим в поле зрения, окно не растёт и не двигает страницу
  new MutationObserver(() => { feed.scrollTop = feed.scrollHeight; }).observe(feed, { childList: true, subtree: true });

  const resetWork = () => {
    work.context.textContent = '0 файлов';
    work.diff.textContent = 'нет';
    work.plan.replaceChildren(...planSteps.map(text => h('li', {}, h('i'), text)));
  };
  const markPlan = n => [...work.plan.children].forEach((li, i) => {
    const done = i < n;
    li.classList.toggle('is-done', done);
    li.querySelector('i').replaceChildren(...(done ? [icon('check')] : []));
  });

  const play = async () => {
    const my = ++token;
    const alive = () => my === token;
    feed.replaceChildren();
    resetWork();
    let stepsDone = 0;
    for (const item of APP_FLOW) {
      if (item.type === 'task') {
        feed.append(h('div', { class: 'kd-task', text: item.text }));
        await sleep(700);
      } else if (item.type === 'step') {
        const row = h('div', { class: 'kd-step is-running' }, h('i', {}, h('span', { class: 'node__spin' })), h('span', { text: item.text }));
        feed.append(row);
        await sleep(800);
        if (!alive()) return;
        row.classList.remove('is-running');
        row.querySelector('i').replaceChildren(icon('check'));
        stepsDone += 1;
        markPlan(stepsDone);
        work.context.textContent = stepsDone === 1 ? '2 файла' : '3 файла';
      } else if (item.type === 'diff') {
        const adds = APP_DIFF.filter(line => line.kind === 'add').length;
        const dels = APP_DIFF.filter(line => line.kind === 'del').length;
        const card = h('div', { class: 'kd-diff', role: 'group', 'aria-label': 'Изменения в файле' });
        feed.append(card);
        for (const line of APP_DIFF) {
          if (line.kind === 'meta') {
            card.append(h('p', { class: 'meta' }, line.text, h('span', { class: 'plus', text: `+${adds}` }), h('span', { class: 'minus', text: `−${dels}` })));
          } else {
            card.append(h('p', { class: line.kind, text: line.text || ' ' }));
            await sleep(110);
          }
          if (!alive()) return;
        }
        work.diff.textContent = `+${adds} −${dels} в api/runs.py`;
        await sleep(500);
      } else if (item.type === 'permission') {
        const allow = h('button', { type: 'button', class: 'kd-allow', text: 'Разрешить' });
        const deny = h('button', { type: 'button', class: 'kd-deny', text: 'Отклонить' });
        const card = h('div', { class: 'kd-perm' },
          h('p', {}, icon('shield'), 'Докки хочет выполнить команду'),
          h('code', { text: item.command }),
          h('div', { class: 'kd-perm__actions' }, allow, deny)
        );
        feed.append(card);
        // агент ждёт решения человека и ничего не запускает сам
        const allowed = await new Promise(resolve => {
          allow.addEventListener('click', () => resolve(true), { once: true });
          deny.addEventListener('click', () => resolve(false), { once: true });
        });
        if (!alive()) return;
        card.classList.add('is-answered');
        card.append(h('span', { class: 'kd-perm__done', text: allowed ? 'Разрешено человеком' : 'Отклонено человеком' }));
        if (!allowed) {
          feed.append(h('div', { class: 'kd-result kd-result--muted' }, h('b', { text: 'Отклонено' }), h('span', { text: 'Команда не выполнена. Правка осталась на просмотр, её можно откатить.' })));
          return;
        }
        const row = h('div', { class: 'kd-step is-running' }, h('i', {}, h('span', { class: 'node__spin' })), h('span', { text: `Запускаю ${item.command}` }));
        feed.append(row);
        await sleep(1100);
        if (!alive()) return;
        row.classList.remove('is-running');
        row.querySelector('i').replaceChildren(icon('check'));
      } else if (item.type === 'result') {
        feed.append(h('div', { class: 'kd-result' }, h('b', { text: item.text }), h('span', { text: item.detail })));
      }
      if (!alive()) return;
    }
  };

  resetWork();
  replay.addEventListener('click', play);
  onceVisible(root, play, .4);
}

/* копирование почты */
function initCopy() {
  document.querySelectorAll('[data-copy]').forEach(btn => {
    const label = btn.querySelector('[data-copy-label]');
    const original = label.textContent;
    let timer = 0;
    btn.addEventListener('click', async () => {
      clearTimeout(timer);
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard');
        await navigator.clipboard.writeText(btn.dataset.copy);
        label.textContent = 'Почта скопирована';
      } catch {
        window.location.href = `mailto:${btn.dataset.copy}`;
        label.textContent = original;
        return;
      }
      timer = setTimeout(() => { label.textContent = original; }, 2200);
    });
  });
}

initNav();
initReveal();
initIntro();
initGallery();
initCounters();
initStudio();
initDokky();
initPhone3d();
initApp();
initCopy();
