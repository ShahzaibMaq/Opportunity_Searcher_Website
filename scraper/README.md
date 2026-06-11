# Scraper

Scrapes opportunity sources for the project:

- **StandOut Connect** — custom HTML parser + optional LLM page extraction
- **College Transitions** — custom HTML parser + optional LLM page extraction
- **Extracurriculars.org** — Typesense API + optional LLM enrichment for missing fields

Structured fields (`Deadline`, `Timeline`, `Ages`, `Location`) are parsed from listing
text automatically. When Ollama is running, LLM page scraping and enrichment fill
remaining gaps (e.g. extracurriculars without listed dates).

## Manual Run

```bash
python -m pip install -r scraper/requirements.txt
python scraper/scraper.py
```

Outputs:

- `scraper/output/opportunities.csv`
- `scraper/output/opportunities.json`
- `frontend/opportunity_searcher/public/data/opportunities.json`

## Free AI Scraping (Ollama)

```bash
# 1. Install Ollama from https://ollama.com
# 2. Pull a model
ollama pull llama3.2

# 3. Run with LLM page sources + enrichment
python scraper/scraper.py --enable-llm
```

- `scraper/sources.yaml` — LLM page sources (StandOut + College Transitions articles)
- Extracurriculars.org uses the API; LLM enrichment fills missing deadline/timeline
- `--skip-llm` — disable all LLM steps
- Auto-detects Ollama when running locally; GitHub Actions skips LLM when unavailable

Optional env vars (`scraper/.env.example`):

- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT`
- `LLM_MAX_PAGE_CHARS`, `LLM_ENRICHMENT_BATCH_SIZE`

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

```bash
python scraper/scraper.py --upload-supabase
```
