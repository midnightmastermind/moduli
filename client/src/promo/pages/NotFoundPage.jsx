import React from "react";
import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="promo-section">
      <div className="promo-shell">
        <p className="promo-eyebrow">404</p>
        <h1 className="promo-hero-title promo-feature-title">Page not found</h1>
        <p className="promo-lede">
          That address does not exist. The links below do.
        </p>
        <div className="promo-hero-actions">
          <Link to="/" className="promo-btn promo-btn--primary">Home</Link>
          <Link to="/examples" className="promo-btn promo-btn--ghost">Examples</Link>
        </div>
      </div>
    </main>
  );
}
