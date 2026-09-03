// test setup
import "@testing-library/jest-dom";
import { installWebStorage } from "./webStorage.js";

// Node 25 owns `globalThis.localStorage` and, without a valid
// `--localstorage-file`, hands back an empty object — so `localStorage.clear`
// is not a function and 31 tests across 42 files died on their first
// `beforeEach`. Guarded: nothing is installed when the environment already
// provides a working Storage. See ./webStorage.js.
installWebStorage();
