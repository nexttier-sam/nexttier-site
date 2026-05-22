// Next Tier — shared auth library
// ════════════════════════════════════════════════════════════════
// Replace this URL with your deployed Google Apps Script web app URL.
// ════════════════════════════════════════════════════════════════
const NT_API_URL = 'https://script.google.com/a/macros/nexttierstats.com/s/AKfycbwlt-hlFubdSI8X_Ck9TAPuIxfIOU7hpyLaZE5p52paZPzeM-sELzEHnHB9F0e-1fN_/exec';

const NT = (() => {
  const STORAGE_TOKEN = 'nt_token';
  const STORAGE_USER  = 'nt_user';

  function getToken() {
    return localStorage.getItem(STORAGE_TOKEN);
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(STORAGE_TOKEN, token);
    localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_USER);
  }

  async function api(payload) {
    const res = await fetch(NT_API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    'data=' + encodeURIComponent(JSON.stringify(payload))
    });
    return res.json();
  }

  async function login(email, password) {
    return api({ type: 'login', email, password });
  }

  async function register(email, password, role, firstName, lastName) {
    return api({ type: 'register', email, password, role, firstName, lastName });
  }

  async function logout() {
    const token = getToken();
    if (token) {
      try { await api({ type: 'logout', token }); } catch {}
    }
    clearSession();
    window.location.href = 'login.html';
  }

  // Validates the current session against the server.
  // Returns the user object on success, or null if invalid/expired.
  async function validate() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await api({ type: 'validate', token });
      if (res.status === 'ok') return res.user;
    } catch {}
    clearSession();
    return null;
  }

  // Auth gate for protected pages.
  // Validates the session, checks role, and redirects to login or unauthorized
  // if the check fails. Returns the user object on success.
  async function guard(allowedRoles) {
    const user = getUser();
    if (!user) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return null;
    }
    const valid = await validate();
    if (!valid) {
      window.location.href = 'login.html?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      return null;
    }
    if (allowedRoles && allowedRoles.length && !allowedRoles.includes(valid.role)) {
      window.location.href = 'unauthorized.html';
      return null;
    }
    return valid;
  }

  // Populates nav elements expected on authenticated pages.
  // Supports both data-nt-* attributes (dashboards) and #navAvatar/#navName/#navRole ids (product page).
  function renderUser() {
    const user = getUser();
    if (!user) return;
    const initial  = (user.firstName || '?')[0].toUpperCase();
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const role     = user.role || '';

    // data-nt-* pattern (existing dashboards)
    document.querySelectorAll('[data-nt-initial]').forEach(el => { el.textContent = initial; });
    document.querySelectorAll('[data-nt-name]').forEach(el    => { el.textContent = fullName; });
    document.querySelectorAll('[data-nt-role]').forEach(el    => { el.textContent = role; });

    // id-based pattern (product page)
    const avatarEl = document.getElementById('navAvatar');
    const nameEl   = document.getElementById('navName');
    const roleEl   = document.getElementById('navRole');
    if (avatarEl) avatarEl.textContent = initial;
    if (nameEl)   nameEl.textContent   = fullName;
    if (roleEl)   roleEl.textContent   = role;
  }

  return { getToken, getUser, setSession, clearSession, api, login, register, logout, validate, guard, renderUser };
})();
