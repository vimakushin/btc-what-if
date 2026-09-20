# What if I'd bought Bitcoin?

**[vimakushin.github.io/btc-what-if](https://vimakushin.github.io/btc-what-if)**

*Русская версия: [README.ru.md](README.ru.md)*

A page that tests the daydream everyone has had: "what if I'd put that money into Bitcoin instead?"

Pick a habit (coffee, cigarettes, a subscription, or your own amount) and see what it would be worth today. Then drag the start date and watch the same decision turn into +600% or -40%, depending only on the day you picked.

The point isn't the big number. It's the slider: move it a few months and the outcome flips. The result was never about being smart. It was about when you got lucky.

## How this is different

Recurring-Bitcoin-purchase calculators already exist, run by exchanges and Bitcoin services whose business depends on the answer looking good. None of them show the losing periods, because that would work against them. This one shows both outcomes honestly, because it isn't selling anything.

## Where the prices come from

Daily BTC/USD prices from [blockchain.info](https://www.blockchain.info/charts/market-price), stored in a plain JSON file next to the page. No live API calls from your browser, no tracking, no accounts. The file updates itself once a day via GitHub Actions.
