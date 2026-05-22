export function initBackToTop(){
  const btn = document.getElementById('back-to-top');
  if (!btn) return;

  const showAt = 600;
  let ticking = false;

  function update(){
    const y = window.scrollY || document.documentElement.scrollTop;
    const isVisible = y > showAt;
    btn.toggleAttribute('hidden', !isVisible);
    btn.setAttribute('aria-hidden', String(!isVisible));
  }

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const topTarget =
      document.querySelector('main') ||
      document.querySelector('#top') ||
      document.body;

    if (topTarget) {
      if (!topTarget.hasAttribute('tabindex')) topTarget.setAttribute('tabindex', '-1');
      topTarget.focus({ preventScroll: true });
    }
  });

  update();

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  }, { passive: true });
}