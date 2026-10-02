# Structured Finance AI Lab

**[Open the live portfolio](https://anandbhamri-dot.github.io/structured-finance-ai-lab/)**

Working tools for securitized products analytics, built by **Anand Bhamri** using Claude (Anthropic) as a modelling and coding partner. They draw on 16 years across CLO, ABS, RMBS and CMBS: deal modelling, tape cracking, surveillance and compliance reporting.

| Project | What it does | Stack |
|---|---|---|
| [RMBS Waterfall & Stress Lab](rmbs-waterfall-lab/) | Monthly cash flow waterfall with excess spread, OC, stepdown and loss trigger across three stress scenarios | HTML / JavaScript |
| [Loan Tape Analyser](loan-tape-analyser/) | Excel/CSV tape upload, standard field mapping, Excel-style calculated fields, pool filter, custom measures (SUM, AVG, COUNT, WA, PCT, RATIO) and strat builder with Excel export; Python version adds data quality checks and a Claude-drafted commentary | JavaScript; Python, pandas, Claude API |

## How I use Claude

I describe the deal mechanics — waterfall priority, trigger definitions, test formulas — the way I would to a new analyst, and use Claude to turn them into working code quickly. I then check the output against my own expectations and hand calculations, tighten edge cases, and iterate. The domain logic and the validation are mine; Claude shortens the distance from spec to working tool.

All data in this repository is synthetic.
