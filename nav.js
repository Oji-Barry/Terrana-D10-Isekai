/* ============================================================
   TERRANA D10 ISEKAI — nav.js
   Shared nav logic: theme toggle, hamburger menu,
   mobile sidebar drawer, sidebar scroll-spy.
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

  /* ── Hamburger (top nav mobile menu) ── */
  const hamburger  = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

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

  /* ── Mobile sidebar drawer ── */
  const sidebar  = document.querySelector('.sidebar');
  const fab      = document.getElementById('drawer-fab');

  if (sidebar && fab) {
    // Mark body so CSS shows the compass button
    document.body.classList.add('has-sidebar');

    // Build drawer from sidebar content
    const sidebarClone = sidebar.cloneNode(true);

    const overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'drawer-overlay';

    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.id = 'drawer';
    drawer.setAttribute('aria-label', 'On this page');

    const drawerHeader = document.createElement('div');
    drawerHeader.className = 'drawer-header';

    const drawerTitle = document.createElement('span');
    drawerTitle.className = 'drawer-title';
    drawerTitle.textContent = 'On This Page';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'drawer-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&#10005;';

    drawerHeader.appendChild(drawerTitle);
    drawerHeader.appendChild(closeBtn);
    drawer.appendChild(drawerHeader);
    drawer.appendChild(sidebarClone);

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    function openDrawer() {
      drawer.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    fab.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);

    // Close drawer and navigate when a link is tapped
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => closeDrawer());
    });
  }

  /* ── Sidebar scroll-spy (updates desktop sidebar and drawer clone) ── */
  const sections = document.querySelectorAll('section[id]');

  if (sections.length) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          document.querySelectorAll('.sidebar-nav a').forEach(l => l.classList.remove('active'));
          document.querySelectorAll(`.sidebar-nav a[href="#${e.target.id}"]`).forEach(l => l.classList.add('active'));
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(s => observer.observe(s));
  }

})();
