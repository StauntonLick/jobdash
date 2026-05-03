# JobDash
JobDash is a simple UI wrapper for JobSpy, which lets you search multiple job sites in one go with multiple sets of criteria to soften the arduous process of jobseeking. It also adds a few quality-of-life improvements, including:
- Filtering of job titles to cut out noise
- Ability to blacklist companies to avoid junk listings (e.g. AI training companies)
- Combination of duplicate job ads
- Caching & refreshing to minimise rate limitations

The backend code is all from JobSpy - see their readme for more details on how to configure a job search
https://github.com/speedyapply/JobSpy

A few notes
- By default, JobDash searches Indeed, Glassdoor and LinkedIn. You can change this in CONFIG.MD.
- LinkedIn search can be flakey - results may change a fair bit on reload. This is due to LinkedIn's weird search

# Get Started
## Requirements
- macOS, Linux, or Windows with bash-compatible shell support
- Node.js 20+ (Node 24 also works)
- npm (installed with Node.js)
- Python 3.10+

## Quick Start
1. Clone the repository.
2. From the repo root, run:

```bash
./start.sh
```

This script will:
- Create/update the Python virtual environment and install Python dependencies.
- Install Node dependencies in the dashboard app.
- Start the dashboard in development mode.

When it starts, open:
http://localhost:3000

## Manual Setup
If you prefer running steps manually:

```bash
# From repo root
bash scripts/setup-python.sh

cd dashboard
npm install
npm run dev
```

# Configuration
- Edit search and filter settings in CONFIG.MD.
- Reload the dashboard and use refresh to apply config changes immediately.