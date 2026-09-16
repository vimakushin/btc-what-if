"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compare } = require("./compare.js");

const priceData = {
  start: "2010-08-17",
  asOf: "2010-08-19",
  prices: [0.07, 0.07, 0.08],
};

test("дата раньше начала истории — явная ошибка", () => {
  const r = compare({ invested: 100, date: "2010-08-16", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "DATE_BEFORE_HISTORY");
});

test("дата позже последней доступной (в т.ч. будущее/сегодня) — явная ошибка", () => {
  const r = compare({ invested: 100, date: "2010-08-20", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "DATE_NOT_AVAILABLE");
});

test("несуществующая календарная дата — явная ошибка", () => {
  const r = compare({ invested: 100, date: "2024-02-30", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_DATE");
});

test("ноль во вложении — явная ошибка", () => {
  const r = compare({ invested: 0, date: "2010-08-17", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVESTED_NOT_POSITIVE");
});

test("отрицательное вложение — явная ошибка", () => {
  const r = compare({ invested: -50, date: "2010-08-17", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVESTED_NOT_POSITIVE");
});

test("отрицательная текущая сумма — явная ошибка", () => {
  const r = compare({ invested: 100, date: "2010-08-17", currentValue: -1 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "CURRENT_VALUE_NEGATIVE");
});

test("текущая сумма 0 (потерял всё) — не ошибка, считается честно", () => {
  const r = compare({ invested: 100, date: "2010-08-17", currentValue: 0 }, priceData);
  assert.equal(r.ok, true);
  assert.equal(r.user.resultUsd, -100);
  assert.equal(r.user.resultPct, -100);
});

test("нечисловой ввод (строка) — явная ошибка", () => {
  const r = compare({ invested: "100", date: "2010-08-17", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_INVESTED");
});

test("NaN/undefined — явная ошибка, а не молчаливый NaN на выходе", () => {
  const r = compare({ invested: NaN, date: "2010-08-17", currentValue: undefined }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_INVESTED");
});

test("очень большая сумма сверх разумного предела — явная ошибка", () => {
  const r = compare({ invested: 1e13, date: "2010-08-17", currentValue: 100 }, priceData);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "AMOUNT_TOO_LARGE");
});

test("большая, но реалистичная сумма считается без искажений от округления", () => {
  const r = compare({ invested: 5_000_000, date: "2010-08-17", currentValue: 5_000_000 }, priceData);
  assert.equal(r.ok, true);
  // цена выросла с 0.07 до 0.08 (последняя точка asOf) — держание должно вырасти ровно в 8/7 раз
  assert.ok(Number.isFinite(r.hold.valueNow));
  assert.ok(Number.isFinite(r.diff.usd));
  const expectedHoldValue = 5_000_000 * (0.08 / 0.07);
  assert.ok(Math.abs(r.hold.valueNow - expectedHoldValue) < 1e-6);
});

test("прибыльный пример: держание считается верно", () => {
  const r = compare({ invested: 1000, date: "2010-08-17", currentValue: 1200 }, priceData);
  assert.equal(r.ok, true);
  assert.equal(r.user.resultUsd, 200);
  assert.equal(r.user.resultPct, 20);
  const expectedHoldValue = 1000 * (0.08 / 0.07);
  assert.ok(Math.abs(r.hold.valueNow - expectedHoldValue) < 1e-9);
});

test("испорченный файл с ценами — явная ошибка, а не падение", () => {
  const r = compare({ invested: 100, date: "2010-08-17", currentValue: 100 }, { start: "2010-08-17" });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_PRICE_DATA");
});
