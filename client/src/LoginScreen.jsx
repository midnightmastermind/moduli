// LoginScreen.jsx
import React, { useState, useEffect, useRef } from "react";
import { socket } from "./socket";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef(null);

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    const onError = (msg) => {
      setError(msg || "Login failed");
      setLoading(false);
    };
    const onSuccess = () => setLoading(false);
    socket.on("auth_error", onError);
    socket.on("auth_success", onSuccess);
    return () => {
      socket.off("auth_error", onError);
      socket.off("auth_success", onSuccess);
    };
  }, []);

  const login = () => {
    if (!email || !password) { setError("Email and password required"); return; }
    setError("");
    setLoading(true);
    socket.emit("login", { email, password });
  };

  const register = () => {
    if (!email || !password) { setError("Email and password required"); return; }
    setError("");
    setLoading(true);
    socket.emit("register", { email, password });
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") login();
  };

  return (
    <div style={{
      height: "100vh",
      width: "100vw",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0e2140",
      backgroundImage: "url(/login_bg.jpg)",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Scrim overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "32px 28px 28px",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 10,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(12px)",
        width: 300,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 4,
        }}>
          <img
            src="/viafluere_new_logo.png"
            alt="Viafluere"
            style={{ height: 48, width: "auto", display: "block" }}
          />
        </div>

        {error && (
          <div style={{
            padding: "8px 12px",
            width: "100%",
            background: "rgba(220, 38, 38, 0.12)",
            border: "1px solid rgba(220, 38, 38, 0.3)",
            borderRadius: 6,
            color: "#fca5a5",
            fontSize: 12,
            textAlign: "center",
            fontFamily: "var(--font-mono, monospace)",
          }}>
            {error}
          </div>
        )}

        <input
          ref={emailRef}
          style={{
            padding: "8px 10px",
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "#e0e0e0",
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            outline: "none",
          }}
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="email"
        />

        <input
          type="password"
          style={{
            padding: "8px 10px",
            width: "100%",
            boxSizing: "border-box",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "#e0e0e0",
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            outline: "none",
          }}
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="current-password"
        />

        <button
          style={{
            padding: "8px 0",
            width: "100%",
            background: "rgba(59, 130, 246, 0.8)",
            border: "none",
            borderRadius: 6,
            color: "#fff",
            fontSize: 13,
            fontFamily: "var(--font-mono, monospace)",
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
            marginTop: 2,
          }}
          onClick={login}
          disabled={loading}
        >
          {loading ? "..." : "Login"}
        </button>

        <button
          style={{
            padding: "8px 0",
            width: "100%",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 6,
            color: "rgba(255,255,255,0.5)",
            fontSize: 12,
            fontFamily: "var(--font-mono, monospace)",
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.6 : 1,
          }}
          onClick={register}
          disabled={loading}
        >
          Register
        </button>
      </div>
    </div>
  );
}
