import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import PromoNav from "./PromoNav.jsx";
import PromoFooter from "./PromoFooter.jsx";
import "./promo.css";

export default function PromoLayout() {
  const { pathname } = useLocation();

  // The grid is a fixed-viewport app: index.css pins html/body/#root to
  // `height:100%; overflow:hidden` for everyone, which leaves this document
  // unable to scroll at all. Stamping the root element opts the promo surface
  // out for exactly as long as it is mounted — see the note in promo.css.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("promo-html");
    return () => html.classList.remove("promo-html");
  }, []);

  // A client-side route change does not reset scroll. Without this, following a
  // nav link from halfway down the landing page lands you halfway down the
  // next one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="promo">
      <PromoNav />
      <Outlet />
      <PromoFooter />
    </div>
  );
}
