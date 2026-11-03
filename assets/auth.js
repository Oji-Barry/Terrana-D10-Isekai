/* Jimothy's D10 Isekai JRPG - accounts.
   Needs vendor/supabase-2.118.0.js loaded first.
   Players only ever type a username and password. Supabase wants an
   email-shaped login, so the username is turned into a made-up address
   on the reserved ".invalid" domain, which can never receive mail. */

(function () {
  var SUPABASE_URL = 'https://cgkpksidyfrjjltfvhfp.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_GjxEfXhnuhlubGY0JqMKEw_jpqdJgsi';
  var LOGIN_DOMAIN = 'players.terrana.invalid';
  var REMEMBER_KEY = 'terrana-remember-until';
  var THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  // "Keep me signed in" decides where the login is kept:
  // localStorage survives closing the browser, sessionStorage does not.
  function remembering() {
    var until = safe(function () { return Number(localStorage.getItem(REMEMBER_KEY) || 0); }, 0);
    return until > Date.now();
  }

  var storage = {
    getItem: function (k) {
      return safe(function () {
        return (remembering() ? localStorage : sessionStorage).getItem(k);
      }, null);
    },
    setItem: function (k, v) {
      safe(function () { (remembering() ? localStorage : sessionStorage).setItem(k, v); });
    },
    removeItem: function (k) {
      safe(function () { localStorage.removeItem(k); });
      safe(function () { sessionStorage.removeItem(k); });
    }
  };

  // A remembered login older than 30 days is dropped.
  safe(function () {
    var until = Number(localStorage.getItem(REMEMBER_KEY) || 0);
    if (until && until <= Date.now()) {
      localStorage.removeItem(REMEMBER_KEY);
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('sb-') === 0) localStorage.removeItem(k);
      });
    }
  });

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { storage: storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  var USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

  function loginFor(username) {
    return username.trim().toLowerCase() + '@' + LOGIN_DOMAIN;
  }

  function setRemember(on) {
    safe(function () {
      if (on) localStorage.setItem(REMEMBER_KEY, String(Date.now() + THIRTY_DAYS));
      else localStorage.removeItem(REMEMBER_KEY);
    });
  }

  function friendly(err) {
    var m = (err && err.message) || String(err || '');
    if (/invalid login credentials/i.test(m)) return 'That username and password do not match.';
    if (/already registered|already been registered|duplicate key|profiles_username_key/i.test(m)) return 'That username is taken. Try another one.';
    if (/password should be at least|weak password/i.test(m)) return 'Your password needs at least 8 characters.';
    if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
    if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
    return m || 'Something went wrong. Try again.';
  }

  async function usernameTaken(username) {
    var res = await client.from('profiles').select('id').eq('username', username.trim()).maybeSingle();
    return !!(res.data);
  }

  async function signUp(username, password, remember) {
    username = username.trim();
    if (!USERNAME.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers, dashes, or underscores.');
    if (password.length < 8) throw new Error('Your password needs at least 8 characters.');
    if (await usernameTaken(username)) throw new Error('That username is taken. Try another one.');
    setRemember(remember);
    var res = await client.auth.signUp({
      email: loginFor(username),
      password: password,
      options: { data: { username: username } }
    });
    if (res.error) { setRemember(false); throw new Error(friendly(res.error)); }
    if (!res.data.session) {
      // Shouldn't happen with email confirmation off, but log in to be sure.
      return logIn(username, password, remember);
    }
    return res.data;
  }

  async function logIn(username, password, remember) {
    setRemember(remember);
    var res = await client.auth.signInWithPassword({ email: loginFor(username), password: password });
    if (res.error) { setRemember(false); throw new Error(friendly(res.error)); }
    return res.data;
  }

  async function logOut() {
    await client.auth.signOut();
    setRemember(false);
  }

  async function currentPlayer() {
    var s = await client.auth.getSession();
    var session = s.data && s.data.session;
    if (!session) return null;
    var res = await client.from('profiles').select('id, username, is_admin').eq('id', session.user.id).maybeSingle();
    if (res.data) return res.data;
    var meta = session.user.user_metadata || {};
    return { id: session.user.id, username: meta.username || 'Player', is_admin: false };
  }

  async function changePassword(newPassword) {
    if (newPassword.length < 8) throw new Error('Your password needs at least 8 characters.');
    var res = await client.auth.updateUser({ password: newPassword });
    if (res.error) throw new Error(friendly(res.error));
  }

  async function adminResetPassword(username, tempPassword) {
    var res = await client.rpc('admin_reset_password', { target_username: username.trim(), new_password: tempPassword });
    if (res.error) throw new Error(friendly(res.error));
  }

  window.Terrana = window.Terrana || {};
  window.Terrana.auth = {
    client: client,
    signUp: signUp,
    logIn: logIn,
    logOut: logOut,
    currentPlayer: currentPlayer,
    changePassword: changePassword,
    adminResetPassword: adminResetPassword,
    friendly: friendly,
    USERNAME: USERNAME
  };

  // Swap the top-right "Log In" button for the player's name when logged in.
  function updateNav() {
    currentPlayer().then(function (p) {
      var a = document.querySelector('.site-nav a.login');
      if (!a) return;
      var root = document.documentElement.getAttribute('data-root') || '';
      if (p) {
        a.textContent = p.username;
        a.href = root + 'characters/index.html';
        a.setAttribute('title', 'My Characters');
      }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateNav);
  else updateNav();
})();
