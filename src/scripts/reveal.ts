let observer: IntersectionObserver | null = null;

function init() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.dataset.in = '1';
        }
      }
    },
    { threshold: 0.1 }
  );

  document.querySelectorAll('.ink-wipe > span > i, .rule-draw, .rubber-stamp, .paper-feed').forEach((el) => {
    if (!el.dataset.in) {
      observer.observe(el);
    }
  });
}

if (document.documentElement.classList.contains('js')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  document.addEventListener('astro:page-load', init);

  // Failsafe: if hero/reveal elements still hidden after 1500ms, force final state
  setTimeout(() => {
    const html = document.documentElement;
    const hidden = document.querySelectorAll('h1 span i, [data-reveal]');
    let stillHidden = false;
    for (const el of hidden) {
      const cs = window.getComputedStyle(el);
      if (cs.clipPath !== 'inset(0px)' && cs.clipPath !== 'inset(0)') {
        stillHidden = true;
        break;
      }
    }
    if (stillHidden) {
      html.classList.add('no-motion-wait');
    }
  }, 1500);
}