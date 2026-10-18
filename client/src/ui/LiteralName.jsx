import React from "react";
import { literalTarget } from "../helpers/literalTarget.js";

// Shows the name an id-valued box points at ("→ Appointments"), so a rule reads as words.
export default function LiteralName({ value, maps }) {
  const t = literalTarget(value, maps);
  if (!t) return null;
  return (
    <span
      title={`${t.kind}: ${t.label}`}
      style={{ fontSize: 10, color: "var(--text-muted)", alignSelf: "center", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      → {t.label}
    </span>
  );
}
