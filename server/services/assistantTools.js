// services/assistantTools.js
// ============================================================
// Tool PACKS for the assistant. The assistant is designed as a core
// engine (provider loops + selection, in assistantAgent.js) that runs a
// composed set of tools. A "port" (a surface the assistant is reached
// through) decides WHICH packs + WHICH context it gets:
//
//   • moduliToolPack  — the Moduli grid commands. This is what the Moduli
//                       chatbox port exposes; it carries the user's gridId
//                       + Bearer token, so the assistant only ever acts on
//                       THIS user's grid via the public /api/v1 surface.
//   • systemToolPack  — general filesystem + command execution (the
//                       code-agent capability from docs/aispecs.md). Part
//                       of the BIGGER system, not Moduli-specific. Returns
//                       [] unless ASSISTANT_EXEC=1, so the Moduli port
//                       ships without it by default.
//
// Each tool is `{ name, description, input_schema, destructive,
// requires_confirm?, run }`. `run(input)` returns serializable JSON. The
// core engine adapts these to whichever backend is active (Ollama /
// Anthropic / deterministic) — packs never know which model is driving.
// ============================================================

import {
  EXEC_ENABLED,
  sandboxReadFile,
  sandboxWriteFile,
  sandboxListDir,
  sandboxRunCommand,
  sandboxInfo,
} from "./execSandbox.js";

// Compress a full grid-state dump into a compact, token-bounded summary. The
// raw /grids/:id/state response carries every occurrence (~hundreds), which
// blows a local model's context window and tells it almost nothing actionable.
// This returns counts + the named things an agent actually references by id
// (folders, pages, fields, operations) and points it at the list_* tools for
// deeper drilling. Pure — unit-testable without a server.
export function summarizeGridState(state, { limit = 50 } = {}) {
  const modules = Array.isArray(state?.modules) ? state.modules : [];
  const occurrences = Array.isArray(state?.occurrences) ? state.occurrences : [];
  const fields = Array.isArray(state?.fields) ? state.fields : [];
  const operations = Array.isArray(state?.operations) ? state.operations : [];
  const folders = Array.isArray(state?.folders) ? state.folders : [];

  const roleByModuleId = new Map(modules.map(m => [m.id, m.role]));
  const pages = occurrences
    .filter(o => roleByModuleId.get(o.targetId) === "page")
    .map(o => ({ id: o.id, label: modules.find(m => m.id === o.targetId)?.label || o.id }));

  const cap = (arr, fn) => arr.slice(0, limit).map(fn);
  return {
    grid: state?.grid ? { id: state.grid.id, name: state.grid.name, rows: state.grid.rows, cols: state.grid.cols, activeFilterId: state.grid.activeFilterId } : null,
    counts: {
      modules: modules.length,
      occurrences: occurrences.length,
      pages: pages.length,
      fields: fields.length,
      operations: operations.length,
      folders: folders.length,
    },
    folders: cap(folders, f => ({ id: f.id, name: f.name })),
    pages: pages.slice(0, limit),
    fields: cap(fields, f => ({ id: f.id, name: f.name, type: f.type })),
    operations: cap(operations, o => ({ id: o.id, name: o.name })),
    note: "Summary only. Use list_modules / list_occurrences / list_fields / list_folders for full records, filtered by parentId or moduleId.",
  };
}

// ── Moduli pack — grid commands, scoped to the caller's token + grid ──────
// Thin wrappers over /api/v1. No special privileges: permissions are the
// caller's Bearer token, exactly like any external integration.
export function moduliToolPack({ baseUrl, apiToken, gridId }) {
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  const call = async (method, path, body) => {
    const init = { method, headers };
    if (body != null) init.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/api/v1${path}`, init);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  return [
    {
      name: "wikipedia_search",
      description: "Search Wikipedia for matches; returns title + snippet + URL per hit. Read-only.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", default: 5 } },
        required: ["query"],
      },
      destructive: false,
      run: async ({ query, limit = 5 }) => {
        const r = await call("GET", `/research/wikipedia/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        return r.body;
      },
    },
    {
      name: "wikipedia_links",
      description: "List the article titles a Wikipedia article links to (its 'surrounding links'), in document order, real articles only. Use for 'make a page on X AND the surrounding links': call this, then call wikipedia_import ONCE PER chosen title (each becomes its own doc page the user approves). Pass `max` for how many.",
      input_schema: {
        type: "object",
        properties: { title: { type: "string" }, query: { type: "string", description: "Used to resolve the title when it's unknown" }, max: { type: "integer", default: 10 } },
      },
      destructive: false,
      run: async ({ title, query, max = 10 }) => {
        let t = title;
        if (!t && query) {
          const s = await call("GET", `/research/wikipedia/search?q=${encodeURIComponent(query)}&limit=1`);
          t = s.body?.[0]?.title || s.body?.results?.[0]?.title;
        }
        if (!t) return { error: "Provide a `title` (or a `query` to resolve one)." };
        const r = await call("GET", `/research/wikipedia/links?title=${encodeURIComponent(t)}&max=${max}`);
        return r.body;
      },
    },
    {
      name: "relink_imports",
      description: "After importing SEVERAL linked Wikipedia articles, call this with their rootOccurrenceIds (from each wikipedia_import result) to rewrite the links BETWEEN them into in-app navigation — so clicking a link to an article you imported jumps to it inside Moduli instead of opening wikipedia.org. Links to articles you did NOT import stay external.",
      input_schema: {
        type: "object",
        properties: { rootOccurrenceIds: { type: "array", items: { type: "string" } } },
        required: ["rootOccurrenceIds"],
      },
      destructive: false,
      run: async ({ rootOccurrenceIds }) => {
        const r = await call("POST", `/research/wikipedia/relink`, { gridId, rootOccurrenceIds });
        return r.body;
      },
    },
    {
      name: "wikipedia_summary",
      description: "Fetch the short summary (lede) of a Wikipedia article to ANSWER a general-information question WITHOUT creating a page. Use for 'what is X / tell me about X / who is X'. Pass the article title (run wikipedia_search first if unsure of the exact title).",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Exact Wikipedia article title" },
          query: { type: "string", description: "Used as the title when `title` is omitted" },
        },
      },
      destructive: false,
      run: async ({ title, query }) => {
        const t = title || query || "";
        const r = await call("GET", `/research/wikipedia/summary?title=${encodeURIComponent(t)}`);
        return r.body;
      },
    },
    {
      name: "wikipedia_import",
      description: "Research a topic on Wikipedia and create a Moduli doc/page from it (e.g. 'create a doc page of the Wikipedia article for Eminem'). Mints containers/instances/textblocks under parentId (or at the root if none). The user's primary 'make me a page on X' tool.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query if title is unknown" },
          title: { type: "string", description: "Exact Wikipedia article title; takes precedence over query" },
          parentId: { type: "string", description: "Optional occurrence id under which to nest the new page" },
          dryRun: { type: "boolean", default: false, description: "Plan without minting" },
        },
      },
      destructive: false,
      // Hold for Approve/Decline so the user can preview the article (title +
      // thumbnail + extract, fetched by the confirm card) before it's imported.
      requires_confirm: true,
      run: async ({ query, title, parentId, dryRun }) => {
        const r = await call("POST", `/research/wikipedia/import`, { gridId, query, title, parentId, dryRun });
        return r.body;
      },
    },
    {
      name: "import_markdown",
      description: "Turn caller-supplied markdown into Moduli entities. Use when the user pastes a doc.",
      input_schema: {
        type: "object",
        properties: {
          markdown: { type: "string" },
          title: { type: "string" },
          parentId: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
        required: ["markdown"],
      },
      destructive: false,
      run: async ({ markdown, title, parentId, dryRun }) => {
        const r = await call("POST", `/import/markdown`, { gridId, markdown, title, parentId, dryRun });
        return r.body;
      },
    },
    {
      name: "list_operations",
      description: "List the user's operations. Use ?runnable=true to filter to externally-invokable ones.",
      input_schema: {
        type: "object",
        properties: { runnable: { type: "boolean" }, limit: { type: "integer", default: 25 } },
      },
      destructive: false,
      run: async ({ runnable, limit = 25 }) => {
        const r = await call("GET", `/operations?gridId=${encodeURIComponent(gridId)}${runnable ? "&runnable=true" : ""}&limit=${limit}`);
        return r.body;
      },
    },
    {
      name: "run_operation",
      description: "Invoke an operation by id with vars. Uses the server-side executor when possible.",
      input_schema: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          vars: { type: "object", additionalProperties: true },
        },
        required: ["operationId"],
      },
      destructive: false,
      run: async ({ operationId, vars }) => {
        const r = await call("POST", `/operations/${operationId}/run`, { vars: vars || {}, executor: "auto" });
        return r.body;
      },
    },

    // ── Grid state (the snapshot) ──────────────────────────────────────────
    {
      name: "get_grid_state",
      description: "Compact summary of the grid — counts plus the named folders, pages, fields, and operations (with ids) you reference when acting. Use to see what exists before acting; drill deeper with the list_* tools.",
      input_schema: { type: "object", properties: {} },
      destructive: false,
      run: async () => {
        const r = await call("GET", `/grids/${encodeURIComponent(gridId)}/state`);
        return (r.body && typeof r.body === "object" && !r.body.error)
          ? summarizeGridState(r.body)
          : r.body;
      },
    },

    // ── Modules (templates: panel/container/instance/page/field-bearing) ───
    {
      name: "list_modules",
      description: "List modules (templates). Filter by role (panel/container/instance/page/textblock/artifact), kind (list/doc/board/canvas/table), or label substring q.",
      input_schema: { type: "object", properties: { role: { type: "string" }, kind: { type: "string" }, q: { type: "string" }, limit: { type: "integer", default: 50 } } },
      destructive: false,
      run: async ({ role, kind, q, limit = 50 }) => {
        const qs = new URLSearchParams({ gridId, limit: String(limit) });
        if (role) qs.set("role", role); if (kind) qs.set("kind", kind); if (q) qs.set("q", q);
        return (await call("GET", `/modules?${qs}`)).body;
      },
    },
    {
      name: "create_module",
      description: "Create a module (template). Provide role + kind + label. Pair with create_occurrence to actually place it on the grid.",
      input_schema: { type: "object", properties: { label: { type: "string" }, role: { type: "string" }, kind: { type: "string" }, meta: { type: "object", additionalProperties: true } }, required: ["label", "role"] },
      destructive: false,
      run: async (body) => (await call("POST", `/modules`, { gridId, ...body })).body,
    },
    {
      name: "update_module",
      description: "Patch a module by id (e.g. rename label, change kind/meta).",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/modules/${id}`, patch || {})).body,
    },
    {
      name: "delete_module",
      description: "Delete a module by id. Destructive — orphans its occurrences.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/modules/${id}`)).body,
    },

    // ── Occurrences (placements: what actually appears on the grid) ────────
    {
      name: "list_occurrences",
      description: "List occurrences (placements). Filter by parentId (children of a container/page) or moduleId (every placement of a template).",
      input_schema: { type: "object", properties: { parentId: { type: "string" }, moduleId: { type: "string" }, limit: { type: "integer", default: 100 } } },
      destructive: false,
      run: async ({ parentId, moduleId, limit = 100 }) => {
        const qs = new URLSearchParams({ gridId, limit: String(limit) });
        if (parentId) qs.set("parentId", parentId); if (moduleId) qs.set("moduleId", moduleId);
        return (await call("GET", `/occurrences?${qs}`)).body;
      },
    },
    {
      name: "get_occurrence",
      description: "Fetch one occurrence by id (its fields, parentId, children, etc.).",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: false,
      run: async ({ id }) => (await call("GET", `/occurrences/${id}`)).body,
    },
    {
      name: "create_occurrence",
      description: "Create a NEW item on the grid. Easiest: pass a `label` (e.g. 'ran ai test') and your best-guess `parentId` (the container/page it goes in) — the app shows the user a card to confirm/correct the location before it's placed, and auto-creates the template + links it into the parent so it actually renders. You may pass `moduleId` instead of `label` to instantiate an existing template. `fields` is an object keyed by real field id ({ value }).",
      input_schema: { type: "object", properties: { label: { type: "string", description: "Name of the new item (auto-creates its template)" }, moduleId: { type: "string", description: "Existing template id (alternative to label)" }, parentId: { type: "string", description: "Best-guess destination container/page id; the user confirms it" }, fields: { type: "object", additionalProperties: true } } },
      destructive: false,
      requires_confirm: true,
      run: async ({ label, moduleId, parentId, fields }) => {
        const isPlaceholder = (id) => !id || typeof id !== "string" || /[<>\s]/.test(id);
        // 1. Resolve the template: mint one from `label` when moduleId is
        //    missing or an obvious placeholder (small models hand back
        //    "<...-id>" strings). Generic — works for any kind of item.
        let resolvedModuleId = moduleId;
        if (isPlaceholder(resolvedModuleId)) {
          if (!label) return { error: "Provide a `label` for the new item (or a real `moduleId`)." };
          const mr = await call("POST", `/modules`, { gridId, role: "instance", kind: "list", label });
          resolvedModuleId = mr.body?.module?.id;
          if (!resolvedModuleId) return { error: `couldn't create template: ${JSON.stringify(mr.body)}` };
        }
        // 2. Create the occurrence (drop unresolved placeholder parents).
        const cleanParent = isPlaceholder(parentId) ? undefined : parentId;
        const cr = await call("POST", `/occurrences`, { gridId, moduleId: resolvedModuleId, parentId: cleanParent, fields: fields || {} });
        const occ = cr.body?.occurrence;
        if (!occ?.id) return cr.body;
        // 3. Link into the parent's occurrences[] — containers render children
        //    from that array, so without this the item wouldn't appear.
        if (cleanParent) {
          const pr = await call("GET", `/occurrences/${cleanParent}`);
          const parent = pr.body?.occurrence;
          if (parent) {
            const list = Array.isArray(parent.occurrences) ? parent.occurrences : [];
            if (!list.includes(occ.id)) await call("PATCH", `/occurrences/${cleanParent}`, { occurrences: [...list, occ.id] });
          }
        }
        return { occurrence: occ, moduleId: resolvedModuleId, parentId: cleanParent || null, placedIn: cleanParent || "(root — no parent)" };
      },
    },
    {
      name: "update_occurrence",
      description: "Patch an occurrence by id (e.g. parentId to move it, occurrences[] to reorder, meta/ownStyle).",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/occurrences/${id}`, patch || {})).body,
    },
    {
      name: "set_occurrence_field",
      description: "Write a single field VALUE on an occurrence (the common 'log a measurement / set a value' action). flow is in/out/replace.",
      input_schema: { type: "object", properties: { id: { type: "string" }, fieldId: { type: "string" }, value: {}, flow: { type: "string" } }, required: ["id", "fieldId", "value"] },
      destructive: false,
      run: async ({ id, fieldId, value, flow }) => (await call("PUT", `/occurrences/${id}/fields/${fieldId}`, { value, flow })).body,
    },
    {
      name: "delete_occurrence",
      description: "Delete an occurrence (and its descendants) by id. Destructive.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/occurrences/${id}`)).body,
    },

    // ── Fields (what data an instance can collect) ─────────────────────────
    {
      name: "list_fields",
      description: "List fields. Filter by type (number/text/boolean/select/date/duration/rating/occurrence) or name substring q.",
      input_schema: { type: "object", properties: { type: { type: "string" }, q: { type: "string" }, limit: { type: "integer", default: 100 } } },
      destructive: false,
      run: async ({ type, q, limit = 100 }) => {
        const qs = new URLSearchParams({ gridId, limit: String(limit) });
        if (type) qs.set("type", type); if (q) qs.set("q", q);
        return (await call("GET", `/fields?${qs}`)).body;
      },
    },
    {
      name: "create_field",
      description: "Create a field definition. Provide name + type (number/text/boolean/select/date/duration/rating/occurrence). Bind it to instances via update_module/update_occurrence.",
      input_schema: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, unit: { type: "string" }, meta: { type: "object", additionalProperties: true } }, required: ["name", "type"] },
      destructive: false,
      // The drawer shows an editable confirm card (name / type / unit) so the
      // user can fix the model's guess before the field is created.
      requires_confirm: true,
      run: async (body) => (await call("POST", `/fields`, { gridId, ...body })).body,
    },
    {
      name: "update_field",
      description: "Patch a field by id (rename, change type/unit/meta/displayConfig).",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/fields/${id}`, patch || {})).body,
    },
    {
      name: "delete_field",
      description: "Delete a field by id. Destructive.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/fields/${id}`)).body,
    },

    // ── Operations (automation pipelines) ──────────────────────────────────
    {
      name: "create_operation",
      description: "Create an operation (automation pipeline). Advanced — provide name + pipeline { sources, steps } + triggerObjects. A bad pipeline can loop; prefer dry runs first.",
      input_schema: { type: "object", properties: { name: { type: "string" }, pipeline: { type: "object", additionalProperties: true }, triggerObjects: { type: "array" }, enabled: { type: "boolean" } }, required: ["name"] },
      destructive: true,
      requires_confirm: true,
      run: async (body) => (await call("POST", `/operations`, { gridId, ...body })).body,
    },
    {
      name: "update_operation",
      description: "Patch an operation by id (edit pipeline/triggers/enabled). Destructive — changes automation behavior.",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/operations/${id}`, patch || {})).body,
    },
    {
      name: "delete_operation",
      description: "Delete an operation by id. Destructive.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/operations/${id}`)).body,
    },

    // ── Templates (stamp a saved layout) ──────────────────────────────────
    {
      name: "apply_template",
      description: "Stamp a saved template subtree (a routine / day-page / project layout) under a target occurrence. mode 'append' adds it as a child; 'replace' replaces the target's children. Find template + target ids via get_grid_state / list_occurrences first.",
      input_schema: { type: "object", properties: { templateOccurrenceId: { type: "string" }, targetOccurrenceId: { type: "string" }, mode: { type: "string", enum: ["append", "replace"] } }, required: ["templateOccurrenceId", "targetOccurrenceId"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ templateOccurrenceId, targetOccurrenceId, mode }) =>
        (await call("POST", `/templates/apply`, { templateOccurrenceId, targetOccurrenceId, mode })).body,
    },

    // ── Manifests (root of a folder tree — determines where things live) ───
    {
      name: "list_manifests",
      description: "List manifests — each is the root of a folder tree (rootFolderId). Filter by manifestType (e.g. 'user', 'templates'). The grid's manifestId says which one is its primary tree.",
      input_schema: { type: "object", properties: { manifestType: { type: "string" } } },
      destructive: false,
      run: async ({ manifestType }) => {
        const qs = new URLSearchParams({ gridId });
        if (manifestType) qs.set("manifestType", manifestType);
        return (await call("GET", `/manifests?${qs}`)).body;
      },
    },
    {
      name: "create_manifest",
      description: "Create a manifest (a new folder-tree root). Provide name + manifestType + rootFolderId.",
      input_schema: { type: "object", properties: { name: { type: "string" }, manifestType: { type: "string" }, rootFolderId: { type: "string" }, meta: { type: "object", additionalProperties: true } } },
      destructive: false,
      run: async (body) => (await call("POST", `/manifests`, { gridId, ...body })).body,
    },
    {
      name: "update_manifest",
      description: "Patch a manifest (rename, repoint rootFolderId — i.e. change which folder tree is the root, where everything lives).",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/manifests/${id}`, patch || {})).body,
    },
    {
      name: "delete_manifest",
      description: "Delete a manifest by id. Destructive — removes a whole folder-tree root.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/manifests/${id}`)).body,
    },

    // ── Folders (manifest-tree organization) ──────────────────────────────
    {
      name: "list_folders",
      description: "List folders (the tree that organizes pages/docs). Filter by parentId.",
      input_schema: { type: "object", properties: { parentId: { type: "string" } } },
      destructive: false,
      run: async ({ parentId }) => {
        const qs = new URLSearchParams({ gridId });
        if (parentId !== undefined) qs.set("parentId", parentId);
        return (await call("GET", `/folders?${qs}`)).body;
      },
    },
    {
      name: "create_folder",
      description: "Create a folder. Provide name + optional parentId (null = root).",
      input_schema: { type: "object", properties: { name: { type: "string" }, parentId: { type: "string" }, folderType: { type: "string" } }, required: ["name"] },
      destructive: false,
      run: async (body) => (await call("POST", `/folders`, { gridId, ...body })).body,
    },
    {
      name: "update_folder",
      description: "Patch a folder (rename, reparent via parentId, sortOrder).",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id, patch }) => (await call("PATCH", `/folders/${id}`, patch || {})).body,
    },
    {
      name: "delete_folder",
      description: "Delete a folder by id. Destructive.",
      input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ id }) => (await call("DELETE", `/folders/${id}`)).body,
    },

    // ── Views (render config: activeOccurrenceId = which page a panel shows) ─
    {
      name: "list_views",
      description: "List view records (render config for panels/artifact viewers).",
      input_schema: { type: "object", properties: {} },
      destructive: false,
      run: async () => (await call("GET", `/views?gridId=${encodeURIComponent(gridId)}`)).body,
    },
    {
      name: "update_view",
      description: "Patch a view — most commonly set activeOccurrenceId to switch which page a panel displays.",
      input_schema: { type: "object", properties: { id: { type: "string" }, patch: { type: "object", additionalProperties: true } }, required: ["id", "patch"] },
      destructive: false,
      run: async ({ id, patch }) => (await call("PATCH", `/views/${id}`, patch || {})).body,
    },
    {
      name: "create_view",
      description: "Create a view record (viewType, manifestId, activeOccurrenceId, layout). Advanced.",
      input_schema: { type: "object", properties: { viewType: { type: "string" }, activeOccurrenceId: { type: "string" }, manifestId: { type: "string" }, hasTree: { type: "boolean" }, layout: { type: "object", additionalProperties: true } } },
      destructive: false,
      run: async (body) => (await call("POST", `/views`, { gridId, ...body })).body,
    },

    // ── Grid settings & filters (what's visible / active iteration) ────────
    {
      name: "update_grid",
      description: "Patch grid-level settings: name, rows, cols, meta, and the filter system (namedFilters / activeFilterId / activeFilterValues). The main lever for what's visible and which iteration (date/period) is active.",
      input_schema: { type: "object", properties: { patch: { type: "object", additionalProperties: true } }, required: ["patch"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ patch }) => (await call("PATCH", `/grids/${encodeURIComponent(gridId)}`, patch || {})).body,
    },
    {
      name: "set_active_filter",
      description: "Switch the active named filter (and optionally set its field values, e.g. the active date). activeFilterValues is a { fieldId: value } map. Reversible; the everyday 'change what's shown / what day' action.",
      input_schema: { type: "object", properties: { activeFilterId: { type: "string" }, activeFilterValues: { type: "object", additionalProperties: true } }, required: ["activeFilterId"] },
      destructive: false,
      run: async ({ activeFilterId, activeFilterValues }) => {
        const body = { activeFilterId };
        if (activeFilterValues) body.activeFilterValues = activeFilterValues;
        return (await call("PATCH", `/grids/${encodeURIComponent(gridId)}`, body)).body;
      },
    },
  ];
}

// ── System pack — general filesystem + command execution ──────────────────
// The "other execution methods" — part of the BIGGER assistant system, not
// Moduli. Returns [] unless ASSISTANT_EXEC=1 so the Moduli chatbox ships
// without it. All ops are jailed to the sandbox dir (see execSandbox.js).
// Mutating tools are flagged destructive/requires_confirm — when this pack
// is enabled, the surface SHOULD render an approval card before running
// them (the confirm UI is a tracked follow-up; see the consolidated plan).
export function systemToolPack() {
  if (!EXEC_ENABLED) return [];
  return [
    {
      name: "list_dir",
      description: "List a directory inside the assistant sandbox.",
      input_schema: { type: "object", properties: { path: { type: "string", description: "relative to sandbox root; default '.'" } } },
      destructive: false,
      run: async ({ path: p }) => sandboxListDir(p),
    },
    {
      name: "read_file",
      description: "Read a UTF-8 text file from the assistant sandbox.",
      input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      destructive: false,
      run: async ({ path: p }) => sandboxReadFile(p),
    },
    {
      name: "write_file",
      description: "Write a UTF-8 text file in the assistant sandbox (creates parent dirs). Overwrites if it exists.",
      input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ path: p, content }) => sandboxWriteFile(p, content),
    },
    {
      name: "run_command",
      description: "Run a whitelisted command (e.g. node/npm/ls) inside the assistant sandbox. No shell metacharacters; binary must be in the allow-list.",
      input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
      destructive: true,
      requires_confirm: true,
      run: async ({ command }) => sandboxRunCommand(command),
    },
    {
      name: "sandbox_info",
      description: "Report the sandbox root + allowed binaries (diagnostics).",
      input_schema: { type: "object", properties: {} },
      destructive: false,
      run: async () => sandboxInfo(),
    },
  ];
}
