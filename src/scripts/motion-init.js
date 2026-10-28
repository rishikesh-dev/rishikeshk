import { animate, inView } from 'motion';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function init() {
  if (reduce) return;

  document.querySelectorAll('.js-reveal').forEach((el) => {
    if (el.dataset.revealed) return;
    el.dataset.revealed = '1';
    animate(el, { opacity: [0, 1], y: [12, 0] }, { duration: 0.35, easing: 'ease-out' });
  });

  document.querySelectorAll('.js-stagger').forEach((container) => {
    if (container.dataset.staggered) return;
    container.dataset.staggered = '1';
    const items = container.querySelectorAll('.js-stagger-item');
    items.forEach((item, i) => {
      animate(item, { opacity: [0, 1], y: [12, 0] }, { duration: 0.35, delay: i * 0.06, easing: 'ease-out' });
    });
  });

  inView('.js-inview', (el) => {
    if (el.dataset.inviewed) return;
    el.dataset.inviewed = '1';
    animate(el, { opacity: [0, 1], y: [12, 0] }, { duration: 0.35, easing: 'ease-out' });
  }, { amount: 0.2 });
}

if (document.documentElement.classList.contains('js')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  document.addEventListener('astro:page-load', init);
}
