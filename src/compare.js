// Честное сравнение: "что вышло у человека" против "купил BTC на ту же
// сумму в ту же дату и не трогал". Чистые функции, без обращения к файлам,
// сети или DOM — чтобы одним и тем же кодом пользовались и страница
// (браузер получает данные о ценах через fetch), и тесты (через fs).
//
// Модуль ожидает уже разобранные числа (invested, currentValue — number,
// не строка). Разбор пользовательского ввода (запятые вместо точек,
// пробелы, локаль) — забота интерфейса, а не этого модуля: у чисел нет
// единственно верного способа парсинга строки, а у этого модуля должен
// быть один explicit контракт входа.

"use strict";

const MAX_AMOUNT = 1e12; // $1 трлн — любое разумное (и почти любое неразумное) вложение человека укладывается сильно ниже, граница нужна только чтобы отсечь мусорный ввод и переполнение

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

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

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * @param {{invested: number, date: string, currentValue: number}} input
 * @param {{start: string, asOf: string, prices: number[]}} priceData — содержимое data/btc-usd-daily.json
 */
function compare(input, priceData) {
  const { invested, date, currentValue } = input || {};

  if (!isFiniteNumber(invested)) {
    return fail("INVALID_INVESTED", "Сумма вложения должна быть числом.");
  }
  if (!isFiniteNumber(currentValue)) {
    return fail("INVALID_CURRENT_VALUE", "Текущая сумма должна быть числом.");
  }
  if (invested <= 0) {
    return fail("INVESTED_NOT_POSITIVE", "Сумма вложения должна быть больше нуля.");
  }
  if (currentValue < 0) {
    return fail("CURRENT_VALUE_NEGATIVE", "Текущая сумма не может быть отрицательной.");
  }
  if (invested > MAX_AMOUNT || currentValue > MAX_AMOUNT) {
    return fail("AMOUNT_TOO_LARGE", `Суммы больше ${MAX_AMOUNT.toLocaleString("en-US")} долларов не поддерживаются.`);
  }
  if (!isValidISODate(date)) {
    return fail("INVALID_DATE", "Дата должна быть настоящей календарной датой в формате ГГГГ-ММ-ДД.");
  }
  if (!priceData || typeof priceData.start !== "string" || typeof priceData.asOf !== "string" || !Array.isArray(priceData.prices)) {
    return fail("INVALID_PRICE_DATA", "Файл с ценами BTC повреждён или не загружен.");
  }
  if (date < priceData.start) {
    return fail("DATE_BEFORE_HISTORY", `Данные о цене BTC начинаются с ${priceData.start}, более ранняя дата недоступна.`);
  }
  if (date > priceData.asOf) {
    return fail("DATE_NOT_AVAILABLE", `Данные о цене BTC есть только по ${priceData.asOf} включительно (обновляются раз в сутки).`);
  }

  const idx = daysBetween(priceData.start, date);
  const btcPriceAtDate = priceData.prices[idx];
  const btcPriceNow = priceData.prices[priceData.prices.length - 1];

  if (!isFiniteNumber(btcPriceAtDate) || btcPriceAtDate <= 0) {
    return fail("PRICE_MISSING", `В данных нет цены BTC на ${date}.`);
  }

  const btcBought = invested / btcPriceAtDate;
  const holdValueNow = btcBought * btcPriceNow;

  const userResultUsd = currentValue - invested;
  const userResultPct = (userResultUsd / invested) * 100;

  const holdResultUsd = holdValueNow - invested;
  const holdResultPct = (holdResultUsd / invested) * 100;

  return {
    ok: true,
    btc: {
      priceAtDate: btcPriceAtDate,
      priceNow: btcPriceNow,
      priceNowDate: priceData.asOf, // цена "сейчас" на самом деле вчерашняя — случай для правила приписок
    },
    user: {
      resultUsd: userResultUsd,
      resultPct: userResultPct,
    },
    hold: {
      valueNow: holdValueNow,
      resultUsd: holdResultUsd,
      resultPct: holdResultPct,
    },
    diff: {
      // насколько удержание оказалось бы лучше/хуже результата пользователя
      usd: holdValueNow - currentValue,
      pct: holdResultPct - userResultPct,
    },
  };
}

module.exports = { compare, MAX_AMOUNT };
