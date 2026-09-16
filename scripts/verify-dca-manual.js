// Разовый скрипт для ручной проверки src/dca.js. Не часть продукта —
// наивная реализация "в лоб" (без префиксных сумм), чтобы независимо
// перепроверить оптимизированный код на реальных данных. Использовался
// один раз при разработке пункта 2 нового MVP, можно удалить.
"use strict";

const fs = require("fs");
const { buildScheduleIndex, evaluate } = require("../src/dca.js");

const priceData = JSON.parse(fs.readFileSync(require("path").join(__dirname, "..", "data", "btc-usd-daily.json"), "utf8"));
const index = buildScheduleIndex(priceData);

function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
function daysInMonth(y, m0) {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

// Наивный расчёт: буквально идём по датам покупки одну за другой.
function naive(amount, periodicity, startDate, priceData) {
  const dates = [];
  if (periodicity === "daily") {
    for (let d = startDate; d <= priceData.asOf; d = addDays(d, 1)) dates.push(d);
  } else if (periodicity === "weekly") {
    for (let d = startDate; d <= priceData.asOf; d = addDays(d, 7)) dates.push(d);
  } else if (periodicity === "monthly") {
    const startD = new Date(startDate + "T00:00:00Z");
    const targetDay = startD.getUTCDate();
    let y = startD.getUTCFullYear();
    let m = startD.getUTCMonth();
    while (true) {
      const actualDay = Math.min(targetDay, daysInMonth(y, m));
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(actualDay).padStart(2, "0")}`;
      if (iso > priceData.asOf) break;
      if (iso >= startDate) dates.push(iso);
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }
  let btc = 0;
  for (const d of dates) {
    const idx = daysBetween(priceData.start, d);
    btc += amount / priceData.prices[idx];
  }
  const priceNow = priceData.prices[priceData.prices.length - 1];
  const totalSpent = amount * dates.length;
  const valueNow = btc * priceNow;
  const profitUsd = valueNow - totalSpent;
  const profitPct = (profitUsd / totalSpent) * 100;
  return { purchases: dates.length, totalSpent, btcAccumulated: btc, valueNow, profitUsd, profitPct };
}

const cases = [
  { name: "1. Старт 2013", amount: 50, periodicity: "monthly", startDate: "2013-01-01" },
  { name: "2. Пик ноября 2021", amount: 100, periodicity: "monthly", startDate: "2021-11-10" },
  { name: "3. Год назад, ежемесячно", amount: 40, periodicity: "monthly", startDate: "2025-09-16" },
  { name: "4. Дневная, последние 15 дней", amount: 5, periodicity: "daily", startDate: "2026-09-01" },
  { name: "5. Недельная, с июня 2026", amount: 20, periodicity: "weekly", startDate: "2026-06-01" },
];

for (const c of cases) {
  const fast = evaluate(c, priceData, index);
  const slow = naive(c.amount, c.periodicity, c.startDate, priceData);
  console.log("===", c.name, "===");
  console.log("код (префиксные суммы):", JSON.stringify(fast, null, 2));
  console.log("наивный перебор:       ", JSON.stringify(slow, null, 2));
  console.log("расхождение purchases:", fast.purchases - slow.purchases);
  console.log("расхождение btc:", fast.btcAccumulated - slow.btcAccumulated);
  console.log("расхождение profitPct:", fast.profitPct - slow.profitPct);
  console.log();
}
