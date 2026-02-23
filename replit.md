# Ophthalmology Sector ETF Tracker ($OPHT)

## Overview
A professional-grade custom ETF index tracker for the ophthalmology sector, featuring 26 ophthalmology company tickers with interactive TradingView charts, benchmark comparisons against SPY and VTI, and three weighting methodologies.

## Recent Changes
- 2026-02-23: Added light/dark mode toggle with new ocean blue color palette
- 2026-02-23: Fixed SGP company name to SpyGlass Pharma, added LinkedIn footer link
- 2026-02-23: Initial build complete - data seeding, chart rendering, holdings table, mobile optimization

## Project Architecture

### Tech Stack
- **Frontend**: React + Vite + TailwindCSS + TradingView Lightweight Charts v4
- **Backend**: Express.js + TypeScript
- **Database**: PostgreSQL (Neon) via Drizzle ORM
- **Data Source**: Yahoo Finance API (free, no API key needed)

### Key Files
- `shared/schema.ts` - Database schema (price_history, market_caps, seed_status tables)
- `server/fmp.ts` - Yahoo Finance API client for historical prices and market caps
- `server/storage.ts` - Database CRUD operations with upsert support
- `server/routes.ts` - API endpoints (/api/chart-data, /api/holdings, /api/status, /api/seed, /api/update)
- `client/src/pages/home.tsx` - Main page with chart, controls, and holdings table
- `client/src/lib/indexCalculations.ts` - Index calculation logic (3 weighting modes)
- `client/src/index.css` - Theme variables (dark navy/teal with lime accent)

### Design System (Light/Dark mode)
- **Dark mode**: Ink Black (#00171F) bg, Deep Space Blue (#003459) surfaces, Cerulean (#007EA7) borders
- **Light mode**: White (#FFFFFF) bg, Light Gray (#F0F4F8) surfaces, Cerulean borders
- **OPHT accent**: Lime #D3F060 (dark) / #7B9A1E (light)
- **SPY color**: Fresh Sky #00A8E8 (dark) / #0088C2 (light)
- **VTI color**: Cerulean #007EA7 (dark) / #006080 (light)
- **Theme toggle**: Sun/Moon icon in header, persists via localStorage
- **Components**: ThemeProvider context at `client/src/components/ThemeProvider.tsx`
- Fonts: DM Sans / Inter

### Tickers (26 ophthalmology companies)
ADVM, ALC, APLS, BLCO, CLSD, COO, CZMWY, EYPT, GKOS, HOCPY, HROW, IRIX, KALA, KOD, LENZ, LNSR, OCGN, OCS, OCUL, OKYO, RXST, SGHT, SGP, STAA, TARS, VRDN
Plus benchmarks: SPY, VTI

### Weighting Modes
1. **Market Cap** (default) - Float-adjusted market cap weighted
2. **Equal Weight** - Equal weight across all constituents
3. **Capped 25%** - Market cap weighted with 25% cap per holding, iterative redistribution

### Data Flow
1. On first load, auto-seeds 10 years of historical daily adjusted close prices from Yahoo Finance
2. Data cached in PostgreSQL - subsequent loads serve from DB
3. Daily incremental updates fetch only missing dates
4. Frontend receives all price data via /api/chart-data, calculates index lines client-side

## User Preferences
- Dark theme default, light mode available via toggle
- Mobile-first design important
- Professional financial data visualization style
- Ocean blue palette: Ink Black, Deep Space Blue, Cerulean, Fresh Sky
