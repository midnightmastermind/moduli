/**
 * userInputWindow.test.js
 *
 * The defect, measured on prod 2026-09-18 with [mint] diagnostics — ONE click:
 *
 *     t=11.1  mint:go              <- block 1
 *     t=28.9  mint:check-scheduled <- the mint's OWN transaction
 *     t=46.2  mint:go              <- block 2, same click
 *
 * The window only asked "was there a gesture", never "has it already produced a
 * block", so minting walked down a run of empty lines.
 */
import { describe, test, expect, beforeEach } from "vitest";
import {
  stampUserInput, userInputRecently, consumeUserInput, __resetUserInputWindow,
} from "../helpers/userInputWindow";

beforeEach(() => __resetUserInputWindow());

describe("userInputWindow", () => {
  test("a gesture opens the window", () => {
    stampUserInput(1000);
    expect(userInputRecently(1000)).toBe(true);
    expect(userInputRecently(1999)).toBe(true);
  });

  test("the window closes on its own", () => {
    stampUserInput(1000);
    expect(userInputRecently(2000)).toBe(false);
  });

  // With no gesture at all — a page load, a server echo's setContent — there is
  // nothing to mint from, and 0 must not read as "just now" at t≈0.
  test("no gesture is never recent", () => {
    expect(userInputRecently(0)).toBe(false);
    expect(userInputRecently(500)).toBe(false);
  });

  // THE FIX. The follow-on check the mint's own transaction schedules arrives
  // ~17ms later — comfortably inside the window — and must be refused.
  test("a consumed gesture cannot mint again 17ms later", () => {
    stampUserInput(1000);
    expect(userInputRecently(1011)).toBe(true);
    consumeUserInput();
    expect(userInputRecently(1028)).toBe(false);
  });

  // THE CONTROL: consuming must not disable minting — the NEXT real click works.
  // Without this, "one block per click" is also satisfied by never minting.
  test("the next gesture opens the window again", () => {
    stampUserInput(1000);
    consumeUserInput();
    expect(userInputRecently(1050)).toBe(false);
    stampUserInput(1100);                       // the user clicks another line
    expect(userInputRecently(1110)).toBe(true);
  });
});
