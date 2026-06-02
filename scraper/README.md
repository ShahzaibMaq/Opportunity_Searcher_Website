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

## Supabase Upload

Copy `scraper/.env.example` to `scraper/.env`, add your Supabase values, and run:

```bash
python scraper/scraper.py --upload-supabase
```

The default table name is `opportunities`.
