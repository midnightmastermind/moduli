// modules/Module.jsx
// Thin router — renders <View occurrence={occ} /> for every occurrence.
// All layout/sidebar/routing logic lives in View.jsx.
import View from "./View.jsx";

export default function Module({ occurrence, embedded = false, ...props }) {
  if (!occurrence) return null;
  return <View occurrence={occurrence} embedded={embedded} {...props} />;
}
