// LoginScreen.jsx
import React, { useState } from "react";
import { socket } from "./socket";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = () => {
    socket.emit("login", { email, password });
  };

  const register = () => {
    socket.emit("register", { email, password });
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      background: "#1D2125",
      color: "white",
      gap: 12
    }}>
      <img
        src="/moduli_logo_true_vector.svg"
        alt="Moduli"
        style={{ width: 120, height: 120, marginBottom: 8 }}
      />
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, margin: 0 }}>+moduli+</h1>

      <div style={{ height: 16 }} />

      <input
        style={{ padding: 8, width: 240 }}
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />

      <input
        type="password"
        style={{ padding: 8, width: 240 }}
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />

      <button style={{ padding: 8, width: 240 }} onClick={login}>
        Login
      </button>
      <button style={{ padding: 8, width: 240 }} onClick={register}>
        Register
      </button>
    </div>
  );
}
