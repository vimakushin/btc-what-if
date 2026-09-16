#!/usr/bin/env node
// Скачивает дневную цену BTC/USD с blockchain.info и сохраняет компактным
// файлом. При повторном запуске дозаливает только новые дни (плюс
// небольшое перекрытие хвоста — источник иногда уточняет последние дни).

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_PATH = path.join(__dirname, "..", "data", "btc-usd-daily.json");
const SOURCE_URL = "https://api.blockchain.info/charts/market-price";
const OVERLAP_DAYS = 10;

// Цена дня D в этом файле — цена на конец дня D по UTC (см. MVP.md,
// «Принятые решения» → «Сутки считаются по UTC»). Записывается в сам
// файл данных, чтобы это было видно и без чтения кода.
const TIMEZONE = "UTC";

function toISODate(unixSeconds) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

async function fetchRaw(startDate) {
  const url = new URL(SOURCE_URL);
  url.searchParams.set("format", "json");
  url.searchParams.set("sampled", "false");
  if (startDate) url.searchParams.set("start", startDate);
  else url.searchParams.set("timespan", "all");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`blockchain.info ответил ${res.status}`);
  const body = await res.json();
  const points = body.values.map((v) => ({ date: toISODate(v.x), price: v.y }));

  for (let i = 1; i < points.length; i++) {
    if (daysBetween(points[i - 1].date, points[i].date) !== 1) {
      throw new Error(
        `Пропуск в сырых данных источника между ${points[i - 1].date} и ${points[i].date}`
      );
    }
  }
  return points;
}

// blockchain.info помечает точку датой D, но число в ней — цена на начало
// дня D по UTC (00:00), то есть фактически цена закрытия дня D-1. Поэтому
// цену закрытия дня D по UTC берём из точки, помеченной датой D+1: её
// значение — это и есть цена в 00:00 дня D+1, она же 23:59:59... дня D.
//
// Проверено (не просто предположение): после сдвига цена на дату D по
// нашим данным сверена с ценой закрытия BTC-USD на ту же календарную
// дату D у Yahoo Finance. Совпадает с точностью до обычного расхождения
// между биржами (0.003–2.8% на проверенных датах, включая резкий обвал
// 2020-03-12 — до сдвига там было расхождение до 60%, после сдвига 2.8%).
function shiftToCloseOfDay(raw) {
  const shifted = [];
  for (let i = 0; i < raw.length - 1; i++) {
    shifted.push({ date: raw[i].date, price: raw[i + 1].price });
  }
  return shifted;
}

function loadExisting() {
  if (!fs.existsSync(DATA_PATH)) return null;
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
}

function saveRecord(record) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(record));
}

async function buildFromScratch() {
  const raw = await fetchRaw(null);
  const shifted = shiftToCloseOfDay(raw);
  const firstRealIndex = shifted.findIndex((p) => p.price > 0);
  const trimmed = shifted.slice(firstRealIndex);
  return {
    start: trimmed[0].date,
    asOf: trimmed[trimmed.length - 1].date,
    tz: TIMEZONE,
    prices: trimmed.map((p) => p.price),
  };
}

async function updateExisting(existing) {
  const fetchFrom = addDays(existing.asOf, -OVERLAP_DAYS + 1);
  const raw = await fetchRaw(fetchFrom);
  const shifted = shiftToCloseOfDay(raw);

  const prices = existing.prices.slice();
  for (const point of shifted) {
    const idx = daysBetween(existing.start, point.date);
    if (idx < 0) continue; // старше начала файла, игнорируем
    if (idx < prices.length) {
      prices[idx] = point.price; // уточнение уже известного дня
    } else if (idx === prices.length) {
      prices.push(point.price); // новый день
    } else {
      throw new Error(
        `Между текущими данными (по ${existing.asOf}) и новыми (${point.date}) образовался разрыв`
      );
    }
  }

  return {
    start: existing.start,
    asOf: addDays(existing.start, prices.length - 1),
    tz: TIMEZONE,
    prices,
  };
}

async function main() {
  const existing = loadExisting();
  const record = existing ? await updateExisting(existing) : await buildFromScratch();
  saveRecord(record);

  console.log(`Данные сохранены: ${DATA_PATH}`);
  console.log(`Диапазон: ${record.start} .. ${record.asOf}`);
  console.log(`Всего дней: ${record.prices.length}`);
}

main().catch((err) => {
  console.error("Ошибка обновления цен BTC:", err.message);
  process.exit(1);
});
