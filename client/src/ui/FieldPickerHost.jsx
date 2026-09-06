// The field picker, opened imperatively from a plain function.
//
// User, 2026-09-06: *"the menu to add a field to a new occurance thats been
// added via the multiselect, should have the same field picker as the quick add
// menu, not some new popup."*
//
// The add-an-option flow lives in `Field.jsx`'s commit callback — a plain
// function with no render of its own — so it needs the same shape
// `openConfirmList` and `openImagePicker` use: a host mounted once in App, and
// an opener the callback can just call.
//
// It FAILS OPEN, unlike `openConfirmList`. That refusal is right where the
// action behind it is heavy and irreversible; here the option has ALREADY been
// created and the picker is an offer to say more about it. With no host
// mounted (a preview iframe, a test harness) the right answer is to leave the
// option exactly as it is, not to lose it.
import React, { useCallback, useEffect, useState } from "react";
import MenuSurface from "./MenuSurface";
import FieldPickerPanel from "./FieldPickerPanel.jsx";

// Centred, because this opens from a commit callback with no anchor element to
// hang off — unlike the quick-add menu, which knows its own button.
const centred = () => ({
  top: Math.max(8, Math.round((window.innerHeight || 600) / 2) - 210),
  left: Math.max(8, Math.round((window.innerWidth || 800) / 2) - 150),
});

// Tokens only — a floating surface that paints its own literal colour or shadow
// stops following the skin, which `menuTheming` fails the build over.
const wrapSt = {
  width: 300,
  maxWidth: "100%",
  background: "var(--surface-overlay)",
  border: "1px solid var(--border-default, rgba(255,255,255,0.12))",
  borderRadius: 10,
  boxShadow: "var(--menu-shadow-3)",
  overflow: "hidden",
};

let _host = null;
export function registerFieldPickerHost(fn) {
  _host = fn;
  return () => { if (_host === fn) _host = null; };
}

/**
 * Open the shared field picker.
 *
 * @param {object} request
 * @param {string} request.title
 * @param {string[]} [request.picked]      field ids ticked on open
 * @param {object} [request.values]        fieldId -> initial value
 * @param {object} request.fieldsById
 * @param {object} [request.occurrence]    the row the fields are for
 * @param {object} [request.parentOccurrence]
 * @param {(picked:string[], values:object) => void} request.onConfirm
 * @param {() => void} [request.onCancel]
 * @param {string} [request.confirmLabel]
 * @returns {boolean} whether it opened
 */
export function openFieldPicker(request) {
  if (!_host) return false;
  _host(request);
  return true;
}

export function FieldPickerHost({ getOccMap, modulesById, foldersById }) {
  const [req, setReq] = useState(null);
  const [picked, setPicked] = useState([]);
  const [values, setValues] = useState({});

  useEffect(() => registerFieldPickerHost((r) => {
    setReq(r);
    setPicked(Array.isArray(r?.picked) ? [...r.picked] : []);
    setValues({ ...(r?.values || {}) });
  }), []);

  const close = useCallback(() => { setReq(null); setPicked([]); setValues({}); }, []);

  const toggle = useCallback((fid) => {
    setPicked((prev) => (prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]));
  }, []);

  const confirm = useCallback(() => {
    // The panel is closed BEFORE the caller's write runs, so a slow write never
    // leaves the picker sitting over the work it started — the same contract
    // `IntakeSheetHost` keeps.
    const r = req;
    const p = picked, v = values;
    close();
    r?.onConfirm?.(p, v);
  }, [req, picked, values, close]);

  const cancel = useCallback(() => { const r = req; close(); r?.onCancel?.(); }, [req, close]);

  if (!req) return null;

  return (
    <MenuSurface
      position={req.position || centred()}
      style={wrapSt}
      onClose={cancel}
      className="field-picker"
    >
      <div role="dialog" aria-modal="true" aria-label={req.title} style={{ display: "flex", flexDirection: "column", maxHeight: 420 }}>
        <FieldPickerPanel
          fieldsById={req.fieldsById}
          picked={picked}
          values={values}
          onToggle={toggle}
          onSetValue={(fid, nv) => setValues((p) => ({ ...p, [fid]: nv }))}
          onConfirm={confirm}
          onSkip={cancel}
          title={req.title}
          confirmLabel={req.confirmLabel || "Save"}
          skipLabel="Skip"
          occurrence={req.occurrence || null}
          parentOccurrence={req.parentOccurrence || null}
          getOccMap={getOccMap}
          modulesById={modulesById}
          foldersById={foldersById}
        />
      </div>
    </MenuSurface>
  );
}

export default FieldPickerHost;
