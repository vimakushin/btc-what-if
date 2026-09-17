"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { daysInMonth, clampDayOfMonth, yearsAgo } = require("./date-utils.js");

test("daysInMonth: обычные и короткие месяцы", () => {
  assert.equal(daysInMonth(2024, 0), 31); // январь
  assert.equal(daysInMonth(2024, 3), 30); // апрель
  assert.equal(daysInMonth(2024, 1), 29); // февраль, високосный год
  assert.equal(daysInMonth(2023, 1), 28); // февраль, невисокосный год
});

test("clampDayOfMonth: переносит только то, чего в месяце нет", () => {
  assert.equal(clampDayOfMonth(2023, 1, 31), 28); // 31 февраля не бывает
  assert.equal(clampDayOfMonth(2024, 1, 31), 29); // в високосном — до 29
  assert.equal(clampDayOfMonth(2024, 0, 15), 15); // 15 января есть всегда
});

test("yearsAgo: обычная дата просто сдвигает год", () => {
  assert.equal(yearsAgo("2026-09-15", 1), "2025-09-15");
  assert.equal(yearsAgo("2026-09-15", 10), "2016-09-15");
});

test("yearsAgo: 29 февраля N лет назад в невисокосном году переносится на 28-е", () => {
  assert.equal(yearsAgo("2024-02-29", 1), "2023-02-28");
  assert.equal(yearsAgo("2024-02-29", 4), "2020-02-29"); // 2020 тоже високосный
});
