// containers/ContainerList.jsx
// List container subtype — the default drag-sortable instance list.
//
// The list rendering (drop indicators, sorted instances, focused-item drill-down,
// sibling/child/history panels) lives in ModuleContainer.jsx as the fallback branch.
// This file serves as the architectural anchor for that subtype.
//
// Future: extract the focused-item view + history panel into this file once
// ModuleContainer's useReducer state is further decomposed.

// Re-export ModuleInstance as the primary building block of list containers.
export { default as ListItem } from "../ModuleInstance.jsx";
