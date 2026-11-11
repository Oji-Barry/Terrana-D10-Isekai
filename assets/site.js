/* Jimothy's D10 Isekai JRPG - shared site shell.
   Every page has <div id="site-top"></div>, a <main class="content">, and
   <div id="site-bottom"></div>. This script fills in the address bar, top
   section, side menu, and credits so they only live in one place. */

(function () {
  // Full addresses, so the menu's links still work after a book page swaps in without reloading
  var root = new URL(document.documentElement.getAttribute('data-root') || './', location.href).href;
  var page = document.body.getAttribute('data-page') || '';
  var address = document.body.getAttribute('data-address') || 'www.terrana.ccn';

  var nav = [
    ['rulebook', 'Rulebook', 'rulebook/index.html'],
    ['forge', 'Character Forge', 'forge/index.html'],
    ['combat', 'Combat', 'combat/index.html'],
    ['downloads', 'Downloads', 'downloads/index.html'],
    ['ourspace', 'OurSpace', 'ourspace/index.html']
  ];

  var chapters = [
    ['front', '', 'Front Matter'],
    ['ch1', '1', 'The Six-Faced World'],
    ['ch2', '2', 'Locations and Settings'],
    ['ch3', '3', 'Monsera and the United Domains'],
    ['ch4', '4', 'The Grand Dungeon'],
    ['ch5', '5', 'Legends of Terrana'],
    ['ch6', '6', 'Character Creation Overview'],
    ['ch7', '7', 'Tropes, Virtues, and Vices'],
    ['ch8', '8', 'Heritages'],
    ['ch9', '9', 'Merits and Flaws'],
    ['ch10', '10', 'Backgrounds'],
    ['ch11', '11', 'Willpower, Fate, Sanity, and Mana'],
    ['ch12', '12', 'Martial Combat Styles'],
    ['ch13', '13', 'Magic'],
    ['ch14', '14', 'Equipment and Items'],
    ['ch15', '15', 'Bestiary'],
    ['ch16', '16', 'Alternate Eras'],
    ['terms', '', 'Key Terms']
  ];

  var chevLeft = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var chevRight = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var isChapter = chapters.some(function (c) { return c[0] === page; });
  var navHtml = nav.map(function (n) {
    var cur = (page === n[0] || (n[0] === 'rulebook' && isChapter)) ? ' aria-current="page"' : '';
    return '<a href="' + root + n[2] + '"' + cur + '>' + n[1] + '</a>';
  }).join('') + '<a class="login" href="' + root + 'account/index.html">Log In</a>';

  var homeHtml = '<a class="menu-item home-item" href="' + root + 'index.html"' +
    (page === 'home' ? ' aria-current="page"' : '') + '><span class="num"></span><span>Home</span></a>';
  var menuHtml = chapters.map(function (c) {
    var cur = page === c[0] ? ' aria-current="page"' : '';
    return '<a class="menu-item" data-slug="' + c[0] + '" href="' + root + 'rulebook/' + c[0] + '.html"' + cur + '>' +
      '<span class="num">' + esc(c[1]) + '</span><span>' + esc(c[2]) + '</span></a>';
  }).join('');

  var top = document.getElementById('site-top');
  if (top) {
    top.outerHTML =
      '<div class="addressbar" aria-hidden="true">CCN://' + esc(address) + '</div>' +
      '<header class="site-header win">' +
        '<a class="brand" href="' + root + 'index.html">' +
          '<img src="' + root + 'assets/icons/d10.svg" alt="">' +
          '<span><span class="brand-title">Jimothy’s D10 Isekai JRPG</span>' +
          '<span class="brand-sub">WORLD OF TERRANA</span></span>' +
        '</a>' +
        '<nav class="site-nav" aria-label="Main">' + navHtml + '</nav>' +
      '</header>';
  }

  var layout = document.querySelector('.layout');
  if (layout) {
    var side = document.createElement('aside');
    side.className = 'sidebar win';
    side.id = 'chapter-menu';
    side.setAttribute('aria-label', 'Chapters');
    side.innerHTML =
      '<div class="sidebar-head">' +
        '<label class="visually-hidden" for="site-search">Search the rulebook</label>' +
        '<input id="site-search" type="search" placeholder="Search rules...">' +
        '<button class="icon-btn" type="button" id="menu-hide" aria-label="Hide chapter menu" aria-controls="chapter-menu">' + chevLeft + '</button>' +
      '</div>' +
      '<div class="search-results" id="search-results" aria-live="polite"></div>' +
      '<div class="menu-label px">CHAPTERS</div>' +
      '<nav class="chapters-nav" aria-label="Chapters">' + homeHtml + menuHtml + '</nav>';

    var rail = document.createElement('div');
    rail.className = 'rail win';
    rail.innerHTML =
      '<button class="icon-btn" type="button" id="menu-show" aria-label="Show chapter menu" aria-controls="chapter-menu">' + chevRight + '</button>' +
      '<span class="px" aria-hidden="true">CHAPTERS</span>';

    layout.insertBefore(rail, layout.firstChild);
    layout.insertBefore(side, rail);

    // Rulebook search: looks through rulebook/search.json
    var input = document.getElementById('site-search');
    var results = document.getElementById('search-results');
    var index = null;
    var loading = null;
    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (!loading) {
        loading = fetch(root + 'rulebook/search.json').then(function (r) { return r.json(); })
          .then(function (d) {
            index = d.map(function (e) { e.lt = e.t.toLowerCase(); e.ls = e.s.toLowerCase(); return e; });
            return index;
          });
      }
      return loading;
    }
    function snippet(text, lower, words) {
      var at = -1;
      words.forEach(function (w) { var i = lower.indexOf(w); if (i >= 0 && (at < 0 || i < at)) at = i; });
      if (at < 0) return '';
      var start = Math.max(0, at - 50);
      var s = (start > 0 ? '...' : '') + text.slice(start, at + 110) + '...';
      var out = esc(s);
      words.forEach(function (w) {
        out = out.replace(new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig'), '<mark>$1</mark>');
      });
      return out;
    }
    function runSearch() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        results.innerHTML = '';
        side.classList.remove('searching');
        return;
      }
      side.classList.add('searching');
      loadIndex().then(function (idx) {
        if (input.value.trim().toLowerCase() !== q) return;
        var words = q.split(/\s+/).filter(Boolean);
        var hits = [];
        idx.forEach(function (e) {
          var score = 0;
          for (var i = 0; i < words.length; i++) {
            var inTitle = e.ls.indexOf(words[i]) >= 0;
            var inText = e.lt.indexOf(words[i]) >= 0;
            if (!inTitle && !inText) return;
            score += inTitle ? 10 : 1;
          }
          if (e.lt.indexOf(q) >= 0) score += 5;
          hits.push([score, e]);
        });
        hits.sort(function (a, b) { return b[0] - a[0]; });
        if (!hits.length) {
          results.innerHTML = '<div class="hint">Nothing found for "' + esc(input.value.trim()) + '".</div>';
          return;
        }
        results.innerHTML = '<div class="hint">' + hits.length + (hits.length === 1 ? ' match' : ' matches') +
          (hits.length > 25 ? ', showing the top 25' : '') + '</div>' +
          hits.slice(0, 25).map(function (h) {
            var e = h[1];
            return '<a href="' + root + 'rulebook/' + e.p + '.html#' + e.id + '">' +
              '<span class="r-title">' + esc(e.s) + '</span>' +
              '<span class="r-where">' + esc(e.c) + '</span>' +
              '<span class="r-snip">' + snippet(e.t, e.lt, words) + '</span></a>';
          }).join('');
      }).catch(function () {
        results.innerHTML = '<div class="hint">Search could not load. Try refreshing the page.</div>';
      });
    }
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 150);
    });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { input.value = ''; runSearch(); }
    });

    // ---- Showing and hiding the menu ----
    var KEY = 'terrana-menu-hidden';
    function isPhone() { return window.matchMedia('(max-width: 760px)').matches; }

    var backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.appendChild(backdrop);

    function setHidden(hidden, save) {
      document.body.classList.toggle('menu-hidden', hidden);
      document.body.classList.toggle('menu-open-phone', !hidden && isPhone());
      if (save && !isPhone()) {
        try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (e) { /* storage blocked: fine */ }
      }
    }

    if (isPhone()) {
      setHidden(true, false); // phones always start with the menu tucked away
    } else {
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
      setHidden(saved === '1', false);
    }
    // Let the slide animation run only after the first paint
    requestAnimationFrame(function () { document.body.classList.add('menu-ready'); });

    document.getElementById('menu-hide').addEventListener('click', function () {
      setHidden(true, true);
      document.getElementById('menu-show').focus();
    });
    document.getElementById('menu-show').addEventListener('click', function () {
      setHidden(false, true);
      document.getElementById('menu-hide').focus();
    });
    backdrop.addEventListener('click', function () { setHidden(true, false); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && isPhone() && !document.body.classList.contains('menu-hidden')) {
        setHidden(true, false);
        document.getElementById('menu-show').focus();
      }
    });

    // ---- Chapter drop-downs ----
    // First tap on a chapter opens its contents; a second tap goes to it.
    var toc = null;
    function loadToc() {
      if (toc) return Promise.resolve(toc);
      return fetch(root + 'rulebook/toc.json').then(function (r) { return r.json(); })
        .then(function (d) { toc = d; return d; });
    }

    // Build a chapter's drop-down from rulebook/toc.json. Entries that hold
    // more entries (ranks, heritages, spells...) open on the first tap and
    // go to their spot on the second.
    function nodeLink(n, slug) {
      if (!n.id) return null;
      return slug === page ? '#' + n.id : root + 'rulebook/' + slug + '.html#' + n.id;
    }

    function renderNodes(list, slug, depth) {
      var box = document.createDocumentFragment();
      list.forEach(function (n) {
        var kids = n.c && n.c.length ? n.c : null;
        var a = document.createElement('a');
        a.className = 'menu-node depth-' + depth + (kids ? ' has-kids' : '');
        a.textContent = n.s;
        var href = nodeLink(n, slug);
        if (href) a.href = href;
        else { a.setAttribute('role', 'button'); a.tabIndex = 0; }
        if (n.id) a.setAttribute('data-id', n.id);
        box.appendChild(a);
        if (kids) {
          a.setAttribute('aria-expanded', 'false');
          var holder = document.createElement('div');
          holder.className = 'menu-kids';
          holder.hidden = true;
          holder.appendChild(renderNodes(kids, slug, depth + 1));
          box.appendChild(holder);
        }
      });
      return box;
    }

    var spyLinks = [];
    function startSpy(sub) {
      var secs = document.querySelectorAll('.content section[id]:not(#top)');
      if (!secs.length || !('IntersectionObserver' in window)) return;
      spyLinks = [];
      Array.prototype.forEach.call(secs, function (sec) {
        var a = sub.querySelector('.menu-node.depth-0[data-id="' + sec.id + '"]');
        if (a) spyLinks.push([sec, a]);
      });
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          spyLinks.forEach(function (l) { l[1].classList.toggle('here', l[0] === e.target); });
        });
      }, { rootMargin: '-20% 0px -70% 0px' });
      spyLinks.forEach(function (l) { obs.observe(l[0]); });
    }

    function buildSub(item) {
      var slug = item.getAttribute('data-slug');
      var sub = document.createElement('div');
      sub.className = 'menu-sub';
      sub.id = 'sub-' + slug;
      item.setAttribute('aria-controls', sub.id);
      item.parentNode.insertBefore(sub, item.nextSibling);
      sub.innerHTML = '<span class="menu-sub-note">Loading...</span>';
      loadToc().then(function (d) {
        sub.textContent = '';
        sub.appendChild(renderNodes(d[slug] || [], slug, 0));
        if (slug === page) startSpy(sub);
      }).catch(function () {
        sub.innerHTML = '<span class="menu-sub-note">Could not load this list. Tap the chapter again to open it.</span>';
      });
      return sub;
    }

    // Taps inside a drop-down
    side.addEventListener('click', function (ev) {
      var a = ev.target.closest('.menu-sub .menu-node');
      if (!a) return;
      if (a.classList.contains('has-kids') && a.getAttribute('aria-expanded') !== 'true') {
        ev.preventDefault();
        // close any open neighbours at the same level, then open this one
        var parentBox = a.parentNode;
        Array.prototype.forEach.call(parentBox.children, function (el) {
          if (el.classList && el.classList.contains('has-kids') && el !== a) {
            el.setAttribute('aria-expanded', 'false');
            if (el.nextElementSibling) el.nextElementSibling.hidden = true;
          }
        });
        a.setAttribute('aria-expanded', 'true');
        a.nextElementSibling.hidden = false;
        return;
      }
      if (!a.getAttribute('href')) {
        // a group with no page spot of its own (like a Bestiary rank): just fold it
        ev.preventDefault();
        if (a.classList.contains('has-kids')) {
          a.setAttribute('aria-expanded', 'false');
          a.nextElementSibling.hidden = true;
        }
        return;
      }
      if (isPhone()) setHidden(true, false);
    });
    side.addEventListener('keydown', function (ev) {
      var a = ev.target.closest && ev.target.closest('.menu-sub .menu-node[role="button"]');
      if (a && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); a.click(); }
    });

    var items = side.querySelectorAll('.chapters-nav .menu-item[data-slug]');
    function openItem(item) {
      Array.prototype.forEach.call(items, function (it) {
        var open = it === item;
        it.classList.toggle('picked', open);
        it.setAttribute('aria-expanded', open ? 'true' : 'false');
        var sub = document.getElementById('sub-' + it.getAttribute('data-slug'));
        if (sub) sub.hidden = !open;
      });
      if (!document.getElementById('sub-' + item.getAttribute('data-slug'))) buildSub(item);
    }

    Array.prototype.forEach.call(items, function (it) {
      it.setAttribute('aria-expanded', 'false');
      it.addEventListener('click', function (ev) {
        if (!it.classList.contains('picked')) {
          ev.preventDefault();
          openItem(it);
          return;
        }
        // Second tap: go to that chapter (the top of it, if it is this page)
        if (it.getAttribute('data-slug') === page) {
          ev.preventDefault();
          location.hash = 'top';
          if (isPhone()) setHidden(true, false);
        }
      });
    });


    var curItem = side.querySelector('.chapters-nav .menu-item[data-slug][aria-current="page"]');
    if (curItem) openItem(curItem);

    // ---- Music, at the top of the menu. It keeps playing while you move between book pages. ----
    var music = document.createElement('details');
    music.className = 'menu-music';
    var MKEY = 'terrana-music-open';
    var mOpen = true; try { mOpen = localStorage.getItem(MKEY) !== '0'; } catch (e) {}
    music.open = mOpen;
    music.innerHTML = '<summary class="menu-label px"><span>MUSIC</span><button type="button" class="menu-music-quick" aria-label="Play music" hidden>▶</button></summary><div class="menu-music-box"></div>';
    music.addEventListener('toggle', function () { try { localStorage.setItem(MKEY, music.open ? '1' : '0'); } catch (e) {} });
    side.insertBefore(music, side.querySelector('.search-results'));
    loadScript(root + 'assets/music.js?v=cc59780c').then(function () {
      var TM = window.TerranaMusic;
      TM.mountPlayer(music.querySelector('.menu-music-box'), {});
      TM.keepAlive();
      // A pause button that stays on the MUSIC heading even with the player folded away
      var quick = music.querySelector('.menu-music-quick');
      quick.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); TM.unlock(); TM.toggle(); });
      function q() { var st = TM.state(); quick.hidden = !st.id && !st.url; quick.textContent = st.playing ? '❚❚' : '▶'; quick.setAttribute('aria-label', st.playing ? 'Pause music' : 'Play music'); }
      TM.on(function (w) { if (w !== 'time') q(); }); q();
    }).catch(function () { music.remove(); });

    // ---- Moving between book pages without a reload, so the music never stops ----
    var rootPath = new URL(root).pathname;
    function isBook(u) {
      if (u.origin !== location.origin || u.pathname.indexOf(rootPath) !== 0) return false;
      var rel = u.pathname.slice(rootPath.length);
      return rel === '' || rel === 'index.html' || /^rulebook\/([a-z0-9]+\.html)?$/.test(rel);
    }
    function landOn(hash) {
      var t = hash && document.getElementById(decodeURIComponent(hash.slice(1)));
      if (t) t.scrollIntoView(); else window.scrollTo(0, 0);
    }
    function go(url, push) {
      return fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fresh = doc.querySelector('main.content'), cur = document.querySelector('main.content');
        if (!fresh || !cur || !doc.querySelector('.layout')) throw new Error();
        if (push) history.pushState({ book: 1 }, '', url);
        shown = new URL(url, location.href).pathname;
        document.title = doc.title;
        page = doc.body.getAttribute('data-page') || '';
        document.body.setAttribute('data-page', page);
        var addr = doc.body.getAttribute('data-address') || 'www.terrana.ccn';
        document.body.setAttribute('data-address', addr);
        var ab = document.querySelector('.addressbar'); if (ab) ab.textContent = 'CCN://' + addr;
        cur.replaceWith(document.importNode(fresh, true));
        var chap = chapters.some(function (c) { return c[0] === page; });
        Array.prototype.forEach.call(document.querySelectorAll('.site-nav a:not(.login)'), function (a, i) {
          var n = nav[i]; if (!n) return;
          if (page === n[0] || (n[0] === 'rulebook' && chap)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        var home = side.querySelector('.home-item'); if (home) { if (page === 'home') home.setAttribute('aria-current', 'page'); else home.removeAttribute('aria-current'); }
        Array.prototype.forEach.call(side.querySelectorAll('.menu-sub'), function (x) { x.remove(); });
        var now = null;
        Array.prototype.forEach.call(items, function (it) {
          it.classList.remove('picked'); it.setAttribute('aria-expanded', 'false');
          if (it.getAttribute('data-slug') === page) { it.setAttribute('aria-current', 'page'); now = it; } else it.removeAttribute('aria-current');
        });
        if (now) openItem(now);
        if (isPhone()) setHidden(true, false);
        landOn(new URL(url, location.href).hash);
        var h1 = document.querySelector('main.content h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
      }).catch(function () { location.href = url; });
    }
    document.addEventListener('click', function (ev) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target.closest && ev.target.closest('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var u = new URL(a.getAttribute('href'), location.href);
      if (!isBook(u)) return;
      if (u.pathname === location.pathname) return;   // a spot on this same page
      ev.preventDefault();
      go(u.href, true);
    });
    history.replaceState({ book: 1 }, '', location.href);
    var shown = location.pathname;
    window.addEventListener('popstate', function () {
      if (location.pathname !== shown && isBook(new URL(location.href))) go(location.href, false);
    });
  }

  var bottom = document.getElementById('site-bottom');
  if (bottom) {
    bottom.outerHTML =
      '<footer class="site-footer win arcade-credits">' +
        '<div class="ac-title px">CREDITS <span class="ac-count">0/1</span></div>' +
        '<div class="ac-coin px">INSERT COIN</div>' +
        '<div class="ac-row"><span class="ac-role">ICONS</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name">LORC AND SKOLL, <a href="https://game-icons.net">GAME-ICONS.NET</a> (<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>)</span></div>' +
        '<div class="ac-row"><span class="ac-role">SPRITES</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name"><a href="https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v181">DAWNLIKE</a> BY DRAGONDEPLATINO <span class="ac-platino" role="img" aria-label="Platino, the artist\'s sprite" title="Platino"><span style="background-image:url(' + root + 'assets/sprites/dawnlike/Reptile0.png)"></span><span style="background-image:url(' + root + 'assets/sprites/dawnlike/Reptile1.png)"></span></span>, PALETTE BY DAWNBRINGER (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>)</span></div>' +
        '<div class="ac-row"><span class="ac-role">MUSIC</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name"><a href="https://juhanijunkala.com/">JUHANI JUNKALA</a>, JRPG MUSIC PACKS AND RETRO GAME MUSIC PACK (<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>)</span></div>' +
        '<div class="ac-row"><span class="ac-role">PIXEL FONT</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name"><a href="https://github.com/fontworks-fonts/DotGothic16">DOTGOTHIC16</a> BY FONTWORKS</span></div>' +
        '<div class="ac-row"><span class="ac-role">TEXT FONT</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name"><a href="https://fonts.google.com/specimen/Nunito+Sans">NUNITO SANS</a> VIA <a href="https://fontsource.org">FONTSOURCE</a></span></div>' +
        '<div class="ac-row"><span class="ac-role">FONT LICENSE</span><span class="ac-dots" aria-hidden="true"></span><span class="ac-name"><a href="https://openfontlicense.org">SIL OPEN FONT LICENSE</a></span></div>' +
      '</footer>';
  }

  // Pages that don't load the account scripts themselves still show who is
  // logged in: load them after the page, and auth.js swaps "Log In" for the
  // player's name.
  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = bad;
      document.body.appendChild(s);
    });
  }
  function hasScript(part) {
    return Array.prototype.some.call(document.scripts, function (s) { return (s.getAttribute('src') || '').indexOf(part) >= 0; });
  }
  if (document.querySelector('.site-nav a.login') && !hasScript('assets/auth.js')) {
    window.addEventListener('load', function () {
      (hasScript('vendor/supabase-') ? Promise.resolve() : loadScript(root + 'vendor/supabase-2.118.0.js'))
        .then(function () { return loadScript(root + 'assets/auth.js?v=69bd903b'); })
        .catch(function () {});
    });
  }
})();
