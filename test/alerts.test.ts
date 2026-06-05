import { test } from "node:test";
import assert from "node:assert/strict";
import { withinAlertWindow } from "../src/lib/server/alerts.ts";

const MIN = 60_000;
const now = 1_700_000_000_000;

test("withinAlertWindow: a just-happened swap is alertable", () => {
  assert.equal(withinAlertWindow(now - 2 * MIN, now), true);
});

test("withinAlertWindow: a day-old swap is suppressed (channel stays realtime)", () => {
  assert.equal(withinAlertWindow(now - 25 * 60 * MIN, now), false);
});

test("withinAlertWindow: unknown time is not suppressed", () => {
  assert.equal(withinAlertWindow(undefined, now), true);
});

test("withinAlertWindow: honors ALERT_MAX_AGE_MIN override", () => {
  const prev = process.env.ALERT_MAX_AGE_MIN;
  process.env.ALERT_MAX_AGE_MIN = "5";
  try {
    assert.equal(withinAlertWindow(now - 4 * MIN, now), true);
    assert.equal(withinAlertWindow(now - 6 * MIN, now), false);
  } finally {
    if (prev === undefined) delete process.env.ALERT_MAX_AGE_MIN;
    else process.env.ALERT_MAX_AGE_MIN = prev;
  }
});
