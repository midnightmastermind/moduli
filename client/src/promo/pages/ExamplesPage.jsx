import React from "react";
import { Link } from "react-router-dom";
import { EXAMPLES } from "../content/examples.js";
import { featureBySlug } from "../content/features.js";

export default function ExamplesPage() {
  return (
    <main>
      <section className="promo-section promo-feature-head">
        <div className="promo-shell">
          <p className="promo-eyebrow">Examples</p>
          <h1 className="promo-hero-title promo-feature-title">
            Things people have assembled
          </h1>
          <p className="promo-lede">
            Viafluere does not ship any of these. Each one is the same capabilities put
            together a particular way — which is why you can change every part of them, or
            build something else entirely.
          </p>
        </div>
      </section>

      <section className="promo-section promo-section--raised">
        <div className="promo-shell promo-examples">
          {EXAMPLES.map((e) => (
            <article key={e.id} className="promo-example">
              <h2 className="promo-h2">{e.name}</h2>
              <p className="promo-lede">{e.blurb}</p>
              <p className="promo-feature-body">{e.detail}</p>
              <p className="promo-example-built">
                <span className="promo-example-built-label">Built from</span>
                {e.built.map((slug) => {
                  const f = featureBySlug(slug);
                  return (
                    <Link key={slug} to={`/features/${slug}`} className="promo-chip">
                      {f.nav}
                    </Link>
                  );
                })}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="promo-section">
        <div className="promo-shell promo-cta">
          <h2 className="promo-h2">Build your own version of any of these</h2>
          <Link to="/login" className="promo-btn promo-btn--primary">
            Create your workspace
          </Link>
        </div>
      </section>
    </main>
  );
}
