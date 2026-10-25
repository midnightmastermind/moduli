// @vitest-environment jsdom
// The form builder: the editor of an "Ask with a form" step.
import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("../ui/FieldSelect.jsx", () => ({
  default: ({ fields, onChange, ariaLabel }) => (
    <select aria-label={ariaLabel} value="" onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  ),
}));
vi.mock("../ui/Field.jsx", () => ({ default: ({ field }) => <input aria-label={`field-${field.id}`} readOnly /> }));

import FormItemsEditor from "../blocks/FormItemsEditor.jsx";

const fieldsById = { fYear: { id: "fYear", name: "Release Year", type: "number" } };

function Harness({ onChange }) {
  const [items, setItems] = useState([]);
  return <FormItemsEditor value={items} fieldsById={fieldsById} onChange={(next) => { setItems(next); onChange(next); }} />;
}

describe("FormItemsEditor", () => {
  it("builds, edits, reorders and removes inputs", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const last = () => onChange.mock.calls.at(-1)[0];

    fireEvent.change(screen.getByLabelText("Add a field input"), { target: { value: "fYear" } });
    expect(last()).toEqual([{ key: "release_year", label: "Release Year", fieldId: "fYear" }]);

    fireEvent.click(screen.getByRole("button", { name: "+ Question" }));
    expect(last()[1]).toEqual({ key: "question", label: "Question", type: "text" });

    // Rename the question: its key follows (2026-10-25 — the old rule kept "question", and a Create step written
    // as $form.values.title, what the window calls it, read nothing; found by building one in the editor).
    fireEvent.change(screen.getAllByLabelText("Label")[1], { target: { value: "Title" } });
    expect(last()[1]).toMatchObject({ key: "title", label: "Title" });

    fireEvent.click(screen.getAllByLabelText("Required")[1]);
    expect(last()[1].required).toBe(true);

    fireEvent.change(screen.getAllByLabelText("Type")[0], { target: { value: "longtext" } });
    expect(last()[1].type).toBe("longtext");

    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    expect(last().map((i) => i.key)).toEqual(["title", "release_year"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove input" })[1]);
    expect(last().map((i) => i.key)).toEqual(["title"]);
  });

  it("Preview opens the form with every input", () => {
    const items = [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "release_year", label: "Release Year", fieldId: "fYear" },
    ];
    render(<FormItemsEditor value={items} fieldsById={fieldsById} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const dialog = screen.getByTestId("form-modal");
    expect(within(dialog).getByLabelText("Name")).toBeTruthy();
    expect(within(dialog).getByLabelText("field-fYear")).toBeTruthy();
  });

  it("a question's key follows its label, so $form.values.<name> reads what the window calls it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const last = () => onChange.mock.calls.at(-1)[0];
    fireEvent.click(screen.getByText("+ Question"));
    fireEvent.click(screen.getByText("+ Question"));
    const labels = () => screen.getAllByLabelText("Label");
    fireEvent.change(labels()[0], { target: { value: "Name" } });
    fireEvent.change(labels()[1], { target: { value: "Name" } });
    expect(last().map((i) => i.key)).toEqual(["name", "name_2"]);
    // a key set on purpose stays when the label changes
    const kept = [{ key: "custom", label: "Name", type: "text" }];
    const changes = vi.fn();
    render(<FormItemsEditor value={kept} fieldsById={{}} onChange={changes} />);
    fireEvent.change(screen.getAllByLabelText("Label").at(-1), { target: { value: "Full name" } });
    expect(changes.mock.calls.at(-1)[0][0]).toMatchObject({ key: "custom", label: "Full name" });
  });
});
