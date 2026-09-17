// Рисует картинку-карточку результата на переданном <canvas> — то, что
// человек сохраняет и кидает в чат (MVP.md, пункт 5). Не трогает DOM
// страницы и не запрашивает данные сама: числа и даты ей передаёт
// src/app.js в объекте data (см. shape ниже), сама она только рисует.
//
// Композиция: герой карточки — ряд из трёх колонок (10 лет назад / твой
// выбор / год назад), а не одна большая личная цифра. В уменьшенном виде,
// в каком карточку и увидят в лентах чатов, должно быть видно, что чисел
// три и что они разные — иначе с одного взгляда мы неотличимы от
// рекламных калькуляторов конкурентов (CONCEPT.md, «Чем мы отличаемся»).
// Личный результат остаётся заметным — средняя колонка подсвечена
// плашкой фона и меткой «твой выбор», плюс только у неё есть строка
// с суммой в долларах.
//
// Цвета читает из CSS-переменных страницы (getComputedStyle), а не
// хранит свою копию палитры — иначе цвета карточки и страницы рано или
// поздно разъехались бы при правке src/style.css.
//
// @param {HTMLCanvasElement} canvas
// @param {{
//   habitLabel: string,
//   amount: number,
//   periodicityLabel: string,
//   columns: Array<{label: string, dateLabel: string, profitPct: number, profitUsd?: number, isYou: boolean} | null>,
//   asOf: string,
// }} data

"use strict";

(function () {
  // Квадрат, а не портрет: реальное содержимое (шапка + ряд из трёх
  // колонок + разделитель) занимает по высоте около 800px — на портрете
  // 1080×1350 под ним оставалась пустая треть холста, а приписки внизу
  // выглядели прижатыми к краю. Квадрат совпадает с тем, сколько
  // содержимого есть на самом деле, вместо того чтобы растягивать его
  // искусственными отступами. Подобрано и подтверждено на реальной
  // картинке 17 сентября 2026, в полном размере и уменьшенной до 250px.
  const WIDTH = 1080;
  const HEIGHT = 1080;
  const MARGIN = 72;
  const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  // Указана здесь одной константой, чтобы при переезде на свой домен
  // поменять в одном месте. Пока пункт 8 чеклиста (публикация) не сделан —
  // адрес предсказан по имени репозитория и аккаунта GitHub автора.
  const SITE_URL = "vimakushin.github.io/btc-what-if";

  function readColors() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => style.getPropertyValue(name).trim();
    return {
      bg: read("--bg"),
      fg: read("--fg"),
      muted: read("--muted"),
      accent: read("--accent"),
      good: read("--good"),
      bad: read("--bad"),
      border: read("--border"),
    };
  }

  function colorForSign(sign, colors) {
    if (sign === "+") return colors.good;
    if (sign === "−") return colors.bad;
    return colors.fg;
  }

  // Проценты за 10 лет то и дело меняются на порядки в зависимости от
  // того, на какой день истории попадёт "10 лет назад" — заранее не
  // угадать ширину текста. Вместо фиксированного размера подбираем
  // самый крупный шрифт, который ещё влезает в колонку, а не рискуем
  // обрезкой на будущих данных (см. BACKLOG.md про измерение "на глаз").
  function fitFontSize(ctx, text, maxWidth, weight, maxSize, minSize) {
    let size = maxSize;
    while (size > minSize) {
      ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 4;
    }
    // Шаг в 4px не всегда делится ровно на (maxSize - minSize) — без этой
    // подстраховки цикл может проскочить minSize на 1-2px вниз (поймано
    // ревью: у подписи даты 30→20 разница 10 не делится на 4 без остатка).
    return Math.max(size, minSize);
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawColumn(ctx, colors, format, column, colCx, colWidth) {
    const textMaxWidth = colWidth - 24;
    const { formatMoney, formatSignedMoney, formatPct, resultSign } = format;

    if (!column) {
      ctx.fillStyle = colors.muted;
      ctx.font = `400 30px ${FONT_FAMILY}`;
      ctx.fillText("—", colCx, 620);
      return;
    }

    if (column.isYou) {
      roundedRect(ctx, colCx - colWidth / 2 + 8, 360, colWidth - 16, 400, 20);
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = colors.accent;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = column.isYou ? colors.accent : colors.muted;
    ctx.font = `${column.isYou ? 700 : 400} 28px ${FONT_FAMILY}`;
    ctx.fillText(column.isYou ? "ТВОЙ ВЫБОР" : column.label, colCx, 410);

    ctx.fillStyle = column.isYou ? colors.fg : colors.muted;
    const dateSize = fitFontSize(ctx, column.dateLabel, textMaxWidth, 400, 30, 20);
    ctx.font = `400 ${dateSize}px ${FONT_FAMILY}`;
    ctx.fillText(column.dateLabel, colCx, 452);

    const sign = resultSign(column.profitPct);
    const pctText = formatPct(column.profitPct, sign);
    const pctSize = fitFontSize(ctx, pctText, textMaxWidth, 700, 96, 44);
    ctx.fillStyle = colorForSign(sign, colors);
    ctx.font = `700 ${pctSize}px ${FONT_FAMILY}`;
    ctx.fillText(pctText, colCx, 610);

    if (column.isYou) {
      const usdText = formatSignedMoney(column.profitUsd, sign);
      const usdSize = fitFontSize(ctx, usdText, textMaxWidth, 600, 34, 22);
      ctx.font = `600 ${usdSize}px ${FONT_FAMILY}`;
      ctx.fillText(usdText, colCx, 690);
    }
  }

  function renderShareCard(canvas, data) {
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d");
    const colors = readColors();
    const format = window.appFormat;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = colors.accent;
    ctx.fillRect(0, 0, WIDTH, 12);

    ctx.textAlign = "center";
    const cx = WIDTH / 2;

    ctx.fillStyle = colors.muted;
    ctx.font = `600 30px ${FONT_FAMILY}`;
    ctx.fillText("А если бы я купил биткоин?", cx, 110);

    ctx.fillStyle = colors.fg;
    ctx.font = `700 46px ${FONT_FAMILY}`;
    ctx.fillText("Одна и та же привычка,", cx, 190);
    ctx.fillText("три разные даты", cx, 244);

    ctx.fillStyle = colors.muted;
    ctx.font = `400 32px ${FONT_FAMILY}`;
    ctx.fillText(`${data.habitLabel} · ${format.formatMoney(data.amount)} ${data.periodicityLabel}`, cx, 300);

    const columnWidth = (WIDTH - MARGIN * 2) / data.columns.length;
    data.columns.forEach((column, i) => {
      const colCx = MARGIN + columnWidth * (i + 0.5);
      drawColumn(ctx, colors, format, column, colCx, columnWidth);
    });

    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(MARGIN, 800);
    ctx.lineTo(WIDTH - MARGIN, 800);
    ctx.stroke();

    // "Без комиссий и налогов" — обязательная на карточке оговорка (в
    // отличие от переноса даты в коротких месяцах, который остаётся
    // только на странице): без неё наше число выглядело бы лучше, чем
    // оно есть на самом деле, а по MVP.md на карточку попадают именно
    // такие оговорки — те, что льстят нашей же цифре, если промолчать.
    // Две отдельные строки, а не одна через "·": объединённая строка на
    // некоторых системных шрифтах выходит за безопасное поле карточки
    // (проверено измерением ширины текста, не на глаз).
    ctx.fillStyle = colors.muted;
    ctx.font = `400 28px ${FONT_FAMILY}`;
    ctx.fillText("Без комиссий и налогов.", cx, HEIGHT - 190);
    ctx.fillText("Прошлый рост ничего не обещает будущему.", cx, HEIGHT - 150);

    ctx.font = `500 32px ${FONT_FAMILY}`;
    ctx.fillStyle = colors.accent;
    ctx.fillText(SITE_URL, cx, HEIGHT - 96);

    ctx.fillStyle = colors.muted;
    ctx.font = `400 26px ${FONT_FAMILY}`;
    ctx.fillText(`Цены BTC по ${format.formatDateRu(data.asOf)}, UTC`, cx, HEIGHT - 56);
  }

  window.renderShareCard = renderShareCard;
})();
