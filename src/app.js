// Логика страницы: ввод -> ползунок -> кривая -> результат. Никакой сети,
// кроме одного fetch за файлом цен ниже. Арифметика — вся в src/dca.js,
// здесь только чтение состояния формы и отрисовка.

"use strict";

(function () {
  const PRESETS = {
    coffee: { label: "Кофе", amount: 5, periodicity: "daily" },
    cigarettes: { label: "Сигареты", amount: 8, periodicity: "daily" },
    meals: { label: "Обеды", amount: 12, periodicity: "daily" },
    subscription: { label: "Подписка", amount: 15, periodicity: "monthly" },
  };

  const MONTH_NAMES_RU = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];

  const el = {
    presetButtons: Array.from(document.querySelectorAll(".preset")),
    customAmount: document.getElementById("custom-amount"),
    customPeriodicity: document.getElementById("custom-periodicity"),
    slider: document.getElementById("start-slider"),
    sliderDateLabel: document.getElementById("start-date-label"),
    curvePath: document.getElementById("curve-path"),
    curveZero: document.getElementById("curve-zero"),
    curveMarker: document.getElementById("curve-marker"),
    curveAxis: document.getElementById("curve-axis"),
    best: document.getElementById("best-moment"),
    worst: document.getElementById("worst-moment"),
    spent: document.getElementById("result-spent"),
    value: document.getElementById("result-value"),
    diffUsd: document.getElementById("result-diff-usd"),
    diffPct: document.getElementById("result-diff-pct"),
    monthlyNote: document.getElementById("monthly-note"),
    asOfNote: document.getElementById("as-of-note"),
    loadingNote: document.getElementById("loading-note"),
    cardButton: document.getElementById("card-button"),
    cardPreview: document.getElementById("card-preview"),
    cardDownload: document.getElementById("card-download"),
    cardShare: document.getElementById("card-share"),
  };

  const SVG_WIDTH = 1000;
  const SVG_HEIGHT = 300;

  let priceData = null;
  let scheduleIndex = null;
  let curveCache = null; // { periodicity, points, best, worst, tMin, tMax }

  const state = {
    presetKey: "coffee",
    amount: PRESETS.coffee.amount,
    periodicity: PRESETS.coffee.periodicity,
    startIdx: 0,
  };

  function formatDateRu(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTH_NAMES_RU[m - 1]} ${y}`;
  }

  function formatMoney(v) {
    return "$" + new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v));
  }

  // profitUsd и profitPct математически всегда одного знака (второе — это
  // первое, делённое на totalSpent > 0), поэтому знак для обеих строк
  // результата решаем один раз здесь, по проценту. Раньше знак решался
  // отдельно для денег и отдельно для процентов, каждый по своему порогу
  // округления — из-за этого на недавних датах (сумма в долларах ещё
  // маленькая, а в процентах уже заметная) деньги показывали "$0" без
  // знака, а рядом проценты — настоящий минус: два числа одной покупки
  // как будто про разные результаты. ZERO_EPSILON — не про округление для
  // экрана, а про то, что старт день-в-день даёт математический ноль с
  // погрешностью плавающей точки в 13-м знаке, который иначе читался бы
  // как "−0,0%".
  const ZERO_EPSILON = 1e-6;

  function resultSign(profitPct) {
    if (Math.abs(profitPct) < ZERO_EPSILON) return "";
    return profitPct < 0 ? "−" : "+";
  }

  function formatSignedMoney(v, sign) {
    return sign + formatMoney(Math.abs(v));
  }

  function formatPct(v, sign) {
    const abs = Math.abs(v);
    const digits = abs >= 100 ? 0 : 1;
    const formattedAbs = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(abs);
    return sign + formattedAbs + "%";
  }

  // Знаковая логарифмическая шкала для оси Y кривой: лучший старт даёт
  // плюс полтора миллиона процентов, а на линейной шкале это сплющило бы
  // весь график в одну точку у 2010 года и спрятало бы обвал последних
  // лет — то есть ровно то, ради чего график нужен (см. MVP.md, пункт 4).
  function scaleY(pct) {
    return Math.sign(pct) * Math.log10(1 + Math.abs(pct));
  }

  function setLoading(isLoading, isError) {
    if (isError) {
      el.loadingNote.textContent = "Не получилось загрузить историю цен. Обнови страницу.";
      el.loadingNote.hidden = false;
      return;
    }
    el.loadingNote.hidden = !isLoading;
  }

  function syncCustomInputsFromState() {
    el.customAmount.value = state.amount;
    el.customPeriodicity.value = state.periodicity;
  }

  function markActivePreset() {
    el.presetButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.preset === state.presetKey);
    });
  }

  function selectPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    state.presetKey = key;
    state.amount = preset.amount;
    state.periodicity = preset.periodicity;
    syncCustomInputsFromState();
    markActivePreset();
    ensureCurveFor(state.periodicity);
    render();
  }

  function onCustomAmountInput() {
    state.presetKey = "custom";
    state.amount = parseFloat(el.customAmount.value);
    markActivePreset();
    render();
  }

  function onCustomPeriodicityChange() {
    state.presetKey = "custom";
    state.periodicity = el.customPeriodicity.value;
    markActivePreset();
    ensureCurveFor(state.periodicity);
    render();
  }

  function onSliderInput() {
    state.startIdx = Number(el.slider.value);
    render();
  }

  function ensureCurveFor(periodicity) {
    if (curveCache && curveCache.periodicity === periodicity) return;
    const c = dca.curve(periodicity, priceData, scheduleIndex);
    const bw = dca.findBestWorst(periodicity, priceData, scheduleIndex);
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const point of c.points) {
      const t = scaleY(point.profitPct);
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
    }
    curveCache = { periodicity, points: c.points, best: bw.best, worst: bw.worst, tMin, tMax };
    drawCurvePath();
    renderExtremes();
  }

  function xForIndex(idx) {
    const n = curveCache.points.length;
    return (idx / (n - 1)) * SVG_WIDTH;
  }

  function yForPct(pct) {
    const { tMin, tMax } = curveCache;
    const t = scaleY(pct);
    if (tMax === tMin) return SVG_HEIGHT / 2;
    return SVG_HEIGHT - ((t - tMin) / (tMax - tMin)) * SVG_HEIGHT;
  }

  function drawCurvePath() {
    const points = curveCache.points;
    let d = "";
    for (let i = 0; i < points.length; i++) {
      const x = xForIndex(i);
      const y = yForPct(points[i].profitPct);
      d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }
    el.curvePath.setAttribute("d", d);
    el.curveZero.setAttribute("y1", yForPct(0).toFixed(1));
    el.curveZero.setAttribute("y2", yForPct(0).toFixed(1));
  }

  // Подписи лет под кривой — без них форма графика ничего не говорит о
  // времени, а вся мысль продукта именно в нём: чем позже начал, тем
  // меньше досталось. Ось не зависит от периодичности (у curve() всегда
  // одна точка на каждый календарный день), поэтому считается один раз
  // при загрузке данных, а не при каждой смене периодичности.
  const YEAR_STEP = 2;

  function drawYearAxis() {
    const n = priceData.prices.length;
    const startYear = Number(priceData.start.slice(0, 4));
    const endYear = Number(priceData.asOf.slice(0, 4));

    function fractionForYear(year) {
      const iso = year <= startYear ? priceData.start : `${year}-01-01`;
      const idx = Math.min(n - 1, Math.max(0, dateUtils.daysBetween(priceData.start, iso)));
      return idx / (n - 1);
    }

    const years = [];
    for (let y = startYear; y < endYear; y += YEAR_STEP) years.push(y);
    years.push(endYear);
    // если предпоследняя метка слишком близко к последней — убираем её,
    // чтобы подписи не наехали друг на друга у правого края
    if (years.length > 1 && fractionForYear(years[years.length - 2]) > 0.92) {
      years.splice(years.length - 2, 1);
    }

    el.curveAxis.textContent = "";
    years.forEach((year, i) => {
      const span = document.createElement("span");
      span.textContent = String(year);
      if (i === 0) {
        span.style.left = "0";
      } else if (i === years.length - 1) {
        span.style.right = "0";
      } else {
        span.style.left = (fractionForYear(year) * 100).toFixed(2) + "%";
        span.style.transform = "translateX(-50%)";
      }
      el.curveAxis.appendChild(span);
    });
  }

  function renderExtremes() {
    const { best, worst } = curveCache;
    el.best.textContent = `Лучший момент: ${formatDateRu(best.startDate)} — ${formatPct(best.profitPct, resultSign(best.profitPct))}`;
    el.worst.textContent = `Худший момент: ${formatDateRu(worst.startDate)} — ${formatPct(worst.profitPct, resultSign(worst.profitPct))}`;
  }

  function updateMarker() {
    const point = curveCache.points[state.startIdx];
    el.curveMarker.setAttribute("cx", xForIndex(state.startIdx).toFixed(1));
    el.curveMarker.setAttribute("cy", yForPct(point.profitPct).toFixed(1));
  }

  function updateMonthlyNote(startDate) {
    const day = Number(startDate.slice(8, 10));
    el.monthlyNote.hidden = !(state.periodicity === "monthly" && day >= 29);
  }

  function showResultError(message) {
    el.spent.textContent = "—";
    el.value.textContent = "—";
    el.diffUsd.textContent = "—";
    el.diffPct.textContent = message;
    el.diffPct.className = "result-pct";
  }

  function render() {
    const startDate = dateUtils.indexToDate(priceData.start, state.startIdx);
    el.sliderDateLabel.textContent = formatDateRu(startDate);
    updateMarker();
    updateMonthlyNote(startDate);

    const result = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate }, priceData, scheduleIndex);
    el.cardButton.disabled = !result.ok;
    if (!result.ok) {
      showResultError(result.error.message);
      return;
    }

    el.spent.textContent = formatMoney(result.totalSpent);
    el.value.textContent = formatMoney(result.valueNow);

    const sign = resultSign(result.profitPct);
    el.diffUsd.textContent = formatSignedMoney(result.profitUsd, sign);
    el.diffUsd.className = "result-money " + signClass(sign);
    el.diffPct.textContent = formatPct(result.profitPct, sign);
    el.diffPct.className = "result-pct " + signClass(sign);
  }

  function signClass(sign) {
    if (sign === "−") return "bad";
    if (sign === "+") return "good";
    return "";
  }

  function habitLabel() {
    const preset = PRESETS[state.presetKey];
    return preset ? preset.label : "своя сумма";
  }

  function periodicityLabel(periodicity) {
    return { daily: "в день", weekly: "в неделю", monthly: "в месяц" }[periodicity];
  }

  // Герой карточки — ряд из трёх колонок: 10 лет назад / твоя дата / год
  // назад. Личный результат — не отдельная огромная цифра, а средняя
  // колонка того же ряда (подсвечена отдельно в card.js), иначе с одного
  // взгляда в уменьшённом превью читается только "сколько заработал я",
  // и мы неотличимы от рекламных калькуляторов конкурентов (CONCEPT.md,
  // «Чем мы отличаемся»). Середина ряда — фиксированная позиция для
  // "твоей" колонки, а не хронологическая: так подсветка всегда там же,
  // даже если выбранная дата на самом деле раньше "10 лет назад" или
  // позже "года назад". Опорных точек теперь две, а не три (раньше была
  // ещё "5 лет назад") — она чаще всего дублировала личный результат,
  // потому что дефолтная позиция ползунка на странице — тоже 5 лет назад;
  // если выбранная дата случайно окажется рядом с одной из двух оставшихся
  // опорных точек, это не ошибка, а честное совпадение (см. card.js).
  function computeCardColumns(startDate, result) {
    function anchorColumn(years, label) {
      const anchorDate = dateUtils.yearsAgo(priceData.asOf, years);
      const r = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate: anchorDate }, priceData, scheduleIndex);
      return r.ok ? { label, dateLabel: formatDateRu(anchorDate), profitPct: r.profitPct, isYou: false } : null;
    }

    return [
      anchorColumn(10, "10 лет назад"),
      { label: "твой выбор", dateLabel: formatDateRu(startDate), profitPct: result.profitPct, profitUsd: result.profitUsd, isYou: true },
      anchorColumn(1, "год назад"),
    ];
  }

  let lastCardObjectUrl = null;

  // Картинка рисуется на canvas src/card.js по текущему состоянию —
  // те же числа, что уже на экране (evaluate() с теми же amount/
  // periodicity/startDate). Canvas не показывается сам — только превью-
  // картинка из него. Кнопка недоступна (render() ставит disabled), пока
  // текущий ввод не даёт валидного результата, поэтому evaluate() здесь
  // уже гарантированно ok.
  function generateCard() {
    const startDate = dateUtils.indexToDate(priceData.start, state.startIdx);
    const result = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate }, priceData, scheduleIndex);
    if (!result.ok) return;

    const canvas = document.createElement("canvas");
    window.renderShareCard(canvas, {
      habitLabel: habitLabel(),
      amount: state.amount,
      periodicityLabel: periodicityLabel(state.periodicity),
      columns: computeCardColumns(startDate, result),
      asOf: priceData.asOf,
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      if (lastCardObjectUrl) URL.revokeObjectURL(lastCardObjectUrl);
      const url = URL.createObjectURL(blob);
      lastCardObjectUrl = url;
      el.cardPreview.src = url;
      el.cardPreview.hidden = false;

      el.cardDownload.href = url;
      el.cardDownload.hidden = false;

      const file = new File([blob], "btc-what-if.png", { type: "image/png" });
      const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
      el.cardShare.hidden = !canShareFile;
      if (canShareFile) {
        el.cardShare.onclick = () => navigator.share({ files: [file] }).catch(() => {});
      }
    }, "image/png");
  }

  function wireEvents() {
    el.presetButtons.forEach((btn) => btn.addEventListener("click", () => selectPreset(btn.dataset.preset)));
    el.customAmount.addEventListener("input", onCustomAmountInput);
    el.customPeriodicity.addEventListener("change", onCustomPeriodicityChange);
    el.slider.addEventListener("input", onSliderInput);
    el.cardButton.addEventListener("click", generateCard);
  }

  async function init() {
    setLoading(true, false);
    let data;
    try {
      const res = await fetch("data/btc-usd-daily.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      data = await res.json();
    } catch (e) {
      setLoading(false, true);
      return;
    }
    priceData = data;
    scheduleIndex = dca.buildScheduleIndex(priceData);

    const totalDays = priceData.prices.length;
    el.slider.min = "0";
    el.slider.max = String(totalDays - 1);
    el.slider.disabled = false;

    const fiveYearsAgoIdx = totalDays - 1 - 5 * 365;
    state.startIdx = Math.max(0, fiveYearsAgoIdx);
    el.slider.value = String(state.startIdx);

    el.asOfNote.textContent = `Цены по ${formatDateRu(priceData.asOf)} включительно, сутки — по UTC.`;

    syncCustomInputsFromState();
    markActivePreset();
    wireEvents();
    drawYearAxis();
    ensureCurveFor(state.periodicity);
    render();
    setLoading(false, false);
  }

  // src/card.js рисует картинку тем же числовым форматом, что и страница —
  // без этого экспорта пришлось бы дублировать форматирование денег/
  // процентов/дат в двух файлах, и они рано или поздно разъехались бы.
  window.appFormat = { formatMoney, formatSignedMoney, formatPct, resultSign, formatDateRu };

  init();
})();
