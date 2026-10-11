(() => {
  'use strict';

  const TOTAL_DOORS = 24;
  const STORAGE_KEY = 'binaer-julekalender:v2';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const calendar = document.getElementById('calendar');
  const resetButton = document.getElementById('reset');

  // State

  const isDay = (n) => Number.isInteger(n) && n >= 1 && n <= TOTAL_DOORS;

  const shuffledDays = () => {
    const days = Array.from({ length: TOTAL_DOORS }, (_, i) => i + 1);
    for (let i = days.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [days[i], days[j]] = [days[j], days[i]];
    }
    return days;
  };

  const isValidOrder = (order) =>
    Array.isArray(order) && order.length === TOTAL_DOORS && new Set(order.filter(isDay)).size === TOTAL_DOORS;

  const loadState = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const progress = isDay(stored.progress) ? stored.progress : 0;
      const opened = Array.isArray(stored.opened) ? stored.opened.filter((n) => isDay(n) && n <= progress) : [];
      return {
        order: isValidOrder(stored.order) ? stored.order : shuffledDays(),
        opened: new Set(opened),
        progress
      };
    } catch {
      return { order: shuffledDays(), opened: new Set(), progress: 0 };
    }
  };

  const state = loadState();

  const saveState = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ order: state.order, opened: [...state.opened], progress: state.progress })
      );
    } catch {
      // Private mode or storage full: the calendar still works for this session.
    }
  };

  const isUnlocked = (day) => day <= state.progress + 1;

  // Sound

  const SOUND_URLS = { door: 'binaryXmas04.mp3', final: 'binaryXmas03.mp3' };
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const sound = { ctx: AudioContextClass ? new AudioContextClass() : null, buffers: {}, elements: {}, current: null };

  Object.entries(SOUND_URLS).forEach(([name, url]) => {
    const element = new Audio(url);
    element.preload = 'auto';
    sound.elements[name] = element;
  });

  if (sound.ctx && window.location.protocol !== 'file:') {
    Object.entries(SOUND_URLS).forEach(([name, url]) => {
      fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => sound.ctx.decodeAudioData(data))
        .then((buffer) => {
          sound.buffers[name] = buffer;
        })
        .catch((error) => console.warn(`Kunne ikke indlæse ${url}:`, error));
    });
  }

  const stopSound = () => {
    const current = sound.current;
    if (!current) return;
    if (current instanceof HTMLMediaElement) {
      current.pause();
    } else {
      try {
        current.stop();
      } catch {
        // Already stopped.
      }
    }
    sound.current = null;
  };

  const playSound = (name) => {
    stopSound();

    const buffer = sound.buffers[name];
    if (sound.ctx && buffer) {
      if (sound.ctx.state !== 'running') sound.ctx.resume();
      const source = sound.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(sound.ctx.destination);
      source.start();
      sound.current = source;
      return;
    }

    const element = sound.elements[name];
    if (!element) return;
    element.currentTime = 0;
    element.play().catch((error) => console.warn(`Kunne ikke afspille ${SOUND_URLS[name]}:`, error));
    sound.current = element;
  };

  const animationMs = () => {
    if (reducedMotion.matches) return 0;
    const value = getComputedStyle(document.documentElement).getPropertyValue('--dur').trim();
    return Number.parseFloat(value) || 900;
  };

  // Doors

  const doorContent = (day) =>
    day === TOTAL_DOORS
      ? '<span class="door__code">Xmas = 1<span class="door__cursor">_</span></span><img class="door__image" src="tree.png" alt="" draggable="false">'
      : '<span class="door__code">Xmas</span><span class="door__code">= 0<span class="door__cursor">_</span></span>';

  const toBinary = (day) => day.toString(2);

  const createDoor = (day, position) => {
    const door = document.createElement('button');

    door.type = 'button';
    door.className = 'door';
    door.dataset.day = String(day);
    door.style.setProperty('--i', String(position));
    if (day === TOTAL_DOORS) door.classList.add('door--final');

    door.innerHTML = `
      <span class="door__inside" aria-hidden="true">${doorContent(day)}</span>
      <span class="door__front" aria-hidden="true">
        <span class="door__face door__face--front">
          <span class="door__number">${toBinary(day)}</span>
        </span>
        <span class="door__face door__face--back"></span>
      </span>
    `;

    updateDoor(door);
    return door;
  };

  function updateDoor(door) {
    const day = Number(door.dataset.day);
    const isOpen = state.opened.has(day);
    const content = day === TOTAL_DOORS ? 'Xmas = 1 og et juletræ' : 'Xmas = 0';

    let label = `Låge ${day}, lukket. Tryk for at åbne.`;
    if (isOpen) label = `Låge ${day}, åben: ${content}. Tryk for at lukke.`;
    else if (!isUnlocked(day)) label = `Låge ${day}, låst. Åbn låge ${state.progress + 1} først.`;

    door.classList.toggle('is-open', isOpen);
    door.setAttribute('aria-pressed', String(isOpen));
    door.setAttribute('aria-label', label);
  }

  const updateAllDoors = () => calendar.querySelectorAll('.door').forEach(updateDoor);

  const rejectDoor = (door) => {
    door.classList.remove('is-locked');
    void door.offsetWidth;
    door.classList.add('is-locked');
  };

  const toggleDoor = (door) => {
    if (door.classList.contains('is-moving')) return;

    const day = Number(door.dataset.day);
    const isOpen = !state.opened.has(day);

    if (isOpen && !isUnlocked(day)) {
      rejectDoor(door);
      return;
    }

    if (isOpen) {
      state.opened.add(day);
      state.progress = Math.max(state.progress, day);
      playSound(day === TOTAL_DOORS ? 'final' : 'door');
    } else {
      state.opened.delete(day);
    }

    door.classList.add('is-moving');
    saveState();
    updateAllDoors();

    window.setTimeout(() => door.classList.remove('is-moving'), animationMs());
  };

  const render = () => {
    const fragment = document.createDocumentFragment();
    state.order.forEach((day, position) => fragment.appendChild(createDoor(day, position)));
    calendar.replaceChildren(fragment);
  };

  calendar.addEventListener('click', (event) => {
    const door = event.target.closest('.door');
    if (door && calendar.contains(door)) toggleDoor(door);
  });

  calendar.addEventListener('animationend', (event) => {
    if (event.animationName === 'shake') event.target.closest('.door')?.classList.remove('is-locked');
  });

  resetButton.addEventListener('click', () => {
    state.order = shuffledDays();
    state.opened.clear();
    state.progress = 0;
    saveState();
    render();
  });

  render();

  // Binary snow beside the title, ending where the doors begin

  const snowCanvas = document.getElementById('snow');
  const snowCtx = snowCanvas.getContext('2d');
  const header = document.querySelector('.header');
  const SNOW_SIZES = [8, 10, 12];
  const SNOW_TITLE_MARGIN = 16;
  const SNOW_DOOR_MARGIN = 6;

  const snow = { width: 0, height: 0, zones: [], flakes: [], last: 0, running: false };

  const randomChar = () => (Math.random() < 0.5 ? '0' : '1');

  const placeFlake = (flake, fromTop) => {
    const total = snow.zones.reduce((sum, zone) => sum + zone.width, 0);
    let pick = Math.random() * total;
    const zone = snow.zones.find((z) => (pick -= z.width) <= 0) || snow.zones[0];

    flake.size = SNOW_SIZES[Math.floor(Math.random() * SNOW_SIZES.length)];
    flake.x = zone.start + Math.random() * Math.max(0, zone.width - flake.size);
    flake.y = fromTop ? -flake.size - Math.random() * snow.height * 0.3 : Math.random() * snow.height;
    flake.speed = 14 + flake.size * 2.5 + Math.random() * 10;
    flake.sway = 0.6 + Math.random() * 1.2;
    flake.phase = Math.random() * Math.PI * 2;
    flake.char = randomChar();
    flake.zone = zone;
    return flake;
  };

  const measureSnow = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bodyTop = document.body.getBoundingClientRect().top;
    const headerRect = header.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = Math.max(0, Math.floor(calendar.getBoundingClientRect().top - bodyTop - SNOW_DOOR_MARGIN));

    snow.width = width;
    snow.height = height;
    snow.zones = [
      { start: 0, width: headerRect.left - SNOW_TITLE_MARGIN },
      { start: headerRect.right + SNOW_TITLE_MARGIN, width: width - headerRect.right - SNOW_TITLE_MARGIN }
    ].filter((zone) => zone.width >= 12);

    snowCanvas.style.width = `${width}px`;
    snowCanvas.style.height = `${height}px`;
    snowCanvas.width = Math.round(width * dpr);
    snowCanvas.height = Math.round(height * dpr);
    snowCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    snowCtx.imageSmoothingEnabled = false;

    const zoneArea = snow.zones.reduce((sum, zone) => sum + zone.width, 0) * height;
    const target = snow.zones.length ? Math.min(140, Math.round(zoneArea / 1800)) : 0;

    snow.flakes.length = Math.min(snow.flakes.length, target);
    snow.flakes.forEach((flake) => {
      const fits = snow.zones.find((z) => flake.x >= z.start && flake.x + flake.size <= z.start + z.width);
      if (fits) flake.zone = fits;
      else placeFlake(flake, false);
    });
    while (snow.flakes.length < target) snow.flakes.push(placeFlake({}, false));

    drawSnow(0);
  };

  function drawSnow(dt) {
    const time = performance.now() / 1000;
    let font = 0;

    snowCtx.clearRect(0, 0, snow.width, snow.height);
    snowCtx.fillStyle = '#FFFFFF';
    snowCtx.textBaseline = 'top';

    snow.flakes.forEach((flake) => {
      flake.y += flake.speed * dt;
      if (flake.y > snow.height) placeFlake(flake, true);
      if (Math.random() < dt * 0.25) flake.char = flake.char === '0' ? '1' : '0';

      if (font !== flake.size) {
        font = flake.size;
        snowCtx.font = `${font}px "Press Start 2P", ui-monospace, Menlo, monospace`;
      }

      const sway = Math.sin(time * flake.sway + flake.phase) * 3;
      const x = Math.round((flake.x + sway) / 2) * 2;
      const y = Math.round(flake.y / 2) * 2;
      snowCtx.fillText(flake.char, x, y);
    });
  }

  const snowLoop = (now) => {
    if (reducedMotion.matches) {
      snow.running = false;
      return;
    }
    const dt = Math.min(0.05, (now - snow.last) / 1000);
    snow.last = now;
    drawSnow(dt);
    window.requestAnimationFrame(snowLoop);
  };

  const startSnow = () => {
    if (snow.running || reducedMotion.matches) return;
    snow.running = true;
    snow.last = performance.now();
    window.requestAnimationFrame(snowLoop);
  };

  new ResizeObserver(measureSnow).observe(document.body);
  new ResizeObserver(measureSnow).observe(header);
  window.addEventListener('resize', measureSnow);
  reducedMotion.addEventListener('change', startSnow);
  if (document.fonts) document.fonts.ready.then(measureSnow);

  measureSnow();
  startSnow();

  // App icons & manifest (generated so the app only needs three files)

  const drawIcon = (size) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const unit = size / 16;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = unit * 0.5;
    ctx.strokeRect(unit * 1.5, unit * 1.5, size - unit * 3, size - unit * 3);

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(unit * 7)}px "Press Start 2P", ui-monospace, Menlo, monospace`;
    ctx.fillText('1', size / 2 + unit * 0.4, size * 0.44);

    ctx.font = `${Math.round(unit * 1.6)}px "Press Start 2P", ui-monospace, Menlo, monospace`;
    ctx.fillText('XMAS', size / 2, size * 0.77);

    return canvas.toDataURL('image/png');
  };

  const setupIcons = async () => {
    if (document.fonts && document.fonts.load) {
      const timeout = new Promise((resolve) => window.setTimeout(resolve, 1500));
      await Promise.race([document.fonts.load('16px "Press Start 2P"').catch(() => {}), timeout]);
    }

    const icon180 = drawIcon(180);
    const icon192 = drawIcon(192);
    const icon512 = drawIcon(512);

    document.getElementById('apple-touch-icon').href = icon180;

    const base = new URL('./', window.location.href).href;
    const manifest = {
      name: 'Binær Julekalender',
      short_name: 'Binær Jul',
      description: 'Christmas = 0 … indtil den bliver 1.',
      lang: 'da',
      start_url: base,
      scope: base,
      display: 'standalone',
      orientation: 'any',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    };

    document.getElementById('manifest').href =
      'data:application/manifest+json;charset=utf-8,' + encodeURIComponent(JSON.stringify(manifest));
  };

  setupIcons();
})();
