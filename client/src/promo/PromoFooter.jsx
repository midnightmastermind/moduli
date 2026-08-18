import React from "react";
import { Link } from "react-router-dom";

export default function PromoFooter() {
  return (
    <footer className="promo-footer">
      <div className="promo-footer-inner">
        <span>© {new Date().getFullYear()} Viafluere</span>
        <span style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <Link to="/examples">Examples</Link>
          <Link to="/login">Log in</Link>
        </span>
      </div>
    </footer>
  );
}
