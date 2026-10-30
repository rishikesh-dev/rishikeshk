document.addEventListener('astro:before-swap', () => {
  // No crumple effect - column wipe handled by CSS view-transitions
});

document.addEventListener('astro:after-swap', () => {
  if (typeof window.initNav === 'function') window.initNav();
});

document.addEventListener('astro:page-load', () => {
  if (typeof window.initNav === 'function') window.initNav();
  // Focus heading after navigation
  setTimeout(() => {
    const h1 = document.querySelector('main h1, .cs h1, h1');
    if (h1 && typeof h1.focus === 'function') {
      h1.setAttribute('tabindex', '-1');
      h1.focus({ preventScroll: true });
    }
    // restore scroll on back
    if (history.state && history.state.scroll) {
      window.scrollTo(history.state.scroll.x, history.state.scroll.y);
    }
  }, 50);
});