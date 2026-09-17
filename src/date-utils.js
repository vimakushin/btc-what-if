// Общие функции для работы с датами, которыми пользуется src/dca.js.
// Все даты — календарные дни по UTC, без времени.

"use strict";

// Всё внутри одной функции, а не на верхнем уровне файла: страница
// подключает этот файл и src/dca.js как два обычных <script> тега без
// сборщика, а у них общая глобальная область видимости для let/const —
// без обёртки их одноимённые верхнеуровневые объявления столкнутся
// (ровно это и произошло при первой попытке, поймано ручным прогоном
// в браузероподобном окружении).
(function () {
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

  function daysInMonth(year, monthIndex0) {
    // monthIndex0: 0=январь. День 0 следующего месяца = последний день этого.
    return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  }

  // Если в целевом месяце нет такого дня — берём последний день месяца,
  // а не даём JS-у самому "переполниться" на следующий месяц (так по
  // умолчанию ведёт себя Date при setUTCFullYear/setUTCMonth на 31/30/29
  // числе, если в целевом месяце столько дней нет). Используется и для
  // переноса даты месячной покупки, и для yearsAgo() — оба случая, где
  // дата сдвигается на календарный период, а не на количество дней.
  function clampDayOfMonth(year, monthIndex0, day) {
    return Math.min(day, daysInMonth(year, monthIndex0));
  }

  // Дата N лет назад той же календарной датой. 29 февраля N лет назад,
  // если целевой год невисокосный, даёт 28 февраля — тем же способом,
  // что и перенос даты для месячной покупки в dca.js.
  function yearsAgo(iso, years) {
    const [y, m, d] = iso.split("-").map(Number);
    const targetYear = y - years;
    const day = clampDayOfMonth(targetYear, m - 1, d);
    return `${targetYear}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // В Node (тесты, скрипты) — обычный require/module.exports. В браузере
  // require нет, поэтому те же функции кладём в window, чтобы src/dca.js
  // и src/app.js могли взять их оттуда.
  const exported = { isValidISODate, daysBetween, indexToDate, daysInMonth, clampDayOfMonth, yearsAgo };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  } else {
    window.dateUtils = exported;
  }
})();
