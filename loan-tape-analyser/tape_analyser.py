"""Loan Tape Analyser (Python version): data quality checks, stratifications and replines for a
residential mortgage tape, written to a formatted Excel workbook.

Optional: --ai sends the *aggregated* stratification tables (never loan-level
data) to Claude, which drafts a collateral commentary for the pool.

Uses the same standard field names as the browser dashboard (LOAN_ID, PRIN_BAL, ORIG_BAL,
NOTE_RATE, FICO, LTV, ...). Reads .csv or .xlsx.

Usage:
    python tape_analyser.py sample_data/sample_loan_tape.xlsx
    python tape_analyser.py sample_data/sample_loan_tape.csv --ai     # needs ANTHROPIC_API_KEY
"""
import argparse
import os
from pathlib import Path

import numpy as np
import pandas as pd

# Standard field names (shared with the browser dashboard, index.html) -> internal names
STANDARD_FIELDS = {
    "LOAN_ID": "loan_id", "STATE": "state", "FICO": "fico", "LTV": "orig_ltv", "CLTV": "orig_cltv", "DTI": "dti",
    "ORIG_BAL": "orig_balance", "PRIN_BAL": "current_balance", "NOTE_RATE": "note_rate", "ORIG_TERM": "orig_term",
    "REM_TERM": "remaining_term", "LOAN_AGE": "loan_age", "OCCUPANCY": "occupancy", "PURPOSE": "purpose",
    "PROP_TYPE": "property_type", "DOC_TYPE": "doc_type", "DQ_STATUS": "delinquency_status",
}

REQUIRED = ["loan_id", "state", "fico", "orig_ltv", "orig_cltv", "dti", "orig_balance",
            "current_balance", "note_rate", "orig_term", "remaining_term", "loan_age",
            "occupancy", "purpose", "property_type", "doc_type", "delinquency_status"]

STRAT_BUCKETS = {
    "fico": ([0, 1, 620, 660, 700, 740, 780, 851], ["Missing", "<620", "620-659", "660-699", "700-739", "740-779", "780+"]),
    "orig_ltv": ([0, 60, 70, 75, 80, 85, 90, 101], ["<=60", "60-70", "70-75", "75-80", "80-85", "85-90", ">90"]),
    "dti": ([0, 20, 30, 36, 43, 50, 100], ["<20", "20-30", "30-36", "36-43", "43-50", ">50"]),
    "note_rate": ([0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 100], ["<5.50", "5.50-5.99", "6.00-6.49", "6.50-6.99", "7.00-7.49", "7.50-7.99", "8.00+"]),
    "current_balance": ([0, 250e3, 500e3, 766_550, 1e6, 1.5e6, 1e9], ["<250k", "250k-500k", "500k-conforming", "conforming-1mm", "1mm-1.5mm", ">1.5mm"]),
}
CATEGORICAL_STRATS = ["state", "occupancy", "purpose", "property_type", "doc_type", "delinquency_status"]


# ---------------------------------------------------------------- data quality
def quality_checks(df: pd.DataFrame) -> pd.DataFrame:
    """Return one row per failed check per loan, the way a tape review log is kept."""
    checks = {
        "Duplicate loan ID": df["loan_id"].duplicated(keep=False),
        "Missing state": df["state"].isna() | (df["state"].astype(str).str.strip() == ""),
        "FICO missing or out of range (300-850)": ~df["fico"].between(300, 850),
        "LTV out of range (0-125)": ~df["orig_ltv"].between(0.01, 125),
        "CLTV below LTV": df["orig_cltv"] < df["orig_ltv"],
        "DTI out of range (0-65)": ~df["dti"].between(0, 65),
        "Current balance above original": df["current_balance"] > df["orig_balance"] * 1.001,
        "Note rate implausible (1-15%)": ~df["note_rate"].between(1, 15),
        "Remaining term above original": df["remaining_term"] > df["orig_term"],
        "Age + remaining term != original": (df["loan_age"] + df["remaining_term"] - df["orig_term"]).abs() > 1,
    }
    rows = []
    for name, mask in checks.items():
        for _, r in df.loc[mask.fillna(True)].iterrows():
            rows.append({"check": name, "loan_id": r["loan_id"], "current_balance": r["current_balance"]})
    return pd.DataFrame(rows, columns=["check", "loan_id", "current_balance"])


def dq_summary(exceptions: pd.DataFrame, df: pd.DataFrame) -> pd.DataFrame:
    if exceptions.empty:
        return pd.DataFrame([{"check": "All checks passed", "loans": 0, "balance": 0.0, "pct_of_pool": 0.0}])
    g = exceptions.groupby("check").agg(loans=("loan_id", "nunique"), balance=("current_balance", "sum")).reset_index()
    g["pct_of_pool"] = g["balance"] / df["current_balance"].sum() * 100
    return g.sort_values("loans", ascending=False)


# ---------------------------------------------------------------- stratification
def wavg(x: pd.Series, w: pd.Series) -> float:
    return float(np.average(x, weights=w)) if w.sum() else np.nan


def strat(df: pd.DataFrame, by: pd.Series, label: str) -> pd.DataFrame:
    total = df["current_balance"].sum()
    rows = []
    for key, g in df.groupby(by, observed=True):
        w = g["current_balance"]
        valid_fico = g["fico"].between(300, 850)
        rows.append({
            label: key, "loans": len(g), "current_balance": w.sum(), "pct_balance": w.sum() / total * 100,
            "wa_rate": wavg(g["note_rate"], w), "wa_fico": wavg(g.loc[valid_fico, "fico"], w[valid_fico]),
            "wa_ltv": wavg(g["orig_ltv"], w), "wa_dti": wavg(g["dti"], w),
            "wa_rem_term": wavg(g["remaining_term"], w)})
    out = pd.DataFrame(rows)
    return out.sort_values("current_balance", ascending=False) if label in CATEGORICAL_STRATS else out


def pool_summary(df: pd.DataFrame) -> pd.DataFrame:
    w = df["current_balance"]
    ok = df["fico"].between(300, 850)
    items = {
        "Loan count": f"{len(df):,}",
        "Current balance": f"${w.sum():,.0f}",
        "Average balance": f"${w.mean():,.0f}",
        "WA note rate": f"{wavg(df['note_rate'], w):.3f}%",
        "WA FICO (valid scores)": f"{wavg(df.loc[ok, 'fico'], w[ok]):.0f}",
        "WA original LTV": f"{wavg(df['orig_ltv'], w):.1f}%",
        "WA original CLTV": f"{wavg(df['orig_cltv'], w):.1f}%",
        "WA DTI": f"{wavg(df['dti'], w):.1f}%",
        "WA remaining term": f"{wavg(df['remaining_term'], w):.0f} months",
        "WA loan age": f"{wavg(df['loan_age'], w):.1f} months",
        "Largest state concentration": f"{df.groupby('state')['current_balance'].sum().max() / w.sum() * 100:.1f}%",
        "Investor occupancy": f"{w[df['occupancy'] == 'Investor'].sum() / w.sum() * 100:.1f}%",
        "Non-full documentation": f"{w[df['doc_type'] != 'Full'].sum() / w.sum() * 100:.1f}%",
        "Delinquent (30+)": f"{w[df['delinquency_status'] != 'Current'].sum() / w.sum() * 100:.2f}%",
    }
    return pd.DataFrame(list(items.items()), columns=["metric", "value"])


def replines(df: pd.DataFrame) -> pd.DataFrame:
    """Collapse the pool into representative lines for a cash flow model:
    grouped by original term, rate bucket and delinquency status."""
    rate_bucket = pd.cut(df["note_rate"], bins=[0, 6.0, 6.5, 7.0, 7.5, 100], labels=["<6.0", "6.0-6.5", "6.5-7.0", "7.0-7.5", "7.5+"])
    perf = np.where(df["delinquency_status"] == "Current", "Performing", "Delinquent")
    rows = []
    for (term, rb, pf), g in df.groupby([df["orig_term"], rate_bucket, perf], observed=True):
        w = g["current_balance"]
        rows.append({"repline": f"{term}M | {rb} | {pf}", "orig_term": term, "loans": len(g), "current_balance": w.sum(),
                     "wac": round(wavg(g["note_rate"], w), 4), "wa_rem_term": round(wavg(g["remaining_term"], w)),
                     "wa_age": round(wavg(g["loan_age"], w), 1), "wa_ltv": round(wavg(g["orig_ltv"], w), 1)})
    out = pd.DataFrame(rows).sort_values("current_balance", ascending=False)
    out.insert(0, "repline_id", range(1, len(out) + 1))
    return out


# ---------------------------------------------------------------- Claude commentary
def claude_commentary(summary: pd.DataFrame, strats: dict, dq: pd.DataFrame, model: str) -> str:
    """Ask Claude for a collateral commentary using aggregated tables only."""
    import anthropic  # imported here so the tool runs without the SDK when --ai is not used

    tables = "\n\n".join(f"## {name}\n{t.round(2).to_string(index=False)}" for name, t in strats.items())
    prompt = (
        "You are a structured finance analyst reviewing a residential mortgage loan tape for a potential "
        "securitization or whole-loan bid. Using ONLY the aggregated data below, write a collateral commentary of "
        "about 300 words with three short sections: Pool overview, Credit strengths and concerns, "
        "Data quality items to raise with the seller. Quote figures from the tables; do not invent any.\n\n"
        f"## Pool summary\n{summary.to_string(index=False)}\n\n{tables}\n\n"
        f"## Data quality exceptions\n{dq.round(2).to_string(index=False)}"
    )
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    msg = client.messages.create(model=model, max_tokens=1200, messages=[{"role": "user", "content": prompt}])
    return "".join(b.text for b in msg.content if b.type == "text")


# ---------------------------------------------------------------- Excel output
def write_workbook(path: Path, sheets: dict) -> None:
    with pd.ExcelWriter(path, engine="xlsxwriter") as xw:
        wb = xw.book
        head = wb.add_format({"bold": True, "font_color": "white", "bg_color": "#1F3864", "border": 1})
        money = wb.add_format({"num_format": "#,##0"})
        dec = wb.add_format({"num_format": "0.00"})
        wrap = wb.add_format({"text_wrap": True, "valign": "top"})
        for name, df in sheets.items():
            if isinstance(df, str):
                ws = wb.add_worksheet(name)
                ws.set_column(0, 0, 110, wrap)
                for i, para in enumerate(df.split("\n")):
                    ws.write(i, 0, para)
                continue
            df.to_excel(xw, sheet_name=name, index=False)
            ws = xw.sheets[name]
            for c, col in enumerate(df.columns):
                ws.write(0, c, col, head)
                fmt = money if "balance" in col else dec if df[col].dtype.kind == "f" else None
                width = max(12, min(40, int(df[col].astype(str).str.len().max() if len(df) else 10) + 2, len(col) + 4))
                ws.set_column(c, c, width, fmt)
            ws.freeze_panes(1, 0)


def main() -> None:
    ap = argparse.ArgumentParser(description="Crack a residential mortgage loan tape.")
    ap.add_argument("tape", help="loan tape (.csv or .xlsx) with standard field names, e.g. LOAN_ID, PRIN_BAL")
    ap.add_argument("--out", default="output/tape_analysis.xlsx")
    ap.add_argument("--ai", action="store_true", help="add a Claude-written collateral commentary")
    ap.add_argument("--model", default=os.getenv("CLAUDE_MODEL", "claude-sonnet-5"))
    args = ap.parse_args()

    df = pd.read_excel(args.tape) if args.tape.lower().endswith((".xlsx", ".xls")) else pd.read_csv(args.tape)
    df = df.rename(columns={k: v for k, v in STANDARD_FIELDS.items() if k in df.columns})
    missing = [k for k, v in STANDARD_FIELDS.items() if v not in df.columns]
    if missing:
        raise SystemExit(f"Tape is missing required standard field(s): {', '.join(missing)}")

    exceptions = quality_checks(df)
    dq = dq_summary(exceptions, df)
    clean = df.drop_duplicates("loan_id")

    strats = {}
    for col, (bins, labels) in STRAT_BUCKETS.items():
        strats[f"{col} strat"] = strat(clean, pd.cut(clean[col], bins=bins, labels=labels, right=False), col)
    for col in CATEGORICAL_STRATS:
        strats[f"{col} strat"] = strat(clean, clean[col].fillna("Missing"), col)

    summary = pool_summary(clean)
    sheets = {"Summary": summary, "DQ Summary": dq, "DQ Exceptions": exceptions, "Replines": replines(clean)}
    sheets.update({k[:31]: v for k, v in strats.items()})

    if args.ai:
        print("Requesting collateral commentary from Claude (aggregated tables only)...")
        sheets = {"Claude Commentary": claude_commentary(summary, strats, dq, args.model), **sheets}

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_workbook(out, sheets)
    print(summary.to_string(index=False))
    print(f"\n{len(exceptions)} data quality exceptions across {exceptions['loan_id'].nunique() if len(exceptions) else 0} loans")
    print(f"Workbook written to {out}")


if __name__ == "__main__":
    main()
