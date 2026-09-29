// client/src/__tests__/sharePlace.test.jsx
//
// The placement window's WIRING: what it fetches, what it shows, what it posts.
// The look is checked in a real browser (plan Task 13) — jsdom cannot say
// whether a popup reads well.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

// FieldSelect is a Radix popover jsdom cannot open reliably; it stands in as a
// plain select so these cases test SharePlace, not the picker.
// The image picker stands in as one button that picks a fixed url.
vi.mock("../ui/ImagePickerMenu.jsx", () => ({
  default: ({ initialQuery, onPick, onClose }) => (
    <div data-testid="image-picker" data-query={initialQuery}>
      <button type="button" onClick={() => { onPick("https://img/picked.jpg"); onClose(); }}>pick-it</button>
    </div>
  ),
}));

vi.mock("../ui/FieldSelect.jsx", () => ({
  default: ({ fields, value, onChange, noneLabel }) => (
    <select data-testid="field-select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {noneLabel != null && <option value="">{noneLabel}</option>}
      {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  ),
}));

const STAGED = {
  source: "extension", shape: "page", url: "https://www.imdb.com/title/tt0473488/",
  title: "A Guide to Recognizing Your Saints (2006) IMDb",
};
const MOVIES = {
  id: "o-movies", label: "Movies", crumb: "Boards › Media", role: "container", kind: "board", childCount: 993,
  shape: { moduleId: "m-movie", role: "artifact", kind: "movie", bindFields: ["f-year", "f-cat"], autoFields: { "f-cat": ["movie"] } },
};

let calls, stageStatus, presetsStored;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const posts = () => calls.filter((c) => c.opts?.method === "POST" || c.opts?.method === "PUT");
const sharePost = () => calls.find((c) => c.opts?.method === "POST" && c.url.endsWith("/share"));

beforeEach(() => {
  calls = []; stageStatus = 200; presetsStored = [{ id: "p1", name: "Movie", role: "artifact", kind: "movie",
    bindingsLike: "m-movie", bindFields: ["f-year", "f-cat"], destinationId: "o-movies", destinationLabel: "Movies",
    mappings: { "f-year": { source: "title", transform: "year" } }, labelMapping: { source: "title", transform: "stripSuffix" } }];
  window.history.replaceState({}, "", "/share-place?stage=s1&k=k1");
  // A successful Clip closes the window after a beat; in jsdom a real close
  // tears the document down under every later test.
  window.close = vi.fn();
  localStorage.setItem("moduli-token", "session-jwt");
  global.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    calls.push({ url: u, opts });
    if (u.includes("/share/stage/s1/cover")) return json({ cover: "https://img/og.jpg", via: "og" });
    if (u.includes("/share/stage/s1/preview")) return json({ gridId: "g1", ruleId: "r1", ruleName: "Share: link", lands: "Bookmarks" });
    if (u.includes("/share/stage/s1")) return stageStatus === 200 ? json({ payload: STAGED }) : json({ error: "not_found" }, 404);
    if (u.includes("/me/share")) return json({ gridId: "g1" });
    if (u.includes("/grids")) return json({ grids: [{ id: "g1", name: "poms grid" }, { id: "g2", name: "test grid 2" }] });
    if (u.includes("/destinations")) return json({ destinations: [MOVIES] });
    if (u.includes("/fields")) return json({ fields: [
      { id: "f-year", name: "Year", type: "number" }, { id: "f-cat", name: "Board Category", type: "select" },
    ] });
    if (u.includes("/share/presets") && opts?.method === "PUT") { presetsStored = JSON.parse(opts.body).presets; return json({ presets: presetsStored }); }
    if (u.includes("/share/presets")) return json({ presets: presetsStored });
    if (u.endsWith("/share")) return json({ ran: [{ ruleName: "x", ok: true, created: [{ occurrenceId: "n1" }] }] }, 201);
    return json({});
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

const { default: SharePlace } = await import("../ui/SharePlace.jsx");

const ready = async () => { render(<SharePlace />); await screen.findByText(/Share: link/); };
const openNew = async () => {
  await ready();
  fireEvent.click(screen.getByLabelText("New"));
};
const pickMovies = async () => {
  fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
  fireEvent.click(await screen.findByText("Movies"));
};

describe("SharePlace — the window and Auto", () => {
  it("reads the staged clip with the key from the URL", async () => {
    await ready();
    expect(calls.some((c) => c.url.includes("/share/stage/s1?k=k1"))).toBe(true);
  });

  it("shows what is being clipped", async () => {
    await ready();
    expect(screen.getByText(STAGED.title)).toBeTruthy();
  });

  it("defaults the grid to the user's share grid", async () => {
    await ready();
    await waitFor(() => expect(screen.getByLabelText("Grid").value).toBe("g1"));
  });

  it("NAMES the rule Auto would run, and where it files things", async () => {
    await ready();
    expect(screen.getByTestId("auto-rule").textContent).toMatch(/Share: link.*Bookmarks/);
  });

  it("re-asks which rule would run when the grid changes", async () => {
    await ready();
    const before = calls.filter((c) => c.url.includes("/preview")).length;
    fireEvent.change(screen.getByLabelText("Grid"), { target: { value: "g2" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("/preview") && c.url.includes("gridId=g2"))).toBe(true));
    expect(calls.filter((c) => c.url.includes("/preview")).length).toBeGreaterThan(before);
  });

  it("writes NOTHING before Clip is pressed", async () => {
    await ready();
    expect(posts()).toHaveLength(0);
  });

  it("posts an auto share — the stage, the grid, no placement, no content", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body)).toEqual({ mode: "auto", stageId: "s1", stageKey: "k1", gridId: "g1" });
  });

  it("reads grids and fields with the session token", async () => {
    await ready();
    const gridsCall = calls.find((c) => c.url.endsWith("/grids"));
    expect(gridsCall.opts.headers.authorization).toBe("Bearer session-jwt");
  });

  it("says so when the stage is gone instead of rendering an empty form", async () => {
    stageStatus = 404;
    render(<SharePlace />);
    expect(await screen.findByText(/expired|already placed/i)).toBeTruthy();
  });

  it("SIGNED OUT: Auto still works and names the rule; New asks you to sign in", async () => {
    localStorage.removeItem("moduli-token");
    await ready();
    expect(calls.some((c) => c.url.endsWith("/grids"))).toBe(false);
    expect(calls.find((c) => c.url.includes("/preview")).url).not.toMatch(/gridId=/);
    expect(screen.getByLabelText("New").disabled).toBe(true);
    expect(screen.getByText(/to place it by hand/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body)).toEqual({ mode: "auto", stageId: "s1", stageKey: "k1" });
  });
});

describe("SharePlace — New", () => {
  it("searches destinations as you type, and shows the crumb", async () => {
    await openNew();
    fireEvent.change(screen.getByPlaceholderText(/search containers/i), { target: { value: "mov" } });
    await waitFor(() => expect(calls.some((c) => c.url.includes("/destinations") && c.url.includes("q=mov"))).toBe(true));
    expect(await screen.findByText(/Boards › Media/)).toBeTruthy();
  });

  it("adopts the destination's shape, and SAYS what it adopted", async () => {
    await openNew(); await pickMovies();
    expect(screen.getByTestId("shape").textContent).toMatch(/like its 993 rows — artifact\/movie/);
  });

  it("pre-fills the value the rows agree on, marked (auto)", async () => {
    await openNew(); await pickMovies();
    expect(screen.getByText(/\(auto\)/)).toBeTruthy();
    expect(screen.getByLabelText("value for Board Category").value).toBe("movie");
  });

  it("lists EVERY field the destination's rows bind, not only the pre-filled one", async () => {
    await openNew(); await pickMovies();
    expect(screen.getByLabelText("value for Year").value).toBe("");
    expect(screen.getByLabelText("value for Board Category").value).toBe("movie");
    // Only the filled row claims to be auto.
    expect(screen.getAllByText(/\(auto\)/)).toHaveLength(1);
  });

  it("a destination row you typed into stays when the destination changes; the rest go", async () => {
    await openNew(); await pickMovies();
    fireEvent.change(screen.getByLabelText("value for Year"), { target: { value: "1999" } });
    fireEvent.click(screen.getByText("change"));
    expect(screen.getByLabelText("value for Year").value).toBe("1999");
    expect(screen.queryByLabelText("value for Board Category")).toBeNull();
  });

  it("Clip is refused with no destination chosen", async () => {
    await openNew();
    expect(screen.getByRole("button", { name: /^clip$/i }).disabled).toBe(true);
  });

  it("shows the value each mapping will write, and posts the resolved values", async () => {
    await openNew(); await pickMovies();
    fireEvent.click(screen.getByText(/\+ field/));
    fireEvent.change(await screen.findByTestId("field-select"), { target: { value: "f-year" } });
    fireEvent.change(screen.getByLabelText("source for Year"), { target: { value: "title" } });
    fireEvent.change(screen.getByLabelText("transform for Year"), { target: { value: "year" } });
    expect(screen.getByLabelText("value for Year").value).toBe("2006");
    expect(screen.getByLabelText("value for Label").value).toBe("A Guide to Recognizing Your Saints (2006)");
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    const body = JSON.parse(sharePost().opts.body);
    expect(body.mode).toBe("manual");
    expect(body.placement).toMatchObject({
      parentId: "o-movies", role: "artifact", kind: "movie", bindingsLike: "m-movie",
      label: "A Guide to Recognizing Your Saints (2006)",
      fields: { "f-year": "2006", "f-cat": ["movie"] },
    });
  });

  it("an edited value is what gets posted", async () => {
    await openNew(); await pickMovies();
    fireEvent.change(screen.getByLabelText("value for Label"), { target: { value: "Saints" } });
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body).placement.label).toBe("Saints");
  });

  it("'make it a bookmark' drops the rows' shape and their implied values", async () => {
    await openNew(); await pickMovies();
    fireEvent.change(screen.getByLabelText("make it a"), { target: { value: "bookmark" } });
    expect(screen.queryByText(/\(auto\)/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    const p = JSON.parse(sharePost().opts.body).placement;
    expect(p).toMatchObject({ role: "artifact", kind: "bookmark", fileRef: STAGED.url });
    expect(p.bindingsLike).toBeUndefined();
  });
});

describe("SharePlace — Cover", () => {
  it("suggests the page's own picture for a media row, and posts it", async () => {
    await openNew(); await pickMovies();
    const row = await screen.findByTestId("cover-row");
    await waitFor(() => expect(row.querySelector("img")?.getAttribute("src")).toBe("https://img/og.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body).placement.cover).toBe("https://img/og.jpg");
  });

  it("Change… opens the image search for the title + kind, and the pick is what gets posted", async () => {
    await openNew(); await pickMovies();
    await waitFor(() => expect(screen.getByTestId("cover-row").querySelector("img")).toBeTruthy());
    fireEvent.click(screen.getByText("Change…"));
    const picker = await screen.findByTestId("image-picker");
    expect(picker.getAttribute("data-query")).toBe("A Guide to Recognizing Your Saints (2006) IMDb movie poster");
    fireEvent.click(screen.getByText("pick-it"));
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body).placement.cover).toBe("https://img/picked.jpg");
  });

  it("Clear posts no cover, and the suggestion does not come back", async () => {
    await openNew(); await pickMovies();
    await waitFor(() => expect(screen.getByTestId("cover-row").querySelector("img")).toBeTruthy());
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByTestId("cover-row").querySelector("img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^clip$/i }));
    await waitFor(() => expect(sharePost()).toBeTruthy());
    expect(JSON.parse(sharePost().opts.body).placement.cover).toBeUndefined();
  });

  it("an image clip gets no cover row — its picture is the file", async () => {
    await openNew(); await pickMovies();
    fireEvent.change(screen.getByLabelText("make it a"), { target: { value: "image" } });
    expect(screen.queryByTestId("cover-row")).toBeNull();
  });
});

describe("SharePlace — Presets", () => {
  it("picking a preset fills the form, still editable", async () => {
    await ready();
    fireEvent.click(screen.getByLabelText("Preset"));
    await waitFor(() => expect(screen.getByLabelText("Preset", { selector: "select" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Preset", { selector: "select" }), { target: { value: "p1" } });
    expect(screen.getByLabelText("value for Year").value).toBe("2006");
    expect(screen.getByRole("button", { name: /^clip$/i }).disabled).toBe(false);
  });

  it("Save as preset writes the presets list alone, and not the edited value", async () => {
    await openNew(); await pickMovies();
    fireEvent.change(screen.getByLabelText("value for Label"), { target: { value: "one movie's title" } });
    vi.spyOn(window, "prompt").mockReturnValue("Film");
    fireEvent.click(screen.getByText(/Save as preset/));
    await waitFor(() => expect(calls.some((c) => c.opts?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.opts?.method === "PUT");
    expect(put.url).toMatch(/\/share\/presets$/);
    const body = JSON.parse(put.opts.body);
    expect(Object.keys(body).sort()).toEqual(["gridId", "presets"]);
    const film = body.presets.find((p) => p.name === "Film");
    expect(film).toMatchObject({ destinationId: "o-movies", kind: "movie" });
    expect(film.labelMapping.override).toBeUndefined();
    expect(sharePost()).toBeUndefined();
  });
});
