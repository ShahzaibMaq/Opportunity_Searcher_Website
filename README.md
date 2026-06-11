# Opportunity Searcher Website

A high school opportunity browser for internships, summer programs, competitions,
scholarships, and research opportunities.

## Project Structure

- `frontend/opportunity_searcher` - Next.js frontend with Tailwind CSS, TypeScript,
  Supabase client setup, and lucide-react icons.
- `scraper` - Python scraper workspace for BeautifulSoup and requests.
- `.github/workflows` - GitHub Actions workspace for scheduled scraping.

## Frontend Setup

```bash
cd frontend/opportunity_searcher
npm install
npm run dev
```

Open `http://localhost:3000`.

For Supabase, copy `.env.local.example` to `.env.local` and add the project URL
and anon key from the Supabase dashboard.

## Database Setup

Run `supabase/schema.sql` in the Supabase SQL editor. It creates:

- `profiles` for username, age, gender, and location.
- `saved_opportunities` for planner items.
- Row-level security policies so users can only read and edit their own rows.
- A signup trigger that creates a profile from auth metadata.

## Scraping

The scheduled GitHub Action runs daily at `11:00 UTC` and refreshes the JSON used
by the frontend. To add new pages to the daily scrape, add them to
`scraper/sources.yaml` under `llm_sources`; the workflow runs the scraper with
AI extraction enabled.
