# Scraper

Scrapes the first opportunity sources for the project:

- StandOut Connect New Jersey internship article
- Extracurriculars.org Typesense opportunity database
- College Transitions research opportunities article

## Manual Run

```bash
python -m pip install -r scraper/requirements.txt
python scraper/scraper.py
```

Outputs:

- `scraper/output/opportunities.csv`
- `scraper/output/opportunities.json`
- `frontend/opportunity_searcher/public/data/opportunities.json`

The frontend reads the public JSON file, so rerunning the scraper refreshes the
website data.

## Daily Scrape

GitHub Actions runs `.github/workflows/scrape.yml` every day at `11:00 UTC`
(`7:00 AM Eastern` during daylight time). The workflow installs Ollama, pulls
`llama3.2`, and runs:

```bash
python scraper/scraper.py --enable-llm
```

The workflow commits refreshed JSON/CSV output when the scrape changes the data.

## Adding Websites

Add new AI-assisted page sources to `scraper/sources.yaml`:

```yaml
llm_sources:
  - url: https://example.org/high-school-programs
    source: Example Org
    defaults:
      category: Summer Program
      location: United States
      subject: General
```

The next manual or scheduled scraper run will include that page. Use defaults
as fallbacks only; the scraper still tries to extract the real title, location,
deadline, timeline, eligibility, and link from the page.

## Supabase Upload

Copy `scraper/.env.example` to `scraper/.env`, add your Supabase values, and run:

```bash
python scraper/scraper.py --upload-supabase
```

The default table name is `opportunities`.
