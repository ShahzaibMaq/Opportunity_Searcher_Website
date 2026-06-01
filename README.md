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
