// Общие функции для работы с датами, которыми пользуются и src/dca.js,
// и (раньше) src/compare.js. Все даты — календарные дни по UTC, без времени.

"use strict";

function isValidISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = Date.parse(s + "T00:00:00Z");
  if (Number.isNaN(ms)) return false;
  // отсекаем несуществующие даты вроде 2024-02-30, которые Date.parse иногда прощает
  return new Date(ms).toISOString().slice(0, 10) === s;
}

function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

function indexToDate(startISO, offsetDays) {
  const d = new Date(startISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

module.exports = { isValidISODate, daysBetween, indexToDate };
