import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import PromoNav from "./PromoNav.jsx";
import PromoFooter from "./PromoFooter.jsx";
import "./promo.css";

export default function PromoLayout() {
  const { pathname } = useLocation();

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
