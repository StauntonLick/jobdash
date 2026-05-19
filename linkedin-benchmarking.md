# LinkedIn Search Benchmarking

This document captures the benchmark process used on 2026-05-19 to understand where search time is spent and to tune LinkedIn safely.

## Current runtime settings

These were updated after the benchmark:

- LinkedIn repeats in `dashboard/src/lib/jobspy-service.ts`: 2 runs maximum
- LinkedIn delay default in `dashboard/scripts/jobspy_patches.py`: `0.5`
- LinkedIn band-delay default in `dashboard/scripts/jobspy_patches.py`: `1.0`

## What was tested

The benchmark work was split into four parts:

1. Full search timing across all configured searches and sites
2. Deep LinkedIn timing breakdown by sub-stage
3. One-off delay sensitivity check on a heavy LinkedIn search
4. Repeated reliability comparison between current and lower-delay profiles

## Scripts

These scripts are now stored in the repo so they can be rerun without rebuilding them from scratch:

- `dashboard/scripts/benchmarks/jobdash_search_timing_probe.py`
- `dashboard/scripts/benchmarks/jobdash_linkedin_deep_probe.py`
- `dashboard/scripts/benchmarks/jobdash_linkedin_delay_sensitivity.py`
- `dashboard/scripts/benchmarks/jobdash_linkedin_reliability_benchmark.py`

All commands below assume you are in the repo root:

```bash
cd "/Users/jonny/Coding Projects/JobDash"
```

## Environment assumptions

- The Python virtualenv exists at `venv/`
- Dependencies are installed from `requirements.txt`
- The benchmark scripts read search criteria from `CONFIG.MD`
- The scripts call JobSpy directly, not the UI

If needed, set up Python first:

```bash
scripts/setup-python.sh
```

## 1. Full site timing probe

Purpose:
Measure wall-clock time by search and by site using the same Python runner that the app uses.

Run:

```bash
./venv/bin/python dashboard/scripts/benchmarks/jobdash_search_timing_probe.py > /tmp/jobdash_search_timing_report.json
```

Useful follow-up:

```bash
python3 - <<'PY'
import json
with open('/tmp/jobdash_search_timing_report.json') as f:
    report = json.load(f)
print(report['summary'])
PY
```

What to look for:

- Average wall time by site
- LinkedIn variance across repeated runs
- Approximate process overhead vs runner-reported scrape time

## 2. Deep LinkedIn timing probe

Purpose:
Estimate how much LinkedIn time is spent in:

- network requests
- inter-page sleep
- per-card processing
- unattributed runtime

Run:

```bash
./venv/bin/python dashboard/scripts/benchmarks/jobdash_linkedin_deep_probe.py > /tmp/jobdash_linkedin_deep_probe.json
```

Useful follow-up:

```bash
python3 - <<'PY'
import json
with open('/tmp/jobdash_linkedin_deep_probe.json') as f:
    report = json.load(f)
for item in report['probes']:
    print(item['title'], item['metrics'])
PY
```

Expected interpretation:

- LinkedIn is usually dominated by inter-page sleep
- Request time is material but much smaller than sleep time
- `_process_job` should be negligible

## 3. Delay sensitivity spot check

Purpose:
Compare a heavy LinkedIn search under the current delay profile and zero delay.

Run:

```bash
./venv/bin/python dashboard/scripts/benchmarks/jobdash_linkedin_delay_sensitivity.py
```

What to look for:

- Runtime gap between current settings and zero delay
- Whether result count changes when delay is removed

This is not a reliability test. It is only a quick confirmation that delay is the main cost driver.

## 4. Delay reliability benchmark

Purpose:
Compare multiple LinkedIn delay profiles across repeated runs of heavier searches.

Current script profiles:

- `current`: `1.0 + 1.5`
- `candidate_safe_min`: `0.5 + 1.0`
- `aggressive_check`: `0.3 + 0.7`

Run:

```bash
./venv/bin/python dashboard/scripts/benchmarks/jobdash_linkedin_reliability_benchmark.py > /tmp/jobdash_linkedin_reliability_benchmark.json
```

Useful follow-up:

```bash
python3 - <<'PY'
import json
with open('/tmp/jobdash_linkedin_reliability_benchmark.json') as f:
    report = json.load(f)
print(report['overall'])
for location in report['locations']:
    print(location['title'])
    for name, profile in location['profiles'].items():
        print(name, profile['summary'])
PY
```

What to compare:

- average runtime
- average count
- error runs
- bot-signal runs

Bot-signal detection in the script is intentionally simple. It only flags obvious `429` or `blocked` errors.

## Result from the 2026-05-19 run

Summary:

- LinkedIn was much slower than Indeed and Glassdoor
- The deep probe showed most LinkedIn time was deliberate inter-page sleep
- `0.5 + 1.0` reduced runtime by about 31% vs the old `1.0 + 1.5` settings
- `0.3 + 0.7` reduced runtime by about 43% in this sample, but it is more aggressive
- No result-count loss or obvious block signals were observed in the repeated test sample for either lower profile

Recommendation from that run:

- Adopt `0.5 + 1.0` first as the safer minimum
- Treat `0.3 + 0.7` as an optional second-step tuning pass if needed later

## Re-prompt template

If you want to ask an agent to rerun this later, this prompt is a good starting point:

```text
Rerun the LinkedIn benchmark process documented in linkedin-benchmarking.md.
Use the scripts in dashboard/scripts/benchmarks/.
Report:
1. full site timing summary
2. deep LinkedIn time breakdown
3. delay sensitivity result
4. repeated reliability comparison for current vs lower-delay profiles
5. whether the current LinkedIn defaults still look safe
Do not change code unless I ask.
```

## Optional next checks

If you want to extend the benchmark later, useful follow-ups are:

1. Increase reliability iterations from 3 to 5 or 10
2. Test the current live defaults instead of the original baseline values in the reliability script
3. Repeat the benchmark at different times of day to capture LinkedIn-side variance
4. Measure end-to-end `/api/searches?forceRefresh=true&debug=true` time before and after changes
