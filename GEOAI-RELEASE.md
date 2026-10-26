# GeoAI release notes

## Scope and compatibility

Only the GeoAI router and its helper modules change. Authentication, investments, land listings and other application routes are unchanged. No MongoDB migration is required. Signed-in reports still use the existing Analysis model; anonymous exploration no longer creates unowned saved records. History requires a verified JWT and returns 20 results per page. Client-provided user IDs are ignored.

`POST /api/geoai/analyze` retains `{success, analysisId, result}` and adds a versioned `feasibility-1` result with immutable inputs, source statuses, provenance, canonical crop IDs, exclusions and conditional/missing-data states. `POST /api/geoai/estimate` calculates an explicitly user-entered scenario and writes nothing to the database. The adapter accepts both upstream 0.5 and 0.6 contracts. Management recommendations are never scored as crops. The backend is the only crop scorer.

## Local verification

1. `npm ci` and `npm test` in this repository.
2. `npm run preview:geoai` starts a localhost-only API on 5019 without loading `.env` or connecting to MongoDB.
3. Start the frontend with `VITE_API_URL=http://127.0.0.1:5019/api` and Vite on 5179.
4. To verify all three projects, run the Python service on 8019 and set `GEOAI_API_URL=http://127.0.0.1:8019/v1/site-analysis` in the preview process.

## Deployment order and rollback

Deploy the Express backend and verify the versioned contract, authentication, response deadline and CORS from the real frontend origin. Then deploy the frontend. The Python evidence-quality update may be deployed separately because the adapter supports both versions. Do not publish the new frontend against the old backend: it deliberately refuses old results instead of silently rescoring them.

Keep the previous deployed service revisions for rollback. Roll back the frontend before rolling back the backend contract. No data deletion, seeding, credential rotation or production write is required for tests. Confirm authenticated save/history using a disposable test account before production rollout. Because the process-level rate limit uses `req.ip` for guests, verify the hosting platform's trusted-proxy configuration before using it for public traffic; authenticated users have separate buckets. This is an initial bounded abuse guard, not a distributed rate limiter.

## Required operational follow-up before publication

The repository previously committed `.env`. This branch stops tracking it while preserving the local file, and provides `.env.example`. Existing Git history still contains old values. Configure actual secrets in Render's environment and rotate exposed MongoDB/JWT credentials through the hosting/database accounts. Do not remove the deployed service's effective configuration without replacing it. These account operations were not performed during local implementation. A JWT secret rotation will require existing users to sign in again; plan that change deliberately.

## Scientific and financial limits

Crop profiles remain provisional screening rules with low confidence. The new normalized score is a compatibility index over known measurements, not calibrated probability or yield prediction. All plantable candidates remain conditional on root-zone soil, water volume and field verification. Nearby OSM features never establish overlap; only an actual containing closed way can exclude a point. Unknown mapping remains unknown. Whole-parcel land cover, multi-zone soils, irrigation prescriptions, species-specific chill models, disease diagnosis and legal land/water access are not certified.

The cost module is a constant-price, unlevered scenario using entered area, density, dates, yield, costs, sale price and water assumptions. It calculates yearly cash flow, funding deficit, NPV, horizon ROI, payback and IRR for conventional cash flows. Stress case uses 75% yield, 85% price and 115% operating costs; upside uses 115% yield and 110% price with unchanged costs. There are no invented market-price defaults. Land/rent, tax, debt, subsidies, replacement capex, working capital and terminal value are excluded and disclosed. Water demand is entered, not an agronomic irrigation prescription. Water-deficit scenarios are explicitly flagged rather than silently treated as feasible. Financial estimates are exported with assumptions but not separately persisted in account history in this release.

Next product work is agronomist calibration, dated Tunisian quotations, root-zone soil coverage, monthly FAO-56 water balance and a more complete farm-business budget. These require evidence and local validation rather than additional cosmetic scores.
