# Crop-ranking reliability review — 2026-10-27

The previous Pistachier 100/100 display was not defensible as a best-crop recommendation. It was a deterministic index, not a trained or locally validated agronomic ranking model.

## Findings

1. Missing-factor inflation: the old score divided by the weights of known measurements only. Rainfall and annual mean temperature in broad ideal ranges could therefore produce a perfect score despite missing heat, frost, soil and water evidence.
2. Critical pistachio checks were absent: cultivar-specific winter chill, actual flowering frost exposure and compatible male/female flowering overlap were not assessed. Annual mean temperature and the annual count of freezing days cannot establish these.
3. The frost profiles rewarded some freezing days over zero days. This confused a damaging-frost screen with beneficial winter chilling.
4. Broad latitude bands were used as hard crop exclusions. They are not parcel-scale agronomic boundaries.
5. Low rain with unknown irrigation was treated as a confirmed rainfall exclusion, even though an adequate water budget might change the assessment. Conversely, drought tolerance did not establish commercial productivity.
6. If the Python GeoAI service failed, fallback evidence could contain only coarse NASA climatology, with missing daily heat/frost observations. The UI still promoted one crop as a winner and showed exact-looking scores for excluded crops.
7. NASA annual mean temperature allowed incomplete monthly coverage; the UI printed a fixed climate period even when that period was not established by response metadata.

## Implemented corrections

- Incomplete screening factors remain in a fixed denominator and explicit uncertainty bounds. Incomplete crops, crops with a detected limitation, and crops requiring unverified critical checks do not get a point score. Bounds cover the provisional numeric factors only; they do not validate unmeasured cultivar/root-zone/site requirements.
- No validated winner is asserted in the response. All profiles remain provisional and low confidence; crops are grouped by detected constraints and then stable crop name, not by a purported yield or ROI ranking.
- The page removes the best-crop /100 hero and performance bars. Bars and counts now show the number of available screening measurements, explicitly distinguished from performance. Old saved analyses prompt a fresh assessment.
- Pistachio and almond explicitly identify missing winter chill, flowering frost and pollination checks. Pistachio includes a seasonal water-budget requirement and a commercial-yield caution. No universal chill threshold or inferred chill hours were invented.
- Frost-free conditions are no longer scored worse than a few freezing days. Latitude becomes a local-adaptation check rather than an exclusion. Unknown irrigation at low rainfall becomes a conditional water-budget requirement; confirmed high-water-demand/no-irrigation exclusions remain.
- Added a cached, direct ERA5 daily-history fallback when external history is missing. It uses ten complete calendar years and rejects missing days, missing/nonfinite values, inconsistent temperatures and wrong units. It retains heat/frost days and interannual rain range. Its ~25 km modeled resolution and limitations are shown. This is not an independent validation of ERA5 supplied through the Python service, nor a site weather station or chill model.
- NASA mean annual temperature now requires all 12 months. Reported climate periods come from response metadata, not a fixed display string.
- Location exclusion, authenticated history ownership and financial arithmetic remain covered by regression tests. Financial scenarios continue to use user assumptions and do not become yield predictions.

## Evidence and limits

- Elloumi, Ghrab, Kessentini & Ben Mimoun (2013), twelve years of Tunisian Mateur observations: winter chill affected flowering and nut yield. Cultivar/model/location differences prevent importing one universal chilling threshold. https://doi.org/10.1016/j.scienta.2013.05.004
- FAO land evaluation: match crop requirements with measured land qualities and identify critical missing evidence; quantitative performance needs field production data. https://www.fao.org/4/t0715e/t0715e06.htm
- Open-Meteo historical API: ERA5 is reanalysis at approximately 25 km and supports the daily precipitation and temperature series used here. https://open-meteo.com/en/docs/historical-weather-api

A defensible best-crop recommendation still requires local calibration against observed Tunisian orchard outcomes, cultivar-specific chill/heat and flowering windows, root-zone depth/texture/drainage, sustainable irrigation supply and salinity, management assumptions, and market/yield data. This release improves screening honesty and data resilience; it does not claim to supply those missing validations.
