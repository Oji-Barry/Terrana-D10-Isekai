/* ============================================================
   TERRANA D10 ISEKAI — nav.js
   Shared nav logic: theme toggle, hamburger menu,
   sidebar scroll-spy. Included on every page.
   ============================================================ */

(function () {

  /* ── Theme toggle ── */
  const root  = document.documentElement;
  const btn   = document.getElementById('theme-btn');
  const icon  = btn && btn.querySelector('.theme-icon');
  const label = btn && btn.querySelector('.theme-label');
  const saved = localStorage.getItem('td10-theme') || 'night';

  root.setAttribute('data-theme', saved);
  updateThemeBtn(saved);

  if (btn) {
    btn.addEventListener('click', () => {
      const next = root.getAttribute('data-theme') === 'night' ? 'day' : 'night';
      root.setAttribute('data-theme', next);
      localStorage.setItem('td10-theme', next);
      updateThemeBtn(next);
    });
  }

  function updateThemeBtn(t) {
    if (!icon || !label) return;
    icon.textContent  = t === 'night' ? '🌙' : '☀️';
    label.textContent = t === 'night' ? 'Night' : 'Day';
  }

  /* ── Hamburger menu ── */
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
      // Prevent body scroll when menu is open
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close menu when a link is tapped
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close menu on outside tap
    document.addEventListener('click', (e) => {
      if (
        mobileMenu.classList.contains('open') &&
        !mobileMenu.contains(e.target) &&
        !hamburger.contains(e.target)
      ) {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  /* ── Sidebar scroll-spy ── */
  const sections  = document.querySelectorAll('section[id]');
  const sideLinks = document.querySelectorAll('.sidebar-nav a');

  if (sections.length && sideLinks.length) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          sideLinks.forEach(l => l.classList.remove('active'));
          const active = document.querySelector(`.sidebar-nav a[href="#${e.target.id}"]`);
          if (active) active.classList.add('active');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px' });

    sections.forEach(s => observer.observe(s));
  }

})();
