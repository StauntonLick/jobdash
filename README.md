# JobDash

JobDash has:
- a Next.js dashboard in [dashboard](dashboard)
- a Python search runner used by the dashboard API

## Quick Start (Fork-Friendly)

1. Clone the repo.
2. Set up Python dependencies:

```bash
cd dashboard
npm run setup:python
```

3. Install dashboard dependencies and run:

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Python Resolution Behavior

The dashboard backend uses this order when selecting Python:
1. `JOBDASH_PYTHON` environment variable (if set)
2. Common local venv paths:
   - `../venv/bin/python`
   - `../.venv/bin/python`
   - `venv/bin/python`
   - `.venv/bin/python`
3. `python3`
4. `python`

It will only accept an interpreter that can import both `jobspy` and `pandas`.

## Use Existing Python Install

If a user already has Python with required packages, set:

```bash
export JOBDASH_PYTHON=/absolute/path/to/python
cd dashboard
npm run dev
```

If dependencies are not present, either install them into that interpreter or run:

```bash
cd dashboard
npm run setup:python
```
