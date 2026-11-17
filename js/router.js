/* ==========================================================
   router.js — tab navigation (Drive / Notice / Chat / More)
   app.js এর পরে লোড হয়। backend বা API কিছুই ছোঁয় না।
   ========================================================== */
(function () {
  'use strict';

  const ORDER = ['drive', 'notice', 'chat', 'more'];
  const $ = (id) => document.getElementById(id);
  const pages = {};
  ORDER.forEach((n) => (pages[n] = $('page' + n[0].toUpperCase() + n.slice(1))));
  const navItems = Array.from(document.querySelectorAll('#appNav .nav-item'));
  const pill = document.querySelector('#appNav .nav-pill');

  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canVT = typeof document.startViewTransition === 'function' && !reduced;
  if (canVT) document.documentElement.classList.add('vt');

  let active = 'drive';
  const scrollMemo = {};
  document.body.dataset.tab = 'drive';

  /* ---------- transition helper ---------- */
  function transition(update, dir) {
    if (!canVT) { update(); return; }
    document.documentElement.dataset.dir = dir || 'fade';
    document.startViewTransition(update);
  }

  /* ---------- হুক: tab এ ঢুকলে যা চালাতে হবে ---------- */
  let origOpenNotice = null;
  const onEnter = {
    notice() { if (origOpenNotice) origOpenNotice(); },
    chat() {
      if (typeof currentUser !== 'undefined' && currentUser && !ws) initWebSocket();
      const c = $('chatMessages');
      if (c) c.scrollTop = c.scrollHeight;
    },
  };

  /* ---------- শুধু দেখানো (history ছোঁয় না) ---------- */
  function showTab(name, dirOverride) {
    if (!pages[name] || name === active) return;
    const from = active;
    const dir = dirOverride || (ORDER.indexOf(name) > ORDER.indexOf(from) ? 'fwd' : 'back');

    scrollMemo[from] = window.scrollY;

    transition(() => {
      ORDER.forEach((n) => pages[n] && pages[n].classList.toggle('is-active', n === name));
      navItems.forEach((b) => {
        const on = b.dataset.tab === name;
        b.classList.toggle('is-active', on);
        if (on) { b.setAttribute('aria-current', 'page'); if (pill) b.prepend(pill); }
        else b.removeAttribute('aria-current');
      });
      active = name;
      document.body.dataset.tab = name;
      window.scrollTo(0, scrollMemo[name] || 0);
    }, dir);

    if (onEnter[name]) onEnter[name]();
  }

  /* ---------- history-aware navigation ---------- */
  function navigate(name) {
    if (name === active) return;
    if (name === 'drive') {
      if (history.state && history.state.tab) { history.back(); return; } // popstate এ showTab হবে
      showTab('drive');
      return;
    }
    const st = { folder: typeof currentSelectedFolder !== 'undefined' ? currentSelectedFolder : '/', tab: name };
    if (active === 'drive') history.pushState(st, ''); else history.replaceState(st, '');
    showTab(name);
  }

  window.goTab = function (name) {
    if (name === active) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    navigate(name);
  };

  // Android back / browser back
  window.addEventListener('popstate', (e) => {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    const tab = (e.state && e.state.tab) || 'drive';
    if (tab !== active) showTab(tab, ORDER.indexOf(tab) < ORDER.indexOf(active) ? 'back' : 'fwd');
  });

  /* ---------- পুরোনো modal function গুলোকে page এ রূপান্তর ---------- */
  if (typeof openNoticeBoardModal === 'function') {
    origOpenNotice = openNoticeBoardModal;           // মূল লজিক (seen mark + loadNoticesList)
    window.openNoticeBoardModal = function () {
      if (active !== 'notice') navigate('notice');   // ঢুকলেই onEnter.notice চলবে
      else origOpenNotice();
    };
  }
  // notice details খোলার সময় app.js এটা ডাকে — Notice page এ থেকে যেতে হবে
  window.closeNoticeBoardModal = function () {};

  window.openChatFullscreen = function () {
    if (typeof currentUser === 'undefined' || !currentUser) return showToast('Please login first', 'error');
    navigate('chat');
  };
  window.closeChatFullscreen = function () { if (active === 'chat') navigate('drive'); };

  // folder খুলতে হলে (যেমন notice থেকে "Go to Folder") আগে Drive এ যাও
  if (typeof selectFolder === 'function') {
    const origSelect = selectFolder;
    window.selectFolder = function (path) {
      if (active !== 'drive') {
        history.replaceState({ folder: currentSelectedFolder }, '');
        showTab('drive', 'back');
      }
      return origSelect(path);
    };
  }

  // logout হলে পরের লগইনে যেন Drive থেকেই শুরু হয়
  if (typeof handleLogout === 'function') {
    const origLogout = handleLogout;
    window.handleLogout = function () {
      origLogout();
      history.replaceState({ folder: currentSelectedFolder }, '');
      showTab('drive', 'fade');
    };
  }

  /* ---------- nav দেখানো/লুকানো (login, guest) ---------- */
  const authView = $('authenticatedView');
  function syncChrome() {
    const guest = typeof isGuestMode !== 'undefined' && isGuestMode;
    const logged = typeof currentUser !== 'undefined' && !!currentUser;
    const visible = authView && !authView.classList.contains('hidden');
    document.body.classList.toggle('guest-mode', guest);
    document.body.classList.toggle('has-nav', !!(logged && !guest && visible));
  }
  if (authView) new MutationObserver(syncChrome).observe(authView, { attributes: true, attributeFilter: ['class'] });
  syncChrome();

  /* ---------- keyboard খুললে (phone) nav লুকাও ---------- */
  let kbdTimer;
  const isTextField = (el) =>
    el && (el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && /^(text|search|password|email|number|tel|url)$/i.test(el.type || 'text')));
  document.addEventListener('focusin', (e) => {
    if (isTextField(e.target)) { clearTimeout(kbdTimer); document.body.classList.add('kbd'); }
  });
  document.addEventListener('focusout', () => {
    kbdTimer = setTimeout(() => document.body.classList.remove('kbd'), 80);
  });
})();