// Регулярная покупка BTC ("кофе каждый день с такого-то года"): считает,
// сколько потрачено, сколько биткоина накопилось и во что это превратилось
// бы к последнему дню файла цен. Чистые функции, без файлов/сети/DOM —
// используются и страницей (src/app.js), и тестами.
//
// Производительность: человек будет двигать ползунок даты начала и ждёт
// мгновенного пересчёта на ~6000 днях истории. Пересчитывать сумму заново
// на каждое движение — плохая идея. Вместо этого buildScheduleIndex()
// один раз при загрузке данных строит префиксные суммы 1/цена:
//   - ежедневная покупка — один префиксный массив на весь диапазон;
//   - еженедельная — 7 префиксных массивов, по остатку (индекс дня % 7),
//     то есть по дню недели даты начала: начали в среду — берём "корзину"
//     для среды, где все даты уже идут с шагом 7 дней;
//   - ежемесячная — 31 префиксный массив, по числу месяца даты начала
//     (см. clampDayOfMonth ниже про короткие месяцы).
// После этого evaluate() для любой даты начала — это O(1): найти позицию
// в нужном префиксном массиве и вычесть два числа, вместо пересуммирования
// диапазона заново. Кривая результата и лучший/худший момент (curve(),
// findBestWorst()) — один проход по всем ~6000 возможным датам начала,
// на каждой O(1) операция вместо O(1) * O(n) = квадратичного перебора.

"use strict";

// Всё внутри одной функции, а не на верхнем уровне файла: страница
// подключает date-utils.js и этот файл как два обычных <script> тега без
// сборщика, а у них общая глобальная область видимости для let/const —
// без обёртки их одноимённые верхнеуровневые объявления столкнутся.
(function () {

// В Node — обычный require. В браузере (страница, без сборщика) require
// нет, а date-utils.js в этом случае уже положил себя в window.dateUtils.
const { isValidISODate, daysBetween, indexToDate } =
  typeof require !== "undefined" ? require("./date-utils.js") : window.dateUtils;

const MAX_AMOUNT = 1e9; // $1 млрд за одну покупку — с запасом отсекает мусорный/переполняющий ввод, реальные суммы кофе/подписок на порядки меньше
const PERIODICITIES = ["daily", "weekly", "monthly"];

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function daysInMonth(year, monthIndex0) {
  // monthIndex0: 0=январь. День 0 следующего месяца = последний день этого.
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

// Правило для 29/30/31 числа: если в месяце нет такого дня, покупка
// переносится на последний день этого месяца (а не пропускается и не
// съезжает на 1-е число следующего). Выбрано так, чтобы у любого выбранного
// числа месяца было ровно по одной покупке в каждом календарном месяце —
// иначе, скажем, 31-е число давало бы на 4-5 покупок меньше за 16 лет, чем
// 15-е, что незаметно исказило бы сравнение дат начала между собой.
function clampDayOfMonth(year, monthIndex0, day) {
  return Math.min(day, daysInMonth(year, monthIndex0));
}

function findExact(sortedArr, value) {
  let lo = 0;
  let hi = sortedArr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] === value) return mid;
    if (sortedArr[mid] < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function buildScheduleIndex(priceData) {
  const n = priceData.prices.length;
  const invPrices = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const price = priceData.prices[i];
    if (!isFiniteNumber(price) || price <= 0) {
      throw new Error(`Файл цен повреждён: некорректная цена на ${indexToDate(priceData.start, i)} (${price}).`);
    }
    invPrices[i] = 1 / price;
  }

  const dailyPrefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) dailyPrefix[i + 1] = dailyPrefix[i] + invPrices[i];

  const weekly = Array.from({ length: 7 }, () => ({ indices: [], prefix: [0] }));
  for (let i = 0; i < n; i++) {
    const bucket = weekly[i % 7];
    bucket.indices.push(i);
    bucket.prefix.push(bucket.prefix[bucket.prefix.length - 1] + invPrices[i]);
  }

  const monthly = Array.from({ length: 31 }, () => ({ indices: [], prefix: [0] }));
  {
    const startD = new Date(priceData.start + "T00:00:00Z");
    const endD = new Date(priceData.asOf + "T00:00:00Z");
    let y = startD.getUTCFullYear();
    let m = startD.getUTCMonth();
    const lastY = endD.getUTCFullYear();
    const lastM = endD.getUTCMonth();
    while (y < lastY || (y === lastY && m <= lastM)) {
      for (let day = 1; day <= 31; day++) {
        const actualDay = clampDayOfMonth(y, m, day);
        const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(actualDay).padStart(2, "0")}`;
        const idx = daysBetween(priceData.start, iso);
        if (idx < 0 || idx >= n) continue; // вне диапазона данных — первый/последний неполный месяц
        const bucket = monthly[day - 1];
        bucket.indices.push(idx);
        bucket.prefix.push(bucket.prefix[bucket.prefix.length - 1] + invPrices[idx]);
      }
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  }

  return { n, dailyPrefix, weekly, monthly };
}

// Возвращает {sumInv, count} для покупок с индексом >= startIdx до конца
// диапазона (конец всегда последний день файла — он не выбирается).
function sumFromStart(startIdx, periodicity, index) {
  if (periodicity === "daily") {
    return {
      sumInv: index.dailyPrefix[index.n] - index.dailyPrefix[startIdx],
      count: index.n - startIdx,
    };
  }
  if (periodicity === "weekly") {
    const r = startIdx % 7;
    const bucket = index.weekly[r];
    const pos = (startIdx - r) / 7;
    return {
      sumInv: bucket.prefix[bucket.prefix.length - 1] - bucket.prefix[pos],
      count: bucket.indices.length - pos,
    };
  }
  if (periodicity === "monthly") {
    throw new Error("monthly требует дату — используйте sumFromStartMonthly");
  }
  return null;
}

function sumFromStartMonthly(startIdx, startISO, index) {
  const day = Number(startISO.slice(8, 10));
  const bucket = index.monthly[day - 1];
  const pos = findExact(bucket.indices, startIdx);
  if (pos === -1) {
    throw new Error(`internal: месячная корзина не содержит стартовый индекс ${startIdx}`);
  }
  return {
    sumInv: bucket.prefix[bucket.prefix.length - 1] - bucket.prefix[pos],
    count: bucket.indices.length - pos,
  };
}

function computeAtIndex(startIdx, startISO, periodicity, index) {
  if (periodicity === "monthly") return sumFromStartMonthly(startIdx, startISO, index);
  return sumFromStart(startIdx, periodicity, index);
}

/**
 * @param {{amount: number, periodicity: "daily"|"weekly"|"monthly", startDate: string}} input
 * @param {{start: string, asOf: string, prices: number[]}} priceData
 * @param {ReturnType<typeof buildScheduleIndex>} scheduleIndex
 */
function evaluate(input, priceData, scheduleIndex) {
  const { amount, periodicity, startDate } = input || {};

  if (!isFiniteNumber(amount)) {
    return fail("INVALID_AMOUNT", "Сумма покупки должна быть числом.");
  }
  if (amount <= 0) {
    return fail("AMOUNT_NOT_POSITIVE", "Сумма покупки должна быть больше нуля.");
  }
  if (amount > MAX_AMOUNT) {
    return fail("AMOUNT_TOO_LARGE", `Суммы больше ${MAX_AMOUNT.toLocaleString("en-US")} долларов за покупку не поддерживаются.`);
  }
  if (!PERIODICITIES.includes(periodicity)) {
    return fail("INVALID_PERIODICITY", `Периодичность должна быть одной из: ${PERIODICITIES.join(", ")}.`);
  }
  if (!isValidISODate(startDate)) {
    return fail("INVALID_DATE", "Дата должна быть настоящей календарной датой в формате ГГГГ-ММ-ДД.");
  }
  if (!priceData || typeof priceData.start !== "string" || typeof priceData.asOf !== "string" || !Array.isArray(priceData.prices)) {
    return fail("INVALID_PRICE_DATA", "Файл с ценами BTC повреждён или не загружен.");
  }
  if (startDate < priceData.start) {
    return fail("DATE_BEFORE_HISTORY", `Данные о цене BTC начинаются с ${priceData.start}, более ранняя дата недоступна.`);
  }
  if (startDate > priceData.asOf) {
    return fail("DATE_NOT_AVAILABLE", `Данные о цене BTC есть только по ${priceData.asOf} включительно (обновляются раз в сутки).`);
  }

  const startIdx = daysBetween(priceData.start, startDate);
  const { sumInv, count } = computeAtIndex(startIdx, startDate, periodicity, scheduleIndex);
  const priceNow = priceData.prices[priceData.prices.length - 1];

  const totalSpent = amount * count;
  const btcAccumulated = amount * sumInv;
  const valueNow = btcAccumulated * priceNow;
  const profitUsd = valueNow - totalSpent;
  const profitPct = (profitUsd / totalSpent) * 100;

  return {
    ok: true,
    purchases: count,
    totalSpent,
    btcAccumulated,
    valueNow,
    profitUsd,
    profitPct,
    priceNow,
    priceNowDate: priceData.asOf, // "сейчас" в расчёте — это вчера, случай для правила приписок
  };
}

/**
 * Процент результата для каждой возможной даты начала за всю историю,
 * при заданной периодичности. Результат не зависит от суммы покупки
 * (она входит и в трату, и в стоимость BTC одним и тем же множителем
 * и сокращается в проценте) — поэтому один проход по всем ~6000 датам
 * начала строит сразу и график, и лучший/худший момент.
 */
function curve(periodicity, priceData, scheduleIndex) {
  if (!PERIODICITIES.includes(periodicity)) {
    return fail("INVALID_PERIODICITY", `Периодичность должна быть одной из: ${PERIODICITIES.join(", ")}.`);
  }
  const n = scheduleIndex.n;
  const priceNow = priceData.prices[n - 1];
  const points = new Array(n);

  for (let startIdx = 0; startIdx < n; startIdx++) {
    const startISO = indexToDate(priceData.start, startIdx);
    const { sumInv, count } = computeAtIndex(startIdx, startISO, periodicity, scheduleIndex);
    const profitPct = ((sumInv * priceNow) / count - 1) * 100;
    points[startIdx] = { startDate: startISO, profitPct };
  }

  return { ok: true, points };
}

/**
 * Лучший и худший день начала за всю историю для заданной периодичности.
 */
function findBestWorst(periodicity, priceData, scheduleIndex) {
  const c = curve(periodicity, priceData, scheduleIndex);
  if (!c.ok) return c;

  let best = null;
  let worst = null;
  for (const point of c.points) {
    if (best === null || point.profitPct > best.profitPct) best = point;
    if (worst === null || point.profitPct < worst.profitPct) worst = point;
  }

  return { ok: true, best, worst };
}

const exported = { buildScheduleIndex, evaluate, curve, findBestWorst, MAX_AMOUNT, PERIODICITIES };
if (typeof module !== "undefined" && module.exports) {
  module.exports = exported;
} else {
  window.dca = exported;
}

})();
