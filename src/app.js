// Логика страницы: ввод -> ползунок -> кривая -> результат. Никакой сети,
// кроме одного fetch за файлом цен ниже. Арифметика — вся в src/dca.js,
// текст — весь в src/strings.js, здесь только чтение состояния формы,
// перевод чисел/дат под текущий язык и отрисовка.

"use strict";

(function () {
  // Язык страницы определяется параметром в адресе, а не выбором в JS —
  // это даёт обычные шареable ссылки без сервера и без сборки под два
  // разных HTML-файла: ?lang=en или ?lang=ru фиксируют версию явно, ссылка
  // с таким параметром работает одинаково для любого читателя. Без
  // параметра решает язык браузера: раздача в основном идёт на Reddit,
  // то есть на англоязычную аудиторию, поэтому русский показываем только
  // тем, у кого браузер русский, всем остальным — английский по умолчанию.
  function currentLang() {
    const param = new URLSearchParams(location.search).get("lang");
    if (param === "en" || param === "ru") return param;
    return (navigator.language || "").toLowerCase().startsWith("ru") ? "ru" : "en";
  }
  const lang = currentLang();
  const STR = window.i18n.strings[lang];

  const PRESETS = {
    coffee: { amount: 5, periodicity: "daily" },
    cigarettes: { amount: 8, periodicity: "daily" },
    meals: { amount: 12, periodicity: "daily" },
    subscription: { amount: 15, periodicity: "monthly" },
  };

  // Единственное место в коде, где записан адрес доната — обе языковые
  // строки footer.donate собираются подстановкой в шаблон отсюда, а не
  // хранят свою копию адреса, чтобы его не пришлось сверять на совпадение
  // в нескольких местах.
  const DONATE_ADDRESS = "0xf65e04f7b5761b6bdc42726a54ee467736d0ca74";
  const DONATE_NETWORK = "BNB Smart Chain (BEP-20)";

  const el = {
    langSwitch: document.getElementById("lang-switch"),
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
    joke: document.getElementById("result-joke"),
    monthlyNote: document.getElementById("monthly-note"),
    asOfNote: document.getElementById("as-of-note"),
    donateNote: document.getElementById("donate-note"),
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

  function formatDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const month = STR.months[m - 1];
    return STR.dateOrder === "mdy" ? `${month} ${d}, ${y}` : `${d} ${month} ${y}`;
  }

  function formatMoney(v) {
    return "$" + new Intl.NumberFormat(STR.locale, { maximumFractionDigits: 0 }).format(Math.round(v));
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
    const formattedAbs = new Intl.NumberFormat(STR.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(abs);
    return sign + formattedAbs + "%";
  }

  // Знаковая логарифмическая шкала для оси Y кривой: лучший старт даёт
  // плюс полтора миллиона процентов, а на линейной шкале это сплющило бы
  // весь график в одну точку у 2010 года и спрятало бы обвал последних
  // лет — то есть ровно то, ради чего график нужен.
  function scaleY(pct) {
    return Math.sign(pct) * Math.log10(1 + Math.abs(pct));
  }

  function lookupPath(obj, path) {
    return path.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
  }

  // Ссылка переключателя всегда ставит параметр явно (а не снимает его),
  // даже когда текущий язык определился по умолчанию, а не по параметру.
  // Снятие параметра раньше означало "показать русский", потому что без
  // параметра всегда была русская версия — теперь без параметра язык
  // зависит от браузера, и для англоязычного браузера снятый параметр
  // снова дал бы английский: кнопка выглядела бы рабочей, но не меняла
  // бы язык — так уже было, к снятию параметра лучше не возвращаться.
  function otherLangUrl() {
    const url = new URL(location.href);
    url.searchParams.set("lang", lang === "en" ? "ru" : "en");
    return url.toString();
  }

  // Один проход по разметке при загрузке — переводит всё, что размечено
  // data-i18n* в index.html. Структура страницы одна на оба языка, меняется
  // только это. Динамический текст (числа, даты, реплики по результату)
  // сюда не входит — он собирается отдельно в render()/renderExtremes().
  function applyStaticStrings() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const value = lookupPath(STR, node.getAttribute("data-i18n"));
      if (value !== undefined) node.textContent = value;
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
      const value = lookupPath(STR, node.getAttribute("data-i18n-aria"));
      if (value !== undefined) node.setAttribute("aria-label", value);
    });
    document.querySelectorAll("[data-i18n-content]").forEach((node) => {
      const value = lookupPath(STR, node.getAttribute("data-i18n-content"));
      if (value !== undefined) node.setAttribute("content", value);
    });
    document.querySelectorAll("[data-i18n-alt]").forEach((node) => {
      const value = lookupPath(STR, node.getAttribute("data-i18n-alt"));
      if (value !== undefined) node.setAttribute("alt", value);
    });
    el.langSwitch.textContent = STR.langSwitch;
    el.langSwitch.href = otherLangUrl();
  }

  function setLoading(isLoading, isError) {
    if (isError) {
      el.loadingNote.textContent = STR.loading.error;
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
    // Не здесь: renderExtremes() зависит и от суммы (нужна для доллара в
    // строке), а не только от периодичности — переключение пресета с той
    // же периодичностью (кофе → сигареты, оба "в день") не пересчитало бы
    // сумму, если бы вызов остался тут. Вызывается из render() на каждое
    // изменение состояния, где сумма уже известна валидной.
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
  // при загрузке данных, а не при каждой смене периодичности. Год —
  // просто число, переводить нечего, на обоих языках выглядит одинаково.
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

    // Первая и последняя подписи не попадают на ровный шаг YEAR_STEP:
    // история начинается 17 августа, а не 1 января, а сегодняшняя дата —
    // почти никогда 1 января, поэтому зазор до их соседей иногда выходит
    // меньше обычного шага (пример — 2010 и 2012 при истории с 2010-08-17).
    // Раньше это лечилось отдельной проверкой только у правого края (порог
    // 0.92) — здесь то же правило, но общее и по факту отрисованных
    // прямоугольников, а не по заранее угаданному проценту: так оно
    // одинаково работает у обоих краёв и на любой ширине экрана. Первую и
    // последнюю подпись не трогаем никогда, остальные выбрасываем, если
    // налезают на последнюю оставленную.
    const spans = Array.from(el.curveAxis.children);
    if (spans.length > 2) {
      const MIN_GAP_PX = 4;
      let lastKeptRect = spans[0].getBoundingClientRect();
      for (let i = 1; i < spans.length - 1; i++) {
        const rect = spans[i].getBoundingClientRect();
        if (rect.left < lastKeptRect.right + MIN_GAP_PX) {
          spans[i].remove();
        } else {
          lastKeptRect = rect;
        }
      }
      const last = spans[spans.length - 1];
      if (last.getBoundingClientRect().left < lastKeptRect.right + MIN_GAP_PX) {
        const kept = Array.from(el.curveAxis.children).filter((s) => s !== last);
        if (kept.length) kept[kept.length - 1].remove();
      }
    }
  }

  // Деньги в строке лучшего/худшего момента, не только процент: на лучшей
  // дате истории (2010-08-17) процент — то самое число, которое
  // перестаёт что-либо значить. Без суммы в долларах строка спорила бы
  // с остальной страницей, где деньги идут первой строкой, а процент —
  // вторичным уточнением.
  function extremeLine(template, point) {
    const sign = resultSign(point.profitPct);
    const r = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate: point.startDate }, priceData, scheduleIndex);
    return window.i18n.formatTemplate(template, {
      date: formatDate(point.startDate),
      pct: formatPct(point.profitPct, sign),
      // Пока текущая сумма невалидна (evaluate() для неё же и упал бы в
      // главном результате), — прочерк, а не "—" для всей строки: без
      // этого рядом с сообщением об ошибке ввода зависла бы сумма,
      // посчитанная по прошлой, уже невидимой сумме — так уже было,
      // прочерк здесь намеренно.
      usd: r.ok ? formatSignedMoney(r.profitUsd, sign) : "—",
    });
  }

  function renderExtremes() {
    const { best, worst } = curveCache;
    el.best.textContent = extremeLine(STR.curve.best, best);
    el.worst.textContent = extremeLine(STR.curve.worst, worst);
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

  // dca.js возвращает только код ошибки — арифметика не хранит текст ни
  // на каком языке. Перевод в сообщение и подстановка чисел/дат — здесь.
  function errorMessage(error) {
    const template = STR.errors[error.code];
    return window.i18n.formatTemplate(template, {
      max: dca.MAX_AMOUNT.toLocaleString(STR.locale),
      start: priceData ? priceData.start : "",
      asOf: priceData ? priceData.asOf : "",
    });
  }

  function showResultError(message) {
    el.spent.textContent = "—";
    el.value.textContent = "—";
    el.diffUsd.textContent = "—";
    el.diffPct.textContent = message;
    el.diffPct.className = "result-pct";
    el.joke.textContent = "";
  }

  function render() {
    const startDate = dateUtils.indexToDate(priceData.start, state.startIdx);
    el.sliderDateLabel.textContent = formatDate(startDate);
    updateMarker();
    updateMonthlyNote(startDate);
    // Не зависит от валидности текущего ввода — extremeLine() считает
    // свой собственный evaluate() на датах экстремумов и сама решает,
    // показывать сумму или прочерк, если сумма сейчас невалидна.
    renderExtremes();

    const result = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate }, priceData, scheduleIndex);
    el.cardButton.disabled = !result.ok;
    if (!result.ok) {
      showResultError(errorMessage(result.error));
      return;
    }

    el.spent.textContent = formatMoney(result.totalSpent);
    el.value.textContent = formatMoney(result.valueNow);

    const sign = resultSign(result.profitPct);
    el.diffUsd.textContent = formatSignedMoney(result.profitUsd, sign);
    el.diffUsd.className = "result-money " + signClass(sign);
    el.diffPct.textContent = formatPct(result.profitPct, sign);
    el.diffPct.className = "result-pct " + signClass(sign);
    el.joke.textContent = window.i18n.pickJoke(lang, result.profitPct);
  }

  function signClass(sign) {
    if (sign === "−") return "bad";
    if (sign === "+") return "good";
    return "";
  }

  function habitLabel() {
    const preset = STR.input.presets[state.presetKey];
    return preset ? preset.label : STR.input.customFallbackLabel;
  }

  function periodicityLabel(periodicity) {
    return STR.input.periodicityShort[periodicity];
  }

  // Герой карточки — ряд из трёх колонок: 10 лет назад / твоя дата / год
  // назад. Личный результат — не отдельная огромная цифра, а средняя
  // колонка того же ряда (подсвечена отдельно в card.js), иначе с одного
  // взгляда в уменьшённом превью читается только "сколько заработал я",
  // а не сравнение с другими датами, ради которого вся карточка и
  // задумана. Середина ряда — фиксированная позиция для
  // "твоей" колонки, а не хронологическая: так подсветка всегда там же,
  // даже если выбранная дата на самом деле раньше "10 лет назад" или
  // позже "года назад". Опорных точек теперь две, а не три (раньше была
  // ещё "5 лет назад") — она чаще всего дублировала личный результат,
  // потому что дефолтная позиция ползунка на странице — тоже 5 лет назад;
  // если выбранная дата случайно окажется рядом с одной из двух оставшихся
  // опорных точек, это не ошибка, а честное совпадение (см. card.js).
  function computeCardColumns(startDate, result) {
    function anchorColumn(years) {
      const anchorDate = dateUtils.yearsAgo(priceData.asOf, years);
      const r = dca.evaluate({ amount: state.amount, periodicity: state.periodicity, startDate: anchorDate }, priceData, scheduleIndex);
      return r.ok ? { label: STR.shareCard.anchorLabels[years], dateLabel: formatDate(anchorDate), profitPct: r.profitPct, isYou: false } : null;
    }

    return [
      anchorColumn(10),
      { dateLabel: formatDate(startDate), profitPct: result.profitPct, profitUsd: result.profitUsd, isYou: true },
      anchorColumn(1),
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
      lang,
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
    applyStaticStrings();
    // Не зависит от цен, поэтому не ждёт fetch: показывается, даже если
    // загрузка истории цен не удалась.
    el.donateNote.textContent = window.i18n.formatTemplate(STR.footer.donate, { network: DONATE_NETWORK, address: DONATE_ADDRESS });
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

    el.asOfNote.textContent = window.i18n.formatTemplate(STR.footer.asOf, { date: formatDate(priceData.asOf) });

    syncCustomInputsFromState();
    markActivePreset();
    wireEvents();
    drawYearAxis();
    ensureCurveFor(state.periodicity);
    render();
    setLoading(false, false);
  }

  // src/card.js рисует картинку тем же числовым форматом и тем же языком,
  // что и страница — без этого экспорта пришлось бы дублировать
  // форматирование и текст в двух файлах, и они рано или поздно разъехались бы.
  window.appFormat = { formatMoney, formatSignedMoney, formatPct, resultSign, formatDate };

  init();
})();
