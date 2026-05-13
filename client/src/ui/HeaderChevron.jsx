// client/src/ui/HeaderChevron.jsx
import React from "react";
import { ChevronDown } from "lucide-react";

export default function HeaderChevron({ onClick, isOpen }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="header-chevron"
      aria-expanded={isOpen}
      title="Filters & templates"
      style={{
        background: "transparent", border: 0, padding: "2px 4px",
        cursor: "pointer", display: "inline-flex", alignItems: "center",
        opacity: isOpen ? 1 : 0.6,
      }}
    >
      <ChevronDown size={14} />
    </button>
  );
}
