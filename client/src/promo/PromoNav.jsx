import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { FEATURES } from "./content/features.js";

export default function PromoNav() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <header className="promo-nav">
      <nav className="promo-nav-inner" aria-label="Main">
        <Link to="/" className="promo-logo" onClick={close}>
          <img src="/viafluere_lockup.svg" alt="Viafluere" />
        </Link>

        <button
          type="button"
          className="promo-nav-toggle"
          aria-expanded={open ? "true" : "false"}
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>

        <div className={`promo-nav-links${open ? " is-open" : ""}`}>
          {FEATURES.map((f) => (
            <NavLink
              key={f.slug}
              to={`/features/${f.slug}`}
              className="promo-nav-link"
              onClick={close}
            >
              {f.nav}
            </NavLink>
          ))}
          <NavLink to="/examples" className="promo-nav-link" onClick={close}>
            Examples
          </NavLink>
          <Link to="/login" className="promo-btn promo-btn--ghost promo-nav-cta" onClick={close}>
            Log in
          </Link>
        </div>
      </nav>
    </header>
  );
}
