// promo/PromoApp.jsx — the public surface.
//
// This tree imports NOTHING from the application. A logged-out visitor
// downloads this chunk and react-router; the grid stays on disk until they
// sign in. `promoIsolation.test.js` enforces that.
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PromoLayout from "./PromoLayout.jsx";
import LandingPage from "./pages/LandingPage.jsx";
import FeaturePage from "./pages/FeaturePage.jsx";
import ExamplesPage from "./pages/ExamplesPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

// Paths that belong to the promo surface even for a signed-in visitor. One
// definition, in promoPaths.js; re-exported here for callers already holding
// the router module.
export { PROMO_PATHS } from "./promoPaths.js";

export default function PromoApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PromoLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/features/:slug" element={<FeaturePage />} />
          <Route path="/examples" element={<ExamplesPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
