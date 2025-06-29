import argparse
from datetime import datetime
import pandas as pd

# Inflation periods: (start_date, end_date, inflation_rate)
INFLATION_PERIODS = [
    ("2024-01-01", "2024-03-31", 0.56),
    ("2024-04-01", "2024-06-30", 0.39),
    ("2024-07-01", "2024-09-30", 0.29),
    ("2024-10-01", "2024-12-31", 0.18),
    ("2025-01-01", "2025-03-31", 0.10),
]

def _normalize(price_date: datetime, price: float) -> float:
    """Apply inflation adjustment for a given date."""
    date_str = price_date.strftime("%Y-%m-%d")
    for start, end, rate in INFLATION_PERIODS:
        if start <= date_str <= end:
            return price * (1 + rate)
    return price

DEFAULT_PRICE_COLUMNS = [
    "Room Revenue",
    "Net Room Revenue",
    "Extra Revenue ADR",
    "NETADR",
    "APR",
    "NETAPR",
    "PR Extra Rate",
    "Net PR Extra Rate",
]


def normalize_prices(df, date_col: str, price_cols: list[str]):
    """Normalize the given price columns of ``df`` according to the
    inflation periods."""

    df[date_col] = pd.to_datetime(df[date_col])

    for col in price_cols:
        if col not in df.columns:
            # Skip columns that are missing in the spreadsheet
            continue
        df[col] = df.apply(lambda row: _normalize(row[date_col], row[col]), axis=1)
    return df

def main():
    parser = argparse.ArgumentParser(description="Normalize prices according to inflation data")
    parser.add_argument("input", help="Path to the input Excel file")
    parser.add_argument("output", help="Path to the output Excel file")
    parser.add_argument("--date-col", default="Date", help="Name of the date column")
    parser.add_argument(
        "--price-cols",
        nargs="+",
        default=DEFAULT_PRICE_COLUMNS,
        help="Price columns to normalize (space separated)",
    )
    args = parser.parse_args()

    df = pd.read_excel(args.input)
    df = normalize_prices(df, args.date_col, args.price_cols)
    df.to_excel(args.output, index=False)

if __name__ == "__main__":
    main()
