/* Jimothy's D10 Isekai JRPG - shared site shell.
   Every page has <div id="site-top"></div>, a <main class="content">, and
   <div id="site-bottom"></div>. This script fills in the address bar, top
   section, side menu, and credits so they only live in one place. */

(function () {
  var root = document.documentElement.getAttribute('data-root') || '';
  var page = document.body.getAttribute('data-page') || '';
  var address = document.body.getAttribute('data-address') || 'www.terrana.ccn';

  var nav = [
    ['rulebook', 'Rulebook', 'rulebook/index.html'],
    ['forge', 'Character Forge', 'forge/index.html'],
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

  var navHtml = nav.map(function (n) {
    var cur = page === n[0] ? ' aria-current="page"' : '';
    return '<a href="' + root + n[2] + '"' + cur + '>' + n[1] + '</a>';
  }).join('') + '<a class="login" href="' + root + 'account/index.html">Log In</a>';

  var menuHtml = chapters.map(function (c) {
    var cur = page === c[0] ? ' aria-current="page"' : '';
    return '<a class="menu-item" href="' + root + 'rulebook/' + c[0] + '.html"' + cur + '>' +
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
      '<div class="menu-label px">CHAPTERS</div>' +
      '<nav aria-label="Chapters">' + menuHtml + '</nav>';

    var rail = document.createElement('div');
    rail.className = 'rail win';
    rail.innerHTML =
      '<button class="icon-btn" type="button" id="menu-show" aria-label="Show chapter menu" aria-controls="chapter-menu">' + chevRight + '</button>' +
      '<span class="px" aria-hidden="true">CHAPTERS</span>';

    layout.insertBefore(rail, layout.firstChild);
    layout.insertBefore(side, rail);

    var KEY = 'terrana-menu-hidden';
    function setHidden(hidden, save) {
      document.body.classList.toggle('menu-hidden', hidden);
      if (save) {
        try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (e) { /* storage blocked: fine */ }
      }
    }

    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
    if (saved === null) {
      setHidden(window.matchMedia('(max-width: 760px)').matches, false);
    } else {
      setHidden(saved === '1', false);
    }

    document.getElementById('menu-hide').addEventListener('click', function () {
      setHidden(true, true);
      document.getElementById('menu-show').focus();
    });
    document.getElementById('menu-show').addEventListener('click', function () {
      setHidden(false, true);
      document.getElementById('menu-hide').focus();
    });
  }

  var bottom = document.getElementById('site-bottom');
  if (bottom) {
    bottom.outerHTML =
      '<footer class="site-footer win">' +
        '<span class="px">Credits</span><br>' +
        'Icons by Lorc and Skoll from <a href="https://game-icons.net">game-icons.net</a>, licensed ' +
        '<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>. ' +
        'Fonts: <a href="https://github.com/fontworks-fonts/DotGothic16">DotGothic16</a> by Fontworks and ' +
        '<a href="https://fonts.google.com/specimen/Nunito+Sans">Nunito Sans</a>, via <a href="https://fontsource.org">Fontsource</a>, licensed under the ' +
        '<a href="https://openfontlicense.org">SIL Open Font License</a>.' +
      '</footer>';
  }
})();
