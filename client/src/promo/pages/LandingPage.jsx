import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { FEATURES } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

// Reveal on scroll.
//
// ONE mechanism, deliberately: a rAF-coalesced passive scroll pass that reveals
// anything whose top has entered the viewport, plus one pass at mount. An
// IntersectionObserver was tried first and is NOT jump-proof — measured at
// 1440x900, jumping straight to the foot of the page left 11 of 18 sections at
// opacity 0 forever, because an element that crosses the whole viewport inside
// one frame never reports a threshold crossing. A browser restoring scroll
// position on reload lands in the same state. Running both would be two things
// doing one job, and the one that drifts is the one nobody tests.
//
// It costs nothing once the page is read: the listener removes itself as soon
// as every element has been revealed.
function useReveal() {
  const root = useRef(null);
  useEffect(() => {
    const els = [...(root.current?.querySelectorAll(".promo-reveal") || [])];
    if (!els.length) return;

    let pending = els;
    let raf = 0;

    const sweep = () => {
      const h = window.innerHeight;
      pending = pending.filter((el) => {
        if (el.getBoundingClientRect().top >= h * 0.92) return true;
        el.classList.add("is-in");
        return false;
      });
      if (!pending.length) window.removeEventListener("scroll", onScroll);
    };

    function onScroll() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sweep();
      });
    }

    sweep();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return root;
}

export default function LandingPage() {
  const root = useReveal();

  return (
    <main ref={root}>
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="promo-section promo-hero">
        <div className="promo-shell">
          {/* No lockup here. The nav already carries it 90px above at almost
              the same visual weight, and two identical lockups inside one
              screen reads as a mistake rather than as branding. The headline
              is what the hero is for. */}
          <h1 className="promo-hero-title">
            Every task is a checkbox.
            <br />
            <span className="promo-hero-em">Or a measurement.</span>
          </h1>
          <p className="promo-lede promo-hero-lede">
            Drag what you do into a day, and record how much of it you did. Viafluere adds it
            up, counts it, and tracks it across any window of time you choose — without a
            separate tool for every question you want answered.
          </p>
          <div className="promo-hero-actions">
            <Link to="/login" className="promo-btn promo-btn--primary">
              Get started — it&rsquo;s free
            </Link>
            <Link to="/examples" className="promo-btn promo-btn--ghost">
              See what people build
            </Link>
          </div>
        </div>
      </section>

      {/* ── Capabilities ───────────────────────────────────────── */}
      <section className="promo-section">
        <div className="promo-shell">
          <p className="promo-eyebrow promo-reveal">What it does</p>
          <h2 className="promo-h2 promo-reveal">
            A workspace you assemble, not a screen you are handed
          </h2>
          <p className="promo-lede promo-reveal">
            There is no built-in planner to work around. You build the thing you need out of
            pieces that all speak the same language.
          </p>
          <div className="promo-grid">
            {FEATURES.map((f) => (
              <Link
                key={f.slug}
                to={`/features/${f.slug}`}
                className="promo-card promo-reveal"
              >
                <div className="promo-card-stat">{f.stat.value}</div>
                <h3>{f.nav}</h3>
                <p>{f.tagline}</p>
                <span className="promo-card-more">Read more →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Examples ───────────────────────────────────────────── */}
      <section className="promo-section promo-section--raised">
        <div className="promo-shell">
          <p className="promo-eyebrow promo-reveal">Built with it</p>
          <h2 className="promo-h2 promo-reveal">
            None of these are features. They are things people assembled.
          </h2>
          <p className="promo-lede promo-reveal">
            Each one is the same handful of capabilities put together a different way — which
            means you can change any of them, or build something they never anticipated.
          </p>
          <div className="promo-grid">
            {EXAMPLES.map((e) => (
              <article key={e.id} className="promo-card promo-reveal">
                <h3>{e.name}</h3>
                <p>{e.blurb}</p>
              </article>
            ))}
          </div>
          <p style={{ marginTop: 28 }}>
            <Link to="/examples" className="promo-btn promo-btn--ghost">
              Look at these in detail
            </Link>
          </p>
        </div>
      </section>

      {/* ── Closing CTA ────────────────────────────────────────── */}
      <section className="promo-section">
        <div className="promo-shell promo-cta">
          <h2 className="promo-h2 promo-reveal">Start with an empty grid</h2>
          <p className="promo-lede promo-reveal" style={{ marginInline: "auto" }}>
            Signing up creates your workspace immediately. There is nothing to install and no
            card to enter.
          </p>
          <Link to="/login" className="promo-btn promo-btn--primary promo-reveal">
            Create your workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
