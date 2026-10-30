// ui/StaticTextmap.jsx — a textmap drawn read-only, for a textblock's lazy stand-in (helpers/lazyEditor
// standInBlocks decides what it may hold). Top-level paragraphs are the stand-in's line <div>s (the CSS that sizes a
// line keys on `.textblock-card-placeholder > div`); lists are lists; a doc chip is the doc chip's own component
// with no editor (as in an idle table cell).
import React from "react";
import InstanceTextblockInlineNode from "../docs/pills/InstanceTextblockInlineNode.jsx";

function Inline({ node, k }) {
  if (node.type === "hardBreak") return <br key={k} />;
  if (node.type === "instanceTextblockInline") {
    return <InstanceTextblockInlineNode key={k} node={{ attrs: node.attrs, nodeSize: 1 }} editor={null} getPos={null} deleteNode={null} />;
  }
  if (node.type !== "text") return null;
  let el = node.text;
  for (const m of node.marks || []) {
    if (m.type === "bold") el = <strong>{el}</strong>;
    else if (m.type === "italic") el = <em>{el}</em>;
    else if (m.type === "strike") el = <s>{el}</s>;
    else if (m.type === "code") el = <code>{el}</code>;
    else if (m.type === "underline") el = <u>{el}</u>;
    else if (m.type === "link" && m.attrs?.href) el = <a href={m.attrs.href} target="_blank" rel="noopener noreferrer">{el}</a>;
  }
  return <React.Fragment key={k}>{el}</React.Fragment>;
}

const inlines = (n) => (n.content || []).map((c, i) => <Inline node={c} k={i} key={i} />);

function Block({ node }) {
  switch (node.type) {
    case "paragraph": return <div style={{ minHeight: "1.35em" }}>{node.content?.length ? inlines(node) : " "}</div>;
    case "heading": return <div style={{ minHeight: "1.35em", fontWeight: 600 }}>{inlines(node)}</div>;
    case "bulletList":
    case "orderedList": {
      const L = node.type === "bulletList" ? "ul" : "ol";
      return <L className="standin-list">{(node.content || []).map((li, i) => <Block node={li} key={i} />)}</L>;
    }
    case "listItem": return <li>{(node.content || []).map((c, i) => (c.type === "paragraph" ? <p key={i}>{inlines(c)}</p> : <Block node={c} key={i} />))}</li>;
    // a section's stand-in (helpers/lazyEditor sectionStandIn)
    case "standinCard": return <div className="standin-card">{(node.content || []).map((c, i) => <Block node={c} key={i} />)}</div>;
    case "standinSection": return (
      <div className="standin-section">
        {node.label ? <div className="standin-section-label">{node.label}</div> : null}
        {(node.content || []).map((c, i) => <Block node={c} key={i} />)}
      </div>
    );
    case "standinBox": return <div className="standin-box" style={{ height: node.height || 40 }} />;
    default: return null;
  }
}

export default function StaticTextmap({ nodes }) {
  return <>{(nodes || []).map((n, i) => <Block node={n} key={i} />)}</>;
}
