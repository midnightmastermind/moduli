import React from "react";
import { useParams, Link } from "react-router-dom";
import { featureBySlug, FEATURES } from "../content/features.js";
import NotFoundPage from "./NotFoundPage.jsx";

export default function FeaturePage() {
  const { slug } = useParams();
  const feature = featureBySlug(slug);

  // An unknown slug renders the 404 rather than an empty template. A page
  // whose content is missing but whose chrome renders reads as working.
  if (!feature) return <NotFoundPage />;

  const others = FEATURES.filter((f) => f.slug !== feature.slug);

  return (
    <main>
      <section className="promo-section promo-feature-head">
        <div className="promo-shell">
          <p className="promo-eyebrow">{feature.nav}</p>
          <h1 className="promo-hero-title promo-feature-title">{feature.title}</h1>
          <p className="promo-lede">{feature.tagline}</p>
          <div className="promo-feature-stat">
            <span className="promo-stat">{feature.stat.value}</span>
            <span className="promo-feature-stat-label">{feature.stat.label}</span>
          </div>
        </div>
      </section>

      <section className="promo-section promo-section--raised">
        <div className="promo-shell">
          <p className="promo-feature-body">{feature.body}</p>

          {feature.shot ? (
            <figure className="promo-shot">
              <img src={`/promo/${feature.shot}`} alt={`${feature.nav} in Viafluere`} loading="lazy" />
            </figure>
          ) : null}

          <div className="promo-grid" style={{ marginTop: 40 }}>
            {feature.points.map((p) => (
              <article key={p.heading} className="promo-card">
                <h3>{p.heading}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="promo-section">
        <div className="promo-shell">
          <p className="promo-eyebrow">Keep reading</p>
          <div className="promo-grid">
            {others.map((f) => (
              <Link key={f.slug} to={`/features/${f.slug}`} className="promo-card">
                <h3>{f.nav}</h3>
                <p>{f.tagline}</p>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: 34 }}>
            <Link to="/login" className="promo-btn promo-btn--primary">
              Get started — it&rsquo;s free
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
