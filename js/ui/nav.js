export function initNav({ onFilter, initialFilter = 'all' } = {}){
  const desktop = document.getElementById('nav-filters');
  const mobile = document.getElementById('mobile-menu');
  const burger = document.getElementById('menu-toggle');
  let releaseTrap = null;

  function getFocusable(container){
    if (!container) return [];
    return Array.from(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
  }

  function trapFocus(container){
    function onKeydown(e){
      if (e.key !== 'Tab') return;
      const items = getFocusable(container);
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first){
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last){
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', onKeydown);
    return () => container.removeEventListener('keydown', onKeydown);
  }

  function openMobileMenu(){
    if (!mobile || !burger) return;
    mobile.hidden = false;
    burger.setAttribute('aria-expanded', 'true');
    releaseTrap?.();
    releaseTrap = trapFocus(mobile);
    getFocusable(mobile)[0]?.focus();
  }

  function closeMobileMenu({ restoreFocus = true } = {}){
    if (!mobile || !burger) return;
    mobile.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    releaseTrap?.();
    releaseTrap = null;
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
