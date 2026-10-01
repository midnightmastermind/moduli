// test setup
import "@testing-library/jest-dom";
import { installWebStorage } from "./webStorage.js";

// Node 25 owns `globalThis.localStorage` and, without a valid
// `--localstorage-file`, hands back an empty object — so `localStorage.clear`
// is not a function and 31 tests across 42 files died on their first
// `beforeEach`. Guarded: nothing is installed when the environment already
// provides a working Storage. See ./webStorage.js.
installWebStorage();

// Each op's run log keeps references into the world it ran over; with a fresh
// grid fixture per case that retained whole grids across tests and drove the
// fixture-heavy files into GC thrash / OOM. See clearOpRunHistory.
import { afterEach } from "vitest";
// Reached through a global hook, never an import — see clearOpRunHistory.
afterEach(() => globalThis.__moduliClearOpRunHistory?.());
