# Price Normalization

This repository contains a small script for normalizing price data in an Excel
spreadsheet based on provided inflation rates. The script reads an input file
with `Date` and `Price` columns and writes an updated spreadsheet where prices
are adjusted according to predefined inflation periods in 2024 and early 2025.

## Requirements

- Python 3
- `pandas` and `openpyxl` libraries (install with `pip install pandas openpyxl`)

## Usage

```bash
python3 normalize_prices.py input.xlsx output.xlsx
```

Optional flags:

- `--date-col` – name of the date column (default `Date`)
- `--price-col` – name of the price column (default `Price`)

The script will create `output.xlsx` with normalized prices.
