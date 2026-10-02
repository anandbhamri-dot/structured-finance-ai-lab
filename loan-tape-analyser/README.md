# Loan Tape Analyser

*Tape cracking, calculated fields and stratifications for securitised loan pools.*

**[Open the live dashboard](https://anandbhamri-dot.github.io/structured-finance-ai-lab/loan-tape-analyser/)**

A browser dashboard for the first pass on a loan tape: load it, standardise its fields, add calculated fields, filter the pool, define aggregate measures and build the stratification tables you need. It runs entirely in the browser, so the tape is never uploaded anywhere. A Python version for scripted runs is included.

## Workflow

1. **Load tape:** Excel (.xlsx / .xls) or CSV, one loan per row. Excel formulas are read as their calculated values, so calculated columns can be built either in Excel or in step 3.
2. **Map fields:** columns are matched automatically to standard capitalised field names (`Current Principal Balance` → `PRIN_BAL`, `Original Loan Amount` → `ORIG_BAL`, `Credit Score` → `FICO`, ...). Any mapping can be changed; unmatched columns are kept as custom fields. Each field is profiled (populated %, distinct values, range), and percent fields supplied as decimals are converted.
3. **Calculated fields:** add new columns or edit existing ones with Excel-style formulas, evaluated loan by loan:

   | Use | Example |
   |---|---|
   | New column | `CUR_LTV = ROUND(DIVIDE(PRIN_BAL, PROP_VALUE) * 100, 2)` |
   | Clean an existing column | `FICO = IF(FICO = 0, BLANK(), FICO)` |
   | Fix keyed errors | `NOTE_RATE = IF(NOTE_RATE > 20, NOTE_RATE / 10, NOTE_RATE)` |
   | Flags and bands | `PERF_FLAG = IF(DQ_STATUS = "Current", "Performing", "Delinquent")` |
   | Map codes | `OCCUPANCY = SWITCH(OCCUPANCY, "O", "Owner", "I", "Investor", "S", "Second Home", OCCUPANCY)` |
   | Dates | `AGE_AT_CUTOFF = MONTHS_BETWEEN(ORIG_DATE, DATE(2026, 9, 1))` |

   | Compare to the pool | `PRIN_BAL2 = IF(AVG(PRIN_BAL) > PRIN_BAL, PRIN_BAL, ORIG_BAL)` |
   | Share of group | `STATE_SHARE_PCT = ROUND(PRIN_BAL / GROUP_SUM(PRIN_BAL, STATE) * 100, 4)` |
   | Outlier flag | `TOP1_FLAG = IF(PRIN_BAL >= PERCENTILE(PRIN_BAL, 0.99), "Top 1%", "Other")` |

   Operators `+ − * / ^ &` and comparisons; 54 functions across logic (IF, AND, OR, IN, SWITCH, COALESCE, ISBLANK), maths (ROUND, ROUNDUP, ROUNDDOWN, DIVIDE, MOD, ...), text (UPPER, TRIM, LEFT, MID, SUBSTITUTE, CONTAINS, ...), dates (DATE, YEAR, EDATE, MONTHS_BETWEEN, DAYS, ...) and aggregates. Formulas are parsed by the tool's own engine, not run as code.

   **Aggregates inside loan-level formulas:** SUM, AVG, MIN, MAX, MEDIAN and COUNT given a single field name work on the whole column, as an Excel column reference would; with several values they work loan by loan (`MAX(FICO - 600, 0)`). WAVG(field, weight) and PERCENTILE(field, k) are column-level. GROUP_SUM, GROUP_AVG, GROUP_COUNT, GROUP_MIN, GROUP_MAX and GROUP_WAVG return the figure for each loan's own group (e.g. its STATE). Aggregates use every loan in the tape as it stands at that step, before the pool filter.

   Steps run in order, so later steps can use earlier results. Each step shows how many rows it filled, changed or could not calculate, and a preview lists changed and error rows first. Original values are kept: switch a step off or delete it and the column reverts. The processed tape can be downloaded with all calculated fields.
4. **Pool filter (optional):** restrict the pool before anything is calculated, using any number of conditions combined with AND or OR:

   | Field type | Operators |
   |---|---|
   | Numeric | ≥, >, ≤, <, =, ≠, between, is blank, is not blank |
   | Category / ID | is any of, is none of (picked from the values in the tape, with counts), contains, is blank, is not blank |
   | Date | on or after, on or before, between, is blank, is not blank |

   For example: `DQ_STATUS is any of Current AND FICO ≥ 700 AND OCCUPANCY is none of Investor`. Measures, strats and "% of pool" figures all use the filtered pool. The filter is shown on every export, and the pool or excluded loans can be downloaded for tie-out.
5. **Measures:** aggregate calculations used as strat columns:

   | Operator | Example |
   |---|---|
   | `SUM` | Sum of PRIN_BAL |
   | `AVG` | Average ORIG_BAL |
   | `COUNT` / `COUNT_DISTINCT` | Count of LOAN_ID |
   | `WA` | WA LTV weighted by PRIN_BAL (optionally excluding zeros, e.g. for FICO) |
   | `MIN` / `MAX` / `MEDIAN` | Min FICO, Max LTV |
   | `PCT` | % of pool balance, or % of loan count for ID and category fields |
   | `RATIO` | Measure ÷ measure, e.g. Pool Factor = SUM PRIN_BAL ÷ SUM ORIG_BAL |

   Each measure has its own number, currency or percent format.
6. **Strats:** group by any field using distinct values (with top-N and "Other"), numeric breakpoints (with a Suggest button), or year for dates. Choose and order the columns, sort by bucket or by any column, and add Missing and Total rows. A standard 17-strat pack is built automatically from the fields present.
7. **Results:** pool summary and every strat on screen, exported to a formatted Excel workbook (summary, one sheet per strat, field mapping) or CSV.

## Picking up where you left off

- **Your setup is saved automatically** in the browser after every change (mappings, calculated fields, filter, measures, strats). Reopen the page and it is restored, with a banner showing what came back and a "Start a fresh setup" button. Upload the tape and carry on.
- **Remember the tape (optional, off by default):** tick the box in step 1 and the tape is also kept in the browser's IndexedDB storage, so reopening the page restores everything with no uploads. "Clear saved tape" or unticking the box removes it. The loan data stays on that computer until cleared, so use this only on your own machine.

## Templates: reuse a setup on every new tape

A template saves the whole setup: manual field mappings, calculated fields, the pool filter, measures and strats. It holds no loan data. Set up one tape, save a template, and load it on the next tape to rebuild everything in one step, whether the template is loaded before or after the tape.

- **Save in this browser:** templates are kept by name in the browser's local storage and listed at the top of the page with Load, Download and Delete. They stay on that computer and browser only.
- **Download as file / Load from file:** a JSON file for backup, version control or sharing with colleagues.
- **Field mappings:** any column you map by hand (for example an originator's "Sched Bal" to `PRIN_BAL`, or a column set to Ignore) is saved, so repeat tapes from the same source map themselves completely. "Reset all mappings to automatic" clears them.
- If the new tape lacks a field the template needs, the affected steps are flagged rather than failing, and everything else still runs.

## Standard fields

`LOAN_ID, PRIN_BAL, ORIG_BAL, NOTE_RATE, ORIG_RATE, ORIG_TERM, REM_TERM, LOAN_AGE, ORIG_DATE, FIRST_PAY_DATE, MATURITY_DATE, FICO, LTV, CLTV, CUR_LTV, DTI, PROP_VALUE, STATE, ZIP, PROP_TYPE, OCCUPANCY, PURPOSE, DOC_TYPE, LIEN_POS, AMORT_TYPE, IO_FLAG, MARGIN, NUM_UNITS, DQ_STATUS, SERVICER, ORIGINATOR`

The full dictionary (types, descriptions and recognised alternative names) is in the dashboard, and in the downloadable Excel template.

## Sample data

- **Load sample tape** in the dashboard creates a 2,000-loan tape with originator-style headers and decimal LTVs and rates, to show automatic mapping and conversion.
- `sample_data/sample_loan_tape.xlsx` is a 2,501-loan tape in standard field names, with `LOAN_AGE` and `CUR_LTV` as live Excel formulas and 12 planted data errors.

## Python version

`tape_analyser.py` reads the same standard field names from .xlsx or .csv and writes data quality checks, stratifications and replines to Excel. With `--ai` it sends the aggregated tables (never loan-level data) to Claude for a draft collateral commentary.

```bash
pip install -r requirements.txt
python generate_sample_tape.py
python tape_analyser.py sample_data/sample_loan_tape.xlsx
python tape_analyser.py sample_data/sample_loan_tape.xlsx --ai   # needs ANTHROPIC_API_KEY
```

All sample data is synthetic.

---
Built by Anand Bhamri, with Claude as a coding partner.
