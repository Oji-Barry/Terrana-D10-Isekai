/* ============================================================
   TERRANA D10 ISEKAI — nav.js
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

  /* ── Hamburger ── */
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

  /* ══════════════════════════════════════════════════════════
     BUILD ACCORDION NAV
     Takes the flat sidebar-nav ul (where child items have
     class="sub") and restructures it into a collapsible tree.
     Works on any nav list passed in, so it handles both the
     desktop sidebar and the compass drawer clone.
  ══════════════════════════════════════════════════════════ */
  function buildAccordion(navUl) {
    if (!navUl) return;

    const items = Array.from(navUl.querySelectorAll('li'));

    // Group items: find parents (non-sub) and collect their sub children
    const groups = [];
    let current = null;

    items.forEach(li => {
      const a = li.querySelector('a');
      if (!a) return;
      if (a.classList.contains('sub')) {
        if (current) current.children.push(li);
      } else {
        current = { parent: li, children: [] };
        groups.push(current);
      }
    });

    // Clear the ul and rebuild
    navUl.innerHTML = '';

    groups.forEach(group => {
      const parentLi  = group.parent;
      const parentA   = parentLi.querySelector('a');
      const hasKids   = group.children.length > 0;

      if (hasKids) {
        // Wrap parent into a row: link on left, chevron button on right
        const row = document.createElement('div');
        row.className = 'nav-row';

        // Move the anchor into the row
        row.appendChild(parentA);

        // Chevron button
        const chevron = document.createElement('button');
        chevron.className = 'nav-chevron';
        chevron.setAttribute('aria-label', 'Expand section');
        chevron.setAttribute('aria-expanded', 'false');
        chevron.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,2 8,5 2,8"/></svg>';
        row.appendChild(chevron);

        parentLi.innerHTML = '';
        parentLi.className = 'nav-parent';
        parentLi.appendChild(row);

        // Children container — hidden by default
        const childUl = document.createElement('ul');
        childUl.className = 'nav-children';
        group.children.forEach(childLi => {
          const childA = childLi.querySelector('a');
          if (childA) {
            childA.classList.remove('sub');
            const newLi = document.createElement('li');
            newLi.appendChild(childA);
            childUl.appendChild(newLi);
          }
        });
        parentLi.appendChild(childUl);

        // Chevron click: toggle accordion only
        chevron.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = parentLi.classList.toggle('open');
          chevron.setAttribute('aria-expanded', isOpen);
        });

      } else {
        // No children — plain parent, no changes needed
        parentLi.className = 'nav-parent';
        navUl.appendChild(parentLi);
      }

      navUl.appendChild(parentLi);
    });
  }

  /* ── Build accordion on desktop sidebar ── */
  const sidebarNav = document.querySelector('.sidebar .sidebar-nav');
  buildAccordion(sidebarNav);

  /* ── Compass drawer ── */
  const fab = document.getElementById('drawer-fab');
  const sidebarNavForDrawer = document.querySelector('.sidebar .sidebar-nav');

  if (fab && sidebarNavForDrawer) {
    document.body.classList.add('has-sidebar');

    const overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'drawer-overlay';

    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.id = 'drawer';

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

    // Build a fresh nav list for the drawer from the original sidebar HTML
    // Re-read the original sidebar-nav from the page source (before accordion
    // restructuring) by cloning from the now-restructured sidebar and
    // rebuilding a clean flat list from the section IDs we can find on the page
    const drawerNavWrap = document.createElement('div');
    drawerNavWrap.innerHTML = '<ul class="sidebar-nav">' + sidebarNavForDrawer.innerHTML + '</ul>';
    const drawerNav = drawerNavWrap.querySelector('.sidebar-nav');

    // The sidebar has already been accordion-ified, so clone its structure
    // directly — the drawer gets the same accordion built on its copy
    drawerNavWrap.innerHTML = '';
    const freshUl = sidebarNavForDrawer.cloneNode(true);
    drawerNavWrap.appendChild(freshUl);

    drawer.appendChild(drawerHeader);
    drawer.appendChild(drawerNavWrap);

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
    document.addEventListener('click', (e) => {
      if (
        drawer.classList.contains('open') &&
        !drawer.contains(e.target) &&
        !fab.contains(e.target)
      ) {
        closeDrawer();
      }
    });
    drawer.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => closeDrawer());
    });
  }

  /* ── Scroll-spy: highlight active link, auto-expand parent ── */
  const sections = document.querySelectorAll('section[id]');

  if (sections.length) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = e.target.id;

        // Remove all active states
        document.querySelectorAll('.sidebar-nav a, .drawer a').forEach(l => l.classList.remove('active'));

        // Highlight matching links in both sidebar and drawer
        document.querySelectorAll(`a[href="#${id}"]`).forEach(activeLink => {
          activeLink.classList.add('active');

          // If this link is inside a nav-children, auto-expand the parent
          const childList = activeLink.closest('.nav-children');
          if (childList) {
            const parentLi = childList.closest('.nav-parent');
            if (parentLi) {
              parentLi.classList.add('open');
              const chev = parentLi.querySelector('.nav-chevron');
              if (chev) chev.setAttribute('aria-expanded', 'true');
            }
          }
        });
      });
    }, { rootMargin: '-20% 0px -70% 0px' });

    sections.forEach(s => observer.observe(s));
  }

})();
