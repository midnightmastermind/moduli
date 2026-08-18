import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { persistAuth } from "../../helpers/authStorage.js";

// The socket is pulled in LAZILY and only here. A visitor reading the landing
// page must not open a websocket, and socket.io-client is its own chunk — a
// static import at the top of this file would put it in the promo bundle for
// everyone. `promoIsolation.test.js` enforces the lazy form.
function useSocket() {
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    let alive = true;
    import("../../socket.js").then((m) => {
      if (alive) setSocket(m.socket);
    });
    return () => { alive = false; };
  }, []);
  return socket;
}

export default function LoginRoute() {
  const socket = useSocket();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // WHICH action is in flight, not merely that one is, so each button can name
  // what it is doing. (This used to carry a "takes up to a minute" note as well:
  // registering awaited a full workspace seed, measured at 50.7s. That seed is
  // gone as of 2026-08-18 — a fresh account gets an empty grid and the reply
  // lands in ~160ms — so the note would now be a lie and it went with it.)
  const [busy, setBusy] = useState("");
  const emailRef = useRef(null);

  useEffect(() => { emailRef.current?.focus(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onSuccess = (payload) => {
      // This route owns persistence because bindSocketToStore — the only other
      // writer — lives inside the app, which is not mounted on this route.
      persistAuth(payload || {});
      // A FULL navigation rather than a client-side one: the entry split in
      // main.jsx reads the token synchronously at startup, so reloading is what
      // hands the visitor to the grid. Swapping the app in underneath the
      // router would need the whole store bootstrapped here.
      window.location.assign("/");
    };
    const onError = (msg) => {
      setError(msg || "Login failed");
      setBusy("");
    };
    socket.on("auth_success", onSuccess);
    socket.on("auth_error", onError);
    return () => {
      socket.off("auth_success", onSuccess);
      socket.off("auth_error", onError);
    };
  }, [socket]);

  const submit = (event) => {
    if (!email || !password) { setError("Email and password required"); return; }
    if (!socket) { setError("Still connecting — try again in a moment"); return; }
    setError("");
    setBusy(event);
    socket.emit(event, { email, password });
  };

  return (
    <main className="promo-section promo-login">
      <div className="promo-shell promo-login-inner">
        <Link to="/" className="promo-login-mark">
          <img src="/viafluere_lockup.svg" alt="Viafluere" width="200" />
        </Link>

        <h1 className="promo-h2">Welcome back</h1>
        <p className="promo-lede">
          Signing up creates your workspace straight away — there is nothing to install.
        </p>

        <form
          className="promo-login-form"
          onSubmit={(e) => { e.preventDefault(); submit("login"); }}
        >
          <label className="promo-field">
            <span>Email</span>
            <input
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="promo-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? <p className="promo-login-error" role="alert">{error}</p> : null}

          <div className="promo-login-actions">
            <button type="submit" className="promo-btn promo-btn--primary" disabled={!!busy}>
              {busy === "login" ? "Signing in…" : "Log in"}
            </button>
            <button
              type="button"
              className="promo-btn promo-btn--ghost"
              disabled={!!busy}
              onClick={() => submit("register")}
            >
              {busy === "register" ? "Creating…" : "Create account"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
