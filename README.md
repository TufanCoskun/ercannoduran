# Price Normalization

This repository contains a small script for normalizing price data in an Excel
spreadsheet based on provided inflation rates. The script reads an input file
with a date column and several price columns and writes an updated spreadsheet
where prices are adjusted according to predefined inflation periods in 2024 and
early 2025.

## Requirements

- Python 3
- `pandas` and `openpyxl` libraries (install with `pip install pandas openpyxl`)

## Usage

```bash
python3 normalize_prices.py input.xlsx output.xlsx
```

Optional flags:

- `--date-col` – name of the date column (default `Date`)
- `--price-cols` – price columns to normalize (defaults to the columns listed below)

Default price columns:

- `Room Revenue`
- `Net Room Revenue`
- `Extra Revenue ADR`
- `NETADR`
- `APR`
- `NETAPR`
- `PR Extra Rate`
- `Net PR Extra Rate`

The script will create `output.xlsx` with normalized prices.
