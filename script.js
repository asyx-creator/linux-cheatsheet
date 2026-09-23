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

  searchInput.addEventListener('input', debounce((e) => runSearch(e.target.value), 120));

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

    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.value = '';
      runSearch('');
      searchInput.blur();
    }
  });
})();
