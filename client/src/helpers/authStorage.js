// helpers/authStorage.js
//
// The ONE place that knows which localStorage keys hold a session.
//
// This exists because `bindSocketToStore` was the only writer of the token and
// it is bound from inside App.jsx — so any surface that renders the login form
// WITHOUT the app mounted (the promo /login route) would authenticate, receive
// auth_success, and never store the result. Extracting the writer is the fix;
// a second copy in the promo route would be the bug wearing a new hat.
//
// Every accessor is try/caught: the promo entry split calls hasSession() before
// React mounts, and a browser with storage denied must fall through to the
// landing page rather than throw on the first line of the app.

export const AUTH_KEYS = {
  token: "moduli-token",
  userId: "moduli-userId",
  gridId: "moduli-gridId",
};

export function persistAuth({ token, userId } = {}) {
  try {
    if (token) localStorage.setItem(AUTH_KEYS.token, token);
    if (userId) localStorage.setItem(AUTH_KEYS.userId, userId);
  } catch {}
}

export function clearAuth() {
  try {
    localStorage.removeItem(AUTH_KEYS.token);
    localStorage.removeItem(AUTH_KEYS.userId);
    // The gridId is scoped to the user who was signed in. Leaving it behind
    // makes the next login request a grid that is not theirs.
    localStorage.removeItem(AUTH_KEYS.gridId);
  } catch {}
}

export function readToken() {
  try {
    return localStorage.getItem(AUTH_KEYS.token);
  } catch {
    return null;
  }
}

export function hasSession() {
  return Boolean(readToken());
}
