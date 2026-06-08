export function initNav({ onFilter, initialFilter = 'all' } = {}){
  const desktop = document.getElementById('nav-filters');
  const mobile = document.getElementById('mobile-menu');
  const burger = document.getElementById('menu-toggle');

  function getFirstFocusable(container){
    if (!container) return [];
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).find(el => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
  }

  function openMobileMenu(){
    if (!mobile || !burger) return;
    mobile.hidden = false;
    burger.setAttribute('aria-expanded', 'true');
    getFirstFocusable(mobile)?.focus();
  }

  function closeMobileMenu({ restoreFocus = true } = {}){
    if (!mobile || !burger) return;
    mobile.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) burger.focus();
  }

  function setActive(container, filter){
    if (!container) return;

    container.querySelectorAll('[data-filter]').forEach(a => {
      const isActive = a.getAttribute('data-filter') === filter;
      a.classList.toggle('active', isActive);

      if (a.tagName === 'BUTTON') {
        a.setAttribute('aria-pressed', String(isActive));
        a.removeAttribute('aria-current');
      } else {
        if (isActive) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
        a.removeAttribute('aria-pressed');
      }
    });
  }

   function applyFilter(filter){
     setActive(desktop, filter);
     setActive(mobile, filter);
     onFilter?.(filter);
     
     // Close mobile menu after selection
     if (mobile && burger && !mobile.hidden){
       closeMobileMenu({ restoreFocus: true });
     }
   }

  function onClick(e){
    const a = e.target.closest('[data-filter]');
    if (!a) return;
    if (a.tagName === 'A') e.preventDefault();
    const filter = a.getAttribute('data-filter') || 'all';
    applyFilter(filter);
  }

  desktop?.addEventListener('click', onClick);
  mobile?.addEventListener('click', onClick);

  // Burger toggle
  if (burger && mobile){
    burger.addEventListener('click', () => {
      const expanded = burger.getAttribute('aria-expanded') === 'true';
      if (expanded) closeMobileMenu({ restoreFocus: true });
      else openMobileMenu();
    });

    // Esc closes mobile menu
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!mobile.hidden){
        closeMobileMenu({ restoreFocus: true });
      }
    });

    document.addEventListener('pointerdown', (e) => {
      if (mobile.hidden || mobile.contains(e.target) || burger.contains(e.target)) return;
      closeMobileMenu({ restoreFocus: false });
    }, true);

    document.addEventListener('focusin', (e) => {
      if (mobile.hidden || mobile.contains(e.target) || burger.contains(e.target)) return;
      closeMobileMenu({ restoreFocus: false });
    });

    ['a11y:panel-opening', 'news:dialog-opened'].forEach((eventName) => {
      document.addEventListener(eventName, () => {
        if (!mobile.hidden) closeMobileMenu({ restoreFocus: false });
      });
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 700 && !mobile.hidden){
        closeMobileMenu({ restoreFocus: false });
      }
    }, { passive: true });
  }

  // Initial UI sync without forcing a filter reset.
  setActive(desktop, initialFilter);
  setActive(mobile, initialFilter);

  return { openMobileMenu, closeMobileMenu };
}
