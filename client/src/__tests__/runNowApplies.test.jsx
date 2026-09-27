// "Run now" APPLIES what the pipeline produced.
//
// It computed every effect and dropped them: `runPipelineForLog` returns the
// effects and the panel's handler ignored the return value, while the button's
// own tooltip reads "Run pipeline now and append to history". Measured on
// 2026-09-27, that left SIX operations with no working invoke path — including
// `Project: Create` and `Import from Wikipedia` on poms grid, both authored with
// no trigger on purpose.
//
// `applyManualOpUpdates` is the applier the instance trigger widget and the
// `button` field have used since 2026-09-21 for this same defect. This was the
// third hand-run surface, missed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";

const applyManualOpUpdates = vi.fn(() => ({ display: 0, effects: 1 }));
let RESULTS = [];

vi.mock("../helpers/manualOpRun", () => ({
  applyManualOpUpdates: (...a) => applyManualOpUpdates(...a),
}));
vi.mock("../helpers/operationExecutor", () => ({
  runPipelineForLog: () => RESULTS,
  getOpRunHistory: () => [],
  subscribeToOpLog: () => () => {},
}));
vi.mock("../GridActionsContext", () => ({
  useGridActions: () => ({
    state: {}, dispatch: vi.fn(),
    fieldsById: { f1: { id: "f1", name: "Daily Coffee" } },
    occurrencesById: { o1: { id: "o1", label: "Coffee" } },
    modulesById: {}, operationsById: {},
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn() } }));

const { default: OperationLogPanel } = await import("../ui/commandCenter/OperationLogPanel.jsx");

const OP = { id: "op1", name: "Coffee", pipeline: { steps: [] } };
const runNow = () => fireEvent.click(screen.getByTitle("Run pipeline now and append to history"));

describe("Run now", () => {
  let confirmSpy;
  beforeEach(() => {
    applyManualOpUpdates.mockClear();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => confirmSpy.mockRestore());

  it("applies the effects the pipeline produced", () => {
    RESULTS = [{ _effect: "UPDATE_ITEM_FIELD", itemId: "o1", fieldId: "f1", value: 20 }];
    render(<OperationLogPanel operation={OP} />);
    runNow();
    expect(applyManualOpUpdates).toHaveBeenCalledTimes(1);
    expect(applyManualOpUpdates.mock.calls[0][0]).toEqual(RESULTS);
  });

  it("asks before applying a run that WRITES", () => {
    RESULTS = [{ _effect: "CREATE_ITEM", instanceId: "new1" }];
    render(<OperationLogPanel operation={OP} />);
    runNow();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The prompt names what the run did, so "Apply?" is answerable.
    expect(String(confirmSpy.mock.calls[0][0])).toMatch(/Apply this run/i);
  });

  it("applies NOTHING when the confirm is declined", () => {
    RESULTS = [{ _effect: "DELETE_ITEM", itemId: "o1" }];
    confirmSpy.mockReturnValue(false);
    render(<OperationLogPanel operation={OP} />);
    runNow();
    expect(applyManualOpUpdates).not.toHaveBeenCalled();
  });

  it("does NOT ask for a display-only run — a tracker showing a number writes nothing", () => {
    // The split is derived from the run's own output: an entry carrying `_effect`
    // is a write, one without is a computed display value.
    RESULTS = [{ fieldId: "f1", occurrenceId: "o1", value: 20 }];
    render(<OperationLogPanel operation={OP} />);
    runNow();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(applyManualOpUpdates).toHaveBeenCalledTimes(1);
  });

  it("treats a _suspend sentinel as not-a-write", () => {
    // GET_USER_INPUT / CALL_API return a continuation sentinel, not an effect —
    // the socket path skips it the same way.
    RESULTS = [{ _effect: "GET_USER_INPUT", _suspend: true }];
    render(<OperationLogPanel operation={OP} />);
    runNow();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("control: still records the run in the history panel", () => {
    RESULTS = [];
    render(<OperationLogPanel operation={OP} />);
    expect(screen.getByText(/Run history/)).toBeTruthy();
    runNow();
    expect(applyManualOpUpdates).toHaveBeenCalledTimes(1);
  });
});
