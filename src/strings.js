// Все тексты, которые видит пользователь — на русском и английском.
// Единственный файл, где хранится текст; код (index.html/src/app.js/
// src/card.js) сам текста не хранит, только ссылается на ключи отсюда.
// src/dca.js текста не хранит вообще — возвращает только коды ошибок,
// а перевод в сообщение делает app.js через strings[lang].errors.

"use strict";

(function () {
  const MONTHS_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  // Диапазоны для реплики по результату: чем хуже результат, тем мягче
  // тон, вплоть до спокойной фразы без юмора при потере почти всего.
  // Массив отсортирован по возрастанию max — берётся первый диапазон,
  // куда попадает процент. Шутки не переводятся дословно — на русском
  // и английском это разные фразы про одну и ту же мысль.
  //
  // Диапазоны max: -80 и max: -50 недостижимы на реальных данных: худший
  // результат за всю историю цен — около −12.73%. Тексты для них не
  // проверены на живом результате — это заготовка на случай более
  // сильного падения рынка в будущем, а не такой же обкатанный текст,
  // как остальные четыре диапазона. Не удалять: цены живые, диапазоны
  // понадобятся при следующем сильном обвале.
  const JOKES_RU = [
    { max: -80, text: "Такое бывает. Это число говорит о времени, а не о тебе." },
    { max: -50, text: "Тяжёлый результат. Рынок иногда именно такой." },
    { max: -20, text: "Рынок просто не подгадал под эту дату." },
    { max: 0, text: "Почти получилось. Рынку не хватило пары месяцев. Дело в календаре, а не в решении." },
    { max: 500, text: "Неплохо, и это целиком заслуга календаря, не твоя." },
    { max: Infinity, text: "Красивая цифра. Она принадлежит году, в который ты зашёл, не тебе." },
  ];
  const JOKES_EN = [
    { max: -80, text: "That's a rough one. It says more about the timing than about you." },
    { max: -50, text: "That stings. Markets do that sometimes." },
    { max: -20, text: "The market just didn't line up with this date." },
    { max: 0, text: "So close. The market needed a couple more months. Bad timing, not a bad call." },
    { max: 500, text: "Not bad. Thank the calendar, not your instincts." },
    { max: Infinity, text: "Nice number. It belongs to the year you started, not to you." },
  ];

  const strings = {
    ru: {
      months: MONTHS_RU,
      locale: "ru-RU",
      dateOrder: "dmy",
      meta: {
        title: "А если бы я купил биткоин?",
        description: "Считает, во что превратились бы твои привычные траты в биткоине, и честно показывает, что при другой дате начала это могло быть и убытком.",
      },
      header: {
        title: "А если бы я купил биткоин?",
        lead: "Выбери привычную трату и подвигай дату начала, чтобы увидеть и красивую цифру, и то, чего она стоила.",
      },
      langSwitch: "EN",
      input: {
        cardTitle: "Что откладываем в биткоин",
        customAmountLabel: "Своя сумма, $",
        customPeriodicityLabel: "Как часто",
        periodicityOptions: { daily: "каждый день", weekly: "раз в неделю", monthly: "раз в месяц" },
        periodicityShort: { daily: "в день", weekly: "в неделю", monthly: "в месяц" },
        presets: {
          coffee: { label: "Кофе", hint: "$5 в день" },
          cigarettes: { label: "Сигареты", hint: "$8 в день" },
          meals: { label: "Обеды", hint: "$12 в день" },
          subscription: { label: "Подписка", hint: "$15 в месяц" },
        },
        customFallbackLabel: "своя сумма",
      },
      slider: {
        cardTitle: "С какого дня считаем",
        ariaLabel: "Дата начала покупок",
      },
      curve: {
        ariaLabel: "Кривая результата по всем датам начала",
        caption: "Это форма кривой, а не проценты напрямую: иначе обвал последних лет спрятался бы за скачком 2010 года. Точные числа смотри у ползунка и в результате ниже.",
        best: "Лучший момент: {date} · {usd} ({pct})",
        worst: "Худший момент: {date} · {usd} ({pct})",
        // Заглушки на время до/при сбое загрузки файла цен — до этого
        // момента renderExtremes() (реальный перевод с датой и процентом)
        // ещё не отработал. Без своего ключа при неудачной загрузке
        // данных эти две строки остались бы на русском даже в ?lang=en.
        bestPlaceholder: "Лучший момент: —",
        worstPlaceholder: "Худший момент: —",
      },
      result: {
        ariaLabel: "Результат",
        spent: "Потрачено",
        becomes: "Стало бы",
        diff: "Разница",
        monthlyNote: "Выбранное число есть не в каждом месяце. В короткие месяцы покупка сдвигается на последний день месяца.",
        noFeesNote: "Расчёт строго по расписанию, без комиссий и налогов.",
        priceSourceNote: "Цена посчитана как среднее по нескольким крупным биржам, на конкретной бирже число могло быть немного другим.",
      },
      jokes: JOKES_RU,
      cardSection: {
        title: "Поделиться результатом",
        saveButton: "Сохранить картинку",
        shareButton: "Поделиться",
        downloadButton: "Скачать",
      },
      loading: {
        loading: "Загружаем историю цен…",
        error: "Не получилось загрузить историю цен. Обнови страницу.",
      },
      footer: {
        asOf: "Цены по {date} включительно, сутки считаются по UTC.",
        donate: "Сделано одним человеком, бесплатно, без рекламы и без сбора данных. Если пригодилось, вот адрес для USDT (сеть BNB Smart Chain, BEP-20): {address}",
      },
      errors: {
        INVALID_AMOUNT: "Сумма покупки должна быть числом.",
        AMOUNT_NOT_POSITIVE: "Сумма покупки должна быть больше нуля.",
        AMOUNT_TOO_LARGE: "Суммы больше {max} долларов за покупку не поддерживаются.",
        INVALID_PERIODICITY: "Периодичность должна быть одной из: раз в день, раз в неделю, раз в месяц.",
        INVALID_DATE: "Дата должна быть настоящей календарной датой в формате ГГГГ-ММ-ДД.",
        INVALID_PRICE_DATA: "Файл с ценами BTC повреждён или не загружен.",
        DATE_BEFORE_HISTORY: "Данные о цене BTC начинаются с {start}, более ранняя дата недоступна.",
        DATE_NOT_AVAILABLE: "Данные о цене BTC есть только по {asOf} включительно (обновляются раз в сутки).",
      },
      shareCard: {
        kicker: "А если бы я купил биткоин?",
        headlineLine1: "Одна и та же привычка,",
        headlineLine2: "три разные даты",
        youBadge: "ТВОЙ ВЫБОР",
        anchorLabels: { 10: "10 лет назад", 1: "год назад" },
        noFees: "Без комиссий и налогов.",
        pastGrowth: "Прошлый рост ничего не обещает будущему.",
        dataAsOf: "Цены BTC по {date}, UTC",
      },
    },
    en: {
      months: MONTHS_EN,
      locale: "en-US",
      dateOrder: "mdy",
      meta: {
        title: "What if I'd bought Bitcoin?",
        description: "Turns your everyday spending into what it would be worth in Bitcoin. Honestly shows that a different start date could just as easily mean a loss.",
      },
      header: {
        title: "What if I'd bought Bitcoin?",
        lead: "Pick a habit and drag the start date. You'll see the flashy number, and what it actually cost to get it.",
      },
      langSwitch: "RU",
      input: {
        cardTitle: "What's going into Bitcoin",
        customAmountLabel: "Your own amount, $",
        customPeriodicityLabel: "How often",
        periodicityOptions: { daily: "every day", weekly: "once a week", monthly: "once a month" },
        periodicityShort: { daily: "a day", weekly: "a week", monthly: "a month" },
        presets: {
          coffee: { label: "Coffee", hint: "$5 a day" },
          cigarettes: { label: "Cigarettes", hint: "$8 a day" },
          meals: { label: "Lunch", hint: "$12 a day" },
          subscription: { label: "Subscription", hint: "$15 a month" },
        },
        customFallbackLabel: "your own amount",
      },
      slider: {
        cardTitle: "When we're starting",
        ariaLabel: "Purchase start date",
      },
      curve: {
        ariaLabel: "Result curve across every possible start date",
        caption: "This shape isn't a direct percent scale. Otherwise, the last few years' drop would hide behind the 2010 spike. Exact numbers are at the slider and in the result below.",
        best: "Best moment: {date} · {usd} ({pct})",
        worst: "Worst moment: {date} · {usd} ({pct})",
        bestPlaceholder: "Best moment: —",
        worstPlaceholder: "Worst moment: —",
      },
      result: {
        ariaLabel: "Result",
        spent: "Spent",
        becomes: "Would be worth",
        diff: "Difference",
        monthlyNote: "Not every month has the day you picked. In short months, the purchase moves to the last day of that month.",
        noFeesNote: "Calculated strictly on schedule, no fees or taxes.",
        priceSourceNote: "Price is averaged across several major exchanges. A specific exchange could show a slightly different number.",
      },
      jokes: JOKES_EN,
      cardSection: {
        title: "Share the result",
        saveButton: "Save image",
        shareButton: "Share",
        downloadButton: "Download",
      },
      loading: {
        loading: "Loading price history…",
        error: "Couldn't load the price history. Refresh the page.",
      },
      footer: {
        asOf: "Prices through {date}, using UTC days.",
        donate: "Built by one person, free, no ads, no tracking. If it helped, here's an address for USDT (BNB Smart Chain, BEP-20): {address}",
      },
      errors: {
        INVALID_AMOUNT: "The purchase amount has to be a number.",
        AMOUNT_NOT_POSITIVE: "The purchase amount has to be more than zero.",
        AMOUNT_TOO_LARGE: "Amounts over {max} dollars per purchase aren't supported.",
        INVALID_PERIODICITY: "Frequency has to be one of: every day, once a week, once a month.",
        INVALID_DATE: "The date has to be a real calendar date in YYYY-MM-DD format.",
        INVALID_PRICE_DATA: "The BTC price file is broken or hasn't loaded.",
        DATE_BEFORE_HISTORY: "Price data starts on {start}. Nothing earlier is available.",
        DATE_NOT_AVAILABLE: "Price data only goes through {asOf} (it updates once a day).",
      },
      shareCard: {
        kicker: "What if I'd bought Bitcoin?",
        headlineLine1: "Same habit,",
        headlineLine2: "three different dates",
        youBadge: "YOUR PICK",
        anchorLabels: { 10: "10 years ago", 1: "a year ago" },
        noFees: "No fees or taxes.",
        pastGrowth: "Past growth promises nothing about the future.",
        dataAsOf: "BTC prices through {date}, UTC",
      },
    },
  };

  function pickJoke(lang, pct) {
    const list = strings[lang].jokes;
    return list.find((j) => pct <= j.max).text;
  }

  function formatTemplate(str, vars) {
    return str.replace(/\{(\w+)\}/g, (_, key) => (key in vars ? vars[key] : `{${key}}`));
  }

  const exported = { strings, pickJoke, formatTemplate };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  } else {
    window.i18n = exported;
  }
})();
