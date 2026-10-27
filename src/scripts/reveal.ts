// Reveal-on-scroll in newspaper "print" style
// Base CSS never hides anything.
// Hidden start state only under: html.js [data-reveal]:not([data-in])

(function () {
  const html = document.documentElement;

  // No JS: base CSS is visible, nothing to do
  if (!html.classList.contains('js')) return;

  // Reduced motion or print: everything visible, no animation
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || window.matchMedia('print').matches) {
    html.classList.add('no-motion-wait');
    return;
  }

  let observer: IntersectionObserver | null = null;
  let scrollTimer: number | null = null;

  const EFFECTS: Record<string, string[]> = {
    rule: ['.label', 'section.s', 'footer'],
    ink: ['section h2', '.about q', '.contact h2'],
    feed: ['.shot', '.sketch', '.code'],
    rise: ['.work > div', '.about dl', '.skp', '.form'],
    stamp: ['.tag', '.pill', '.ph .st'],
  };

  function assignDataReveal() {
    for (const [effect, selectors] of Object.entries(EFFECTS)) {
      const byParent = new Map<Element, Element[]>();
      selectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          if (el.dataset.reveal || el.dataset.in) return; // already assigned
          const parent = el.parentElement!;
          if (!byParent.has(parent)) byParent.set(parent, []);
          byParent.get(parent)!.push(el);
        });
      });
      byParent.forEach((els) => {
        els.forEach((el, i) => {
          const capped = Math.min(i, 5);
          el.setAttribute('data-reveal', effect);
          el.style.setProperty('--i', String(capped));
        });
      });
    }
  }

  function checkAboveViewport() {
    document.querySelectorAll('[data-reveal]:not([data-in])').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0) {
        el.setAttribute('data-in', '1');
      }
    });
  }

  function checkInViewport() {
    const viewportBottom = window.innerHeight;
    document.querySelectorAll('[data-reveal]:not([data-in])').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewportBottom) {
        el.setAttribute('data-in', '1');
      }
    });
  }

  function initObserver() {
    if (observer) {
      observer.disconnect();
    }

    if (!('IntersectionObserver' in window)) {
      // No IntersectionObserver support: mark everything data-in at once
      document.querySelectorAll('[data-reveal]').forEach((el) => {
        el.setAttribute('data-in', '1');
      });
      window.__revealObservers = 0;
      return;
    }

    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as Element;
        if (el.dataset.in) continue;
        if (entry.isIntersecting) {
          el.setAttribute('data-in', '1');
        } else {
          const rect = entry.boundingClientRect;
          if (rect.bottom < 0) {
            el.setAttribute('data-in', '1');
          }
        }
      }
      checkAboveViewport();
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });

    assignDataReveal();
    document.querySelectorAll('[data-reveal]').forEach((el) => {
      observer!.observe(el);
    });

    window.__revealObservers = 1;
  }

  function handleScroll() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      checkAboveViewport();
      scrollTimer = null;
    }, 150);
  }

  function onLoad() {
    assignDataReveal();
    initObserver();
    checkAboveViewport();

    // Failsafe 1500ms after load: any element still hidden whose top is above bottom of viewport
    setTimeout(() => {
      checkInViewport();
    }, 1500);
  }

  function onHashChange() {
    setTimeout(() => {
      checkInViewport();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onLoad, { once: true });
  } else {
    onLoad();
  }

  document.addEventListener('astro:page-load', () => {
    // Re-attach: disconnect old observer first, never attach twice
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    onLoad();
  });

  window.addEventListener('scrollend', () => {
    checkAboveViewport();
  });
  window.addEventListener('scroll', handleScroll);
  window.addEventListener('hashchange', onHashChange);
})();
