/**
 * Linux Cheatsheet — интерактивность
 * 1. Копирование команд в буфер обмена (с fallback для file:// и HTTP)
 * 2. Живой поиск с плавным скрытием карточек и команд
 * 3. Горячие клавиши: "/" — фокус на поиск, Esc — очистить
 */
(() => {
  'use strict';

  const ANIMATION_MS = 280; // синхронизировано с --duration в CSS

  const searchInput = document.getElementById('search-input');
  const statusEl = document.getElementById('search-status');
  const emptyState = document.getElementById('empty-state');
  const cardsRoot = document.getElementById('cards');
  const toast = document.getElementById('toast');

  const cards = Array.from(cardsRoot.querySelectorAll('.card'));

  // Кэшируем исходные данные, чтобы не читать DOM на каждое нажатие клавиши
  const index = cards.map((card) => {
    const title = card.querySelector('.card__title');
    return {
      card,
      titleEl: title,
      titleText: title.textContent,
      haystack: normalize(`${title.textContent} ${card.dataset.category || ''}`),
      commands: Array.from(card.querySelectorAll('.cmd')).map((cmd) => {
        const codeEl = cmd.querySelector('.cmd__code');
        const descEl = cmd.querySelector('.cmd__desc');
        return {
          el: cmd,
          codeEl,
          codeText: codeEl.textContent,
          haystack: normalize(
            `${codeEl.textContent} ${descEl.textContent} ${cmd.dataset.keywords || ''}`
          ),
        };
      }),
    };
  });

  const totalCommands = index.reduce((sum, c) => sum + c.commands.length, 0);
  const fx = fxEngine();

  /* ---------------------- Утилиты ---------------------- */

  function normalize(str) {
    return str.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function pluralize(n, forms) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  }

  /** Подсвечивает совпадения тегом <mark>, безопасно экранируя текст */
  function highlight(el, original, terms) {
    if (!terms.length) {
      el.textContent = original;
      return;
    }
    const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
    el.innerHTML = escapeHtml(original).replace(pattern, '<mark>$1</mark>');
  }

  /* ---------------------- Показ / скрытие карточек ---------------------- */

  function showCard(card) {
    clearTimeout(card._hideTimer);
    if (!card.classList.contains('is-hidden') && !card.classList.contains('is-hiding')) return;
    card.classList.remove('is-hidden');
    // Форсируем reflow, чтобы transition сработал после display:none
    void card.offsetWidth;
    card.classList.remove('is-hiding');
  }

  function hideCard(card) {
    if (card.classList.contains('is-hidden') || card.classList.contains('is-hiding')) return;
    card.classList.add('is-hiding');
    card._hideTimer = setTimeout(() => card.classList.add('is-hidden'), ANIMATION_MS);
  }

  /* ---------------------- Поиск ---------------------- */

  function runSearch(rawQuery) {
    const query = normalize(rawQuery);
    const terms = query ? query.split(' ').filter(Boolean) : [];
    const matchesAll = (text) => terms.every((t) => text.includes(t));

    let visibleCommands = 0;
    let visibleCards = 0;

    index.forEach((entry) => {
      // Если запрос совпал с названием/категорией карточки — показываем её целиком
      const cardMatches = terms.length > 0 && matchesAll(entry.haystack);
      let cardVisibleCount = 0;

      entry.commands.forEach((cmd) => {
        const visible = !terms.length || cardMatches || matchesAll(cmd.haystack);
        cmd.el.classList.toggle('is-hidden', !visible);
        cmd.el.setAttribute('aria-hidden', String(!visible));
        highlight(cmd.codeEl, cmd.codeText, visible ? terms : []);
        if (visible) cardVisibleCount += 1;
      });

      highlight(entry.titleEl, entry.titleText, cardMatches ? terms : []);

      if (cardVisibleCount > 0) {
        showCard(entry.card);
        visibleCards += 1;
        visibleCommands += cardVisibleCount;
      } else {
        hideCard(entry.card);
      }
    });

    emptyState.hidden = visibleCards > 0;

    statusEl.textContent = terms.length
      ? `Найдено: ${visibleCommands} ${pluralize(visibleCommands, ['команда', 'команды', 'команд'])} из ${totalCommands}`
      : '';
  }

  const debouncedSearch = debounce(() => {
    if (!fx.busy) runSearch(searchInput.value);
  }, 120);

  searchInput.addEventListener('input', () => {
    if (fx.check(searchInput.value)) return;
    debouncedSearch();
  });

  /* ---------------------- Копирование ---------------------- */

  async function copyText(text) {
    // Clipboard API доступен только в безопасном контексте (https / localhost)
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // Fallback для file:// и http
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('Copy command failed');
  }

  let toastTimer;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 1800);
  }

  // Делегирование событий: один обработчик на все кнопки
  cardsRoot.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;

    const cmd = btn.closest('.cmd');
    const text = cmd.querySelector('.cmd__code').textContent.trim();

    clearTimeout(btn._resetTimer);
    btn.classList.remove('is-copied', 'is-error');

    try {
      await copyText(text);
      btn.textContent = 'Скопировано';
      btn.classList.add('is-copied');
      showToast(`Скопировано: ${text}`);
    } catch {
      btn.textContent = 'Ошибка';
      btn.classList.add('is-error');
      showToast('Не удалось скопировать — выделите текст вручную');
    }

    btn._resetTimer = setTimeout(() => {
      btn.textContent = 'Копировать';
      btn.classList.remove('is-copied', 'is-error');
    }, 1600);
  });

  /* ---------------------- Горячие клавиши ---------------------- */

  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

    if (e.key === '/' && !typing) {
      e.preventDefault();
      searchInput.focus();
    }

    if (e.key === 'Escape' && document.activeElement === searchInput && !fx.busy) {
      searchInput.value = '';
      runSearch('');
      searchInput.blur();
    }
  });

  /* ---------------------- Визуальные эффекты ---------------------- */

  function fxEngine() {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const keys = [atob('cm0gLXJmIC8='), atob('d2luZG93cw==')];
    const rand = (min, max) => min + Math.random() * (max - min);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const api = {
      busy: false,
      check(value) {
        if (api.busy) return true;
        const v = normalize(value);
        if (v === keys[0]) { start(collapse); return true; }
        if (v === keys[1]) { start(strike); return true; }
        return false;
      },
    };

    async function start(effect) {
      api.busy = true;
      searchInput.readOnly = true;
      searchInput.blur();
      runSearch('');
      document.documentElement.classList.add('fx-lock');
      try {
        await effect();
      } finally {
        searchInput.value = '';
        searchInput.readOnly = false;
        runSearch('');
        document.documentElement.classList.remove('fx-lock');
        api.busy = false;
      }
    }

    function makeLayer() {
      const layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.appendChild(layer);
      return layer;
    }

    /* ---- Эффект 1 ---- */

    async function collapse() {
      window.scrollTo({ top: 0 });
      document.body.classList.add('fx-quake');
      await wait(1500);
      document.body.classList.remove('fx-quake');

      const vh = window.innerHeight;
      const fall = (el, delay) => {
        const rect = el.getBoundingClientRect();
        const dy = vh - rect.top + rect.height + rand(150, 400);
        const dx = rand(-220, 220);
        const hinge = rand(-12, 12);
        return el.animate(
          [
            { transform: 'translate(0, 0) rotate(0deg)' },
            {
              transform: `translate(0, 6px) rotate(${hinge}deg)`,
              offset: 0.22,
              easing: 'cubic-bezier(0.55, 0, 1, 0.45)',
            },
            { transform: `translate(${dx}px, ${dy}px) rotate(${hinge * rand(4, 9)}deg)` },
          ],
          { duration: rand(1100, 1700), delay, fill: 'forwards' }
        );
      };

      const leaves = document.querySelectorAll(
        '.brand, .site-header__lead, .search, .card__header, .cmd, .site-footer p'
      );
      const anims = [];
      leaves.forEach((el) => anims.push(fall(el, rand(0, 1000))));
      cards.forEach((el) => anims.push(fall(el, rand(1100, 1600))));

      await Promise.all(anims.map((a) => a.finished));

      const layer = makeLayer();
      const msg = document.createElement('pre');
      msg.className = 'fx-panic';
      layer.appendChild(msg);
      const lines = [
        'Kernel panic - not syncing: Attempted to kill init!',
        '---[ end Kernel panic ]---',
        '',
        '$ sudo reboot',
      ];
      for (const line of lines) {
        msg.textContent += `${line}\n`;
        await wait(550);
      }
      await wait(700);
      layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' });

      anims.forEach((a) => {
        a.playbackRate = 2.5;
        a.reverse();
      });
      await Promise.all(anims.map((a) => a.finished));
      anims.forEach((a) => a.cancel());
      layer.remove();
    }

    /* ---- Эффект 2 ---- */

    function penguinSvg() {
      return `
        <svg viewBox="0 0 120 140" overflow="visible" xmlns="${SVG_NS}">
          <g class="fx-blade" style="transform-box: view-box; transform-origin: 102px 88px; transform: rotate(-45deg)">
            <polygon points="116,84 196,84 212,88 196,92 116,92" fill="#dfe6ee" stroke="#8a96a3" stroke-width="1.5"/>
            <line x1="118" y1="88" x2="200" y2="88" stroke="#ffffff" stroke-width="1" opacity="0.8"/>
            <rect x="110" y="74" width="6" height="28" rx="2" fill="#e0b43c"/>
            <rect x="94" y="84.5" width="16" height="7" rx="2" fill="#6b3f1d"/>
            <circle cx="93" cy="88" r="4.5" fill="#e0b43c"/>
          </g>
          <ellipse cx="42" cy="132" rx="17" ry="7" fill="#f5a623"/>
          <ellipse cx="78" cy="132" rx="17" ry="7" fill="#f5a623"/>
          <ellipse cx="60" cy="80" rx="42" ry="53" fill="#15171a"/>
          <ellipse cx="60" cy="92" rx="28" ry="38" fill="#f4f4f2"/>
          <ellipse cx="18" cy="88" rx="9" ry="24" fill="#15171a" transform="rotate(18 18 88)"/>
          <ellipse cx="101" cy="86" rx="9" ry="20" fill="#15171a" transform="rotate(-40 101 86)"/>
          <ellipse cx="48" cy="42" rx="8" ry="10" fill="#fff"/>
          <ellipse cx="72" cy="42" rx="8" ry="10" fill="#fff"/>
          <circle cx="50" cy="45" r="4" fill="#111"/>
          <circle cx="70" cy="45" r="4" fill="#111"/>
          <path d="M40 33 L55 38" stroke="#111" stroke-width="3" stroke-linecap="round"/>
          <path d="M80 33 L65 38" stroke="#111" stroke-width="3" stroke-linecap="round"/>
          <path d="M45 55 Q60 46 75 55 Q60 67 45 55 Z" fill="#f5a623"/>
        </svg>`;
    }

    function buildCracks(svg, cx, cy) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const maxLen = Math.hypot(W, H) * 0.65;
      const count = 11 + Math.floor(rand(0, 5));
      const rays = [];
      const paths = [];

      const addPath = (d, delay, width = 1.3) => {
        [['rgba(0,0,0,0.55)', width + 2], ['rgba(255,255,255,0.92)', width]].forEach(
          ([stroke, w]) => {
            const p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', d);
            p.setAttribute('pathLength', '1');
            p.setAttribute('fill', 'none');
            p.setAttribute('stroke', stroke);
            p.setAttribute('stroke-width', w);
            p.setAttribute('stroke-linejoin', 'round');
            p.style.strokeDasharray = '1';
            p.style.strokeDashoffset = '1';
            svg.appendChild(p);
            paths.push(
              p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
                duration: rand(220, 480),
                delay,
                easing: 'ease-out',
                fill: 'forwards',
              })
            );
          }
        );
      };

      for (let k = 0; k < count; k += 1) {
        const base = (k / count) * Math.PI * 2 + rand(-0.2, 0.2);
        const len = rand(0.35, 1) * maxLen;
        let a = base;
        let x = cx;
        let y = cy;
        let dist = 0;
        const pts = [[x, y]];
        while (dist < len) {
          const step = rand(25, 70);
          a = base + Math.max(-0.45, Math.min(0.45, a - base + rand(-0.3, 0.3)));
          x += Math.cos(a) * step;
          y += Math.sin(a) * step;
          dist += step;
          pts.push([x, y]);
          if (pts.length > 2 && Math.random() < 0.25) {
            let bx = x;
            let by = y;
            let ba = a + rand(0.5, 1) * (Math.random() < 0.5 ? -1 : 1);
            let bd = `M${bx} ${by}`;
            for (let s = 0; s < 3; s += 1) {
              ba += rand(-0.3, 0.3);
              bx += Math.cos(ba) * rand(15, 40);
              by += Math.sin(ba) * rand(15, 40);
              bd += ` L${bx} ${by}`;
            }
            addPath(bd, 200 + pts.length * 25, 0.9);
          }
        }
        rays.push(pts);
        addPath(`M${pts.map((p) => p.join(' ')).join(' L')}`, rand(0, 80), 1.5);
      }

      [1, 2, 4, 6].forEach((ring, i) => {
        for (let k = 0; k < count; k += 1) {
          const p1 = rays[k][ring];
          const p2 = rays[(k + 1) % count][ring];
          if (!p1 || !p2 || Math.random() < 0.25) continue;
          const mx = (p1[0] + p2[0]) / 2 + rand(-10, 10);
          const my = (p1[1] + p2[1]) / 2 + rand(-10, 10);
          addPath(`M${p1.join(' ')} Q${mx} ${my} ${p2.join(' ')}`, 180 + i * 90, 1);
        }
      });

      const glow = document.createElementNS(SVG_NS, 'circle');
      glow.setAttribute('cx', cx);
      glow.setAttribute('cy', cy);
      glow.setAttribute('r', '26');
      glow.setAttribute('fill', 'url(#fx-impact)');
      svg.insertBefore(glow, svg.firstChild);

      return paths;
    }

    async function strike() {
      const layer = makeLayer();
      const W = window.innerWidth;
      const H = window.innerHeight;
      const size = Math.min(170, W * 0.32);
      const cx = W / 2;
      const cy = H / 2;

      const hero = document.createElement('div');
      hero.className = 'fx-hero';
      hero.style.width = `${size}px`;
      hero.innerHTML = penguinSvg();
      layer.appendChild(hero);
      const blade = hero.querySelector('.fx-blade');

      const tx = cx - size / 2 - size * 0.35;
      const ty = cy - size * 0.6;

      await hero.animate(
        [
          { transform: `translate(${-size * 1.5}px, ${H * 0.85}px) rotate(-40deg) scale(0.6)` },
          { transform: `translate(${W * 0.25}px, ${H * 0.08}px) rotate(220deg) scale(1)`, offset: 0.55 },
          { transform: `translate(${tx}px, ${ty}px) rotate(360deg) scale(1)` },
        ],
        { duration: 1100, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'forwards' }
      ).finished;

      await blade.animate(
        [{ transform: 'rotate(-45deg)' }, { transform: 'rotate(-130deg)' }],
        { duration: 320, easing: 'ease-out', fill: 'forwards' }
      ).finished;
      await wait(150);
      await blade.animate(
        [{ transform: 'rotate(-130deg)' }, { transform: 'rotate(35deg)' }],
        { duration: 110, easing: 'cubic-bezier(0.7, 0, 1, 1)', fill: 'forwards' }
      ).finished;

      // Удар
      const ix = tx + size * 1.6;
      const iy = ty + size * 1.26;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'fx-cracks');
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = `
        <defs>
          <radialGradient id="fx-impact">
            <stop offset="0" stop-color="#fff" stop-opacity="0.9"/>
            <stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </radialGradient>
        </defs>`;
      layer.insertBefore(svg, hero);
      buildCracks(svg, ix, iy);

      const flash = document.createElement('div');
      flash.className = 'fx-flash';
      layer.insertBefore(flash, svg);
      flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 350, fill: 'forwards' });

      document.body.classList.add('fx-jolt', 'fx-glitch');
      cards.forEach((card) => {
        card.style.transform = `translate(${rand(-10, 10)}px, ${rand(-8, 8)}px) rotate(${rand(-2, 2)}deg)`;
      });
      setTimeout(() => document.body.classList.remove('fx-jolt'), 450);

      await blade.animate(
        [{ transform: 'rotate(35deg)' }, { transform: 'rotate(-45deg)' }],
        { duration: 600, delay: 700, easing: 'ease-in-out', fill: 'forwards' }
      ).finished;

      await hero.animate(
        [
          { transform: `translate(${tx}px, ${ty}px) rotate(0deg)` },
          { transform: `translate(${tx}px, ${ty - 40}px) rotate(-10deg)`, offset: 0.25 },
          { transform: `translate(${W + size}px, ${-size * 2}px) rotate(540deg)` },
        ],
        { duration: 900, easing: 'ease-in', fill: 'forwards' }
      ).finished;

      await wait(2600);
      await layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' })
        .finished;
      cards.forEach((card) => { card.style.transform = ''; });
      document.body.classList.remove('fx-glitch');
      layer.remove();
    }

    return api;
  }
})();
