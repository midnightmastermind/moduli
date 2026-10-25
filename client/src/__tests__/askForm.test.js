// "Ask with a form": one window, several answers, bound at $form.values / $form.fields.
import { describe, it, expect, afterEach, vi } from "vitest";
import { executePipeline } from "../helpers/operationExecutor.js";
import { operationsBridge } from "../state/bindSocketToStore.js";

const fieldsById = { f1: { id: "f1", name: "Rating", type: "number" } };
const form = (items) => ({ id: "form", type: "action", config: { type: "ASK_FORM", title: "New movie", submitLabel: "Add", items } });
const show = (id, value) => ({ id, type: "action", config: { type: "SHOW_VALUE", name: "$m_" + id, value } });
const op = (steps) => ({ id: "op", name: "op", enabled: true, pipeline: { steps } });
const host = { id: "o1", moduleId: "m1", fields: { f1: { value: 4 } } };

function run(operation, answer) {
  const requests = [];
  operationsBridge.requestUserInput = (req) => { requests.push(req); return answer === "CANCEL" ? Promise.reject(new Error("cancel")) : Promise.resolve(answer); };
  operationsBridge.applyEffect = () => {};
  return new Promise((resolve) => {
    executePipeline(operation, {
      state: { grid: { _id: "g" }, modules: [], occurrences: [host] },
      fieldsById, occurrencesById: { o1: host }, operationsById: {},
      _onPipelineDone: (all) => resolve({ requests, shown: all.filter((u) => String(u?.name || "").startsWith("$m_")).map((u) => u.value) }),
    }, { type: "ButtonOp", occurrenceId: "o1", instanceId: "m1" });
  });
}

afterEach(() => { operationsBridge.requestUserInput = null; operationsBridge.applyEffect = null; });

describe("ASK_FORM", () => {
  const items = [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "rating", label: "Rating", fieldId: "f1", default: "$trigger.occurrence.fields.f1.value" },
  ];

  it("asks once with every item, defaults resolved and the field attached", async () => {
    const { requests } = await run(op([form(items)]), { name: "Dune", rating: 7 });
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.form).toBe(true);
    expect(req.title).toBe("New movie");
    expect(req.submitLabel).toBe("Add");
    expect(req.items.map((i) => i.key)).toEqual(["name", "rating"]);
    expect(req.items[1].default).toBe(4);
    expect(req.items[1].field).toEqual(fieldsById.f1);
  });

  it("binds the answers at $form: values by key, fields by field id", async () => {
    const { shown } = await run(op([form(items), show("a", "$form.fields.f1"), show("b", "$form.values.name")]), { name: "Dune", rating: 7 });
    expect(shown).toEqual([7, "Dune"]);
  });

  it("cancel stops the operation", async () => {
    const { shown } = await run(op([form(items), show("a", "after")]), "CANCEL");
    expect(shown).toEqual([]);
  });

  it("drops an item whose field no longer exists, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { requests } = await run(op([form([...items, { key: "gone", label: "Gone", fieldId: "fMissing" }])]), { name: "x" });
    expect(requests[0].items.map((i) => i.key)).toEqual(["name", "rating"]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes("fMissing"))).toBe(true);
    warn.mockRestore();
  });
});
