"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildScheduleIndex, evaluate, curve, findBestWorst } = require("./dca.js");

// Небольшой синтетический диапазон: 2010-08-17 .. 2010-12-31 (137 дней),
// с ценой 0.07 первые дни (реальные ранние цены) и намеренно резким ростом
// в конце, чтобы было видно, что арифметика на больших количествах BTC
// не ломается.
function buildFakePriceData() {
  const start = "2010-08-17";
  const days = 137; // до 2010-12-31 включительно
  const prices = [];
  for (let i = 0; i < days; i++) {
    prices.push(i < 100 ? 0.07 : 0.07 + (i - 99) * 0.05); // растёт после 100-го дня
  }
  const { indexToDate } = require("./date-utils.js");
  const asOf = indexToDate(start, days - 1);
  return { start, asOf, tz: "UTC", prices };
}

const priceData = buildFakePriceData();
const index = buildScheduleIndex(priceData);

test("дата раньше начала истории — явная ошибка", () => {
  const r = evaluate({ amount: 5, periodicity: "daily", startDate: "2010-08-16" }, priceData, index);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "DATE_BEFORE_HISTORY");
});

test("дата позже последней доступной — явная ошибка", () => {
  const r = evaluate({ amount: 5, periodicity: "daily", startDate: "2011-01-01" }, priceData, index);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "DATE_NOT_AVAILABLE");
});

test("ноль/отрицательная сумма — явная ошибка", () => {
  assert.equal(evaluate({ amount: 0, periodicity: "daily", startDate: priceData.start }, priceData, index).error.code, "AMOUNT_NOT_POSITIVE");
  assert.equal(evaluate({ amount: -5, periodicity: "daily", startDate: priceData.start }, priceData, index).error.code, "AMOUNT_NOT_POSITIVE");
});

test("нечисловая сумма — явная ошибка", () => {
  const r = evaluate({ amount: "5", periodicity: "daily", startDate: priceData.start }, priceData, index);
  assert.equal(r.error.code, "INVALID_AMOUNT");
});

test("слишком большая сумма — явная ошибка", () => {
  const r = evaluate({ amount: 1e10, periodicity: "daily", startDate: priceData.start }, priceData, index);
  assert.equal(r.error.code, "AMOUNT_TOO_LARGE");
});

test("неверная периодичность — явная ошибка", () => {
  const r = evaluate({ amount: 5, periodicity: "yearly", startDate: priceData.start }, priceData, index);
  assert.equal(r.error.code, "INVALID_PERIODICITY");
});

test("ежедневная покупка: количество и сумма трат совпадают с числом дней", () => {
  const r = evaluate({ amount: 5, periodicity: "daily", startDate: priceData.start }, priceData, index);
  assert.equal(r.ok, true);
  assert.equal(r.purchases, priceData.prices.length);
  assert.equal(r.totalSpent, 5 * priceData.prices.length);
});

test("еженедельная покупка отсчитывается от дня недели даты начала", () => {
  // 2010-08-17 — вторник. Покупки должны быть на индексах 0,7,14,...
  const r = evaluate({ amount: 10, periodicity: "weekly", startDate: "2010-08-17" }, priceData, index);
  assert.equal(r.ok, true);
  const expectedCount = Math.ceil(priceData.prices.length / 7);
  assert.equal(r.purchases, expectedCount);
});

test("месячная покупка 31 числа переносится на последний день короткого месяца", () => {
  // старт 2010-08-31 (последний день августа) — далее должно быть
  // 2010-09-30 (в сентябре нет 31-го), 2010-10-31, 2010-11-30, 2010-12-31
  const r31 = evaluate({ amount: 1, periodicity: "monthly", startDate: "2010-08-31" }, priceData, index);
  assert.equal(r31.ok, true);
  assert.equal(r31.purchases, 5); // авг, сен, окт, ноя, дек

  // проверяем это же руками через индексы: сумма 1/price на датах
  // 08-31, 09-30, 10-31, 11-30, 12-31
  const { daysBetween } = require("./date-utils.js");
  const dates = ["2010-08-31", "2010-09-30", "2010-10-31", "2010-11-30", "2010-12-31"];
  let expectedSumInv = 0;
  for (const d of dates) expectedSumInv += 1 / priceData.prices[daysBetween(priceData.start, d)];
  assert.ok(Math.abs(r31.btcAccumulated - expectedSumInv) < 1e-9);
});

test("месячная покупка 1 числа — по одной покупке в каждый месяц, без переносов", () => {
  const r1 = evaluate({ amount: 1, periodicity: "monthly", startDate: "2010-09-01" }, priceData, index);
  assert.equal(r1.ok, true);
  assert.equal(r1.purchases, 4); // сен, окт, ноя, дек
});

test("огромное количество BTC на ранних дешёвых ценах — конечное число, не Infinity/NaN", () => {
  const r = evaluate({ amount: 1000, periodicity: "daily", startDate: priceData.start }, priceData, index);
  assert.equal(r.ok, true);
  assert.ok(Number.isFinite(r.btcAccumulated));
  assert.ok(Number.isFinite(r.valueNow));
  assert.ok(Number.isFinite(r.profitPct));
  assert.ok(r.btcAccumulated > 100000); // цена 0.07 => по 1000/0.07 ≈ 14286 BTC в день первые 100 дней
});

test("findBestWorst: лучший момент не хуже худшего, оба реальные даты из диапазона", () => {
  const r = findBestWorst("daily", priceData, index);
  assert.equal(r.ok, true);
  assert.ok(r.best.profitPct >= r.worst.profitPct);
  assert.ok(r.best.startDate >= priceData.start && r.best.startDate <= priceData.asOf);
  assert.ok(r.worst.startDate >= priceData.start && r.worst.startDate <= priceData.asOf);
});

test("findBestWorst с неверной периодичностью — явная ошибка", () => {
  const r = findBestWorst("yearly", priceData, index);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_PERIODICITY");
});

test("curve: одна точка на каждый день истории, значения совпадают с evaluate()", () => {
  const r = curve("daily", priceData, index);
  assert.equal(r.ok, true);
  assert.equal(r.points.length, priceData.prices.length);
  assert.equal(r.points[0].startDate, priceData.start);
  assert.equal(r.points[r.points.length - 1].startDate, priceData.asOf);

  // Сверяем несколько точек кривой с независимым вызовом evaluate() —
  // curve() не должна быть отдельной, потенциально разъехавшейся копией
  // той же арифметики.
  for (const idx of [0, 10, 50, priceData.prices.length - 1]) {
    const point = r.points[idx];
    const e = evaluate({ amount: 1, periodicity: "daily", startDate: point.startDate }, priceData, index);
    assert.ok(Math.abs(point.profitPct - e.profitPct) < 1e-9);
  }
});

test("curve и findBestWorst согласованы: экстремумы кривой совпадают с best/worst", () => {
  const c = curve("weekly", priceData, index);
  const bw = findBestWorst("weekly", priceData, index);
  const maxPct = Math.max(...c.points.map((p) => p.profitPct));
  const minPct = Math.min(...c.points.map((p) => p.profitPct));
  assert.equal(bw.best.profitPct, maxPct);
  assert.equal(bw.worst.profitPct, minPct);
});

test("curve с неверной периодичностью — явная ошибка", () => {
  const r = curve("yearly", priceData, index);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "INVALID_PERIODICITY");
});

test("дата начала равна последнему дню файла — результат ровно 0%", () => {
  const r = evaluate({ amount: 5, periodicity: "daily", startDate: priceData.asOf }, priceData, index);
  assert.equal(r.ok, true);
  assert.equal(r.purchases, 1);
  assert.ok(Math.abs(r.profitPct) < 1e-9);
});

test("buildScheduleIndex бросает понятную ошибку с датой при нулевой/отрицательной/NaN цене в файле", () => {
  const zero = { start: "2010-08-17", asOf: "2010-08-19", tz: "UTC", prices: [0.07, 0, 0.08] };
  assert.throws(() => buildScheduleIndex(zero), /2010-08-18/);

  const negative = { start: "2010-08-17", asOf: "2010-08-19", tz: "UTC", prices: [0.07, 0.07, -1] };
  assert.throws(() => buildScheduleIndex(negative), /2010-08-19/);

  const notANumber = { start: "2010-08-17", asOf: "2010-08-19", tz: "UTC", prices: [NaN, 0.07, 0.08] };
  assert.throws(() => buildScheduleIndex(notANumber), /2010-08-17/);
});

// Отдельный синтетический диапазон для проверки переноса даты именно
// в феврале — единственном месяце, где может не быть даже 29/30 числа.
function buildFebPriceData(start, days) {
  const prices = [];
  for (let i = 0; i < days; i++) prices.push(0.1 + i * 0.001);
  const { indexToDate } = require("./date-utils.js");
  const asOf = indexToDate(start, days - 1);
  return { start, asOf, tz: "UTC", prices };
}

test("месячная покупка 31 числа переносится на 28 февраля в невисокосном году", () => {
  const febData = buildFebPriceData("2011-01-31", 100); // 2011 — невисокосный
  const febIndex = buildScheduleIndex(febData);
  const r = evaluate({ amount: 1, periodicity: "monthly", startDate: "2011-01-31" }, febData, febIndex);
  assert.equal(r.ok, true);
  assert.equal(r.purchases, 4); // янв, фев (28), мар, апр

  const { daysBetween } = require("./date-utils.js");
  const dates = ["2011-01-31", "2011-02-28", "2011-03-31", "2011-04-30"];
  let expectedSumInv = 0;
  for (const d of dates) expectedSumInv += 1 / febData.prices[daysBetween(febData.start, d)];
  assert.ok(Math.abs(r.btcAccumulated - expectedSumInv) < 1e-9);
});

test("месячная покупка 31 числа переносится на 29 февраля в високосном году", () => {
  const febData = buildFebPriceData("2012-01-31", 100); // 2012 — високосный
  const febIndex = buildScheduleIndex(febData);
  const r = evaluate({ amount: 1, periodicity: "monthly", startDate: "2012-01-31" }, febData, febIndex);
  assert.equal(r.ok, true);
  assert.equal(r.purchases, 4); // янв, фев (29), мар, апр

  const { daysBetween } = require("./date-utils.js");
  const dates = ["2012-01-31", "2012-02-29", "2012-03-31", "2012-04-30"];
  let expectedSumInv = 0;
  for (const d of dates) expectedSumInv += 1 / febData.prices[daysBetween(febData.start, d)];
  assert.ok(Math.abs(r.btcAccumulated - expectedSumInv) < 1e-9);
});
