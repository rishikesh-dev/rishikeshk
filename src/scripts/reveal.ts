// Failsafe: if hero/reveal elements still hidden after 1500ms, force final state
if (document.documentElement.classList.contains('js')) {
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
