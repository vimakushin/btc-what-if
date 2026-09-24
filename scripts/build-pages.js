#!/usr/bin/env node
// Собирает обе языковые страницы (index.html — русская, en/index.html —
// английская) из шаблона src/page.template.html и текстов src/strings.js.
// Метка {{a.b.c}} в шаблоне заменяется строкой strings[lang].a.b.c.
// Страницы лежат в репозитории готовыми (GitHub Pages отдаёт только
// закоммиченное), но руками их не правят: правят шаблон или strings.js
// и запускают этот скрипт. Он же идёт в ежедневное задание с ценами, так
// что случайное расхождение само выправится.

"use strict";

const fs = require("fs");
const path = require("path");
const { strings } = require("../src/strings.js");

const ROOT = path.join(__dirname, "..");
const SITE = "https://vimakushin.github.io/btc-what-if/";
const URL_RU = SITE;
const URL_EN = SITE + "en/";

const PAGES = [
  { lang: "ru", out: "index.html", base: "", url: URL_RU, switchHref: "en/" },
  { lang: "en", out: "en/index.html", base: "../", url: URL_EN, switchHref: "../?lang=ru" },
];

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function build(template, page) {
  const values = { lang: page.lang, base: page.base, url: page.url, urlRu: URL_RU, urlEn: URL_EN, switchHref: page.switchHref };
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    const value = key in values ? values[key] : key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), strings[page.lang]);
    if (typeof value !== "string") throw new Error(`Нет строки для {{${key}}} (${page.lang})`);
    return escapeHtml(value);
  });
}

const template = fs.readFileSync(path.join(ROOT, "src", "page.template.html"), "utf8").replace(/\r\n/g, "\n");
for (const page of PAGES) {
  const outPath = path.join(ROOT, page.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, build(template, page));
  console.log("Собрано: " + page.out);
}
