Audit any list of pages with **Google's official PageSpeed Insights API** and get back the **Lighthouse performance, accessibility, best-practices and SEO scores**, the lab metrics behind them (LCP, CLS, TBT, FCP, Speed Index, TTI) and real-user **Core Web Vitals field data**, for mobile and desktop, in one downloadable dataset.

Built for **SEO agencies, web developers and site owners** who need the same numbers as pagespeed.web.dev for dozens or thousands of URLs at once. You pay a flat price per audited page; pages Google cannot audit are reported free of charge.

## What can you do with PageSpeed Insights Core Web Vitals Audit?

- **Monitor client sites weekly**: schedule your clients' key landing pages and build a score history you can chart or alert on.
- **Before/after deploy checks**: run the same URL list before and after a release and diff the results.
- **Prospecting and sales reports**: show a prospect exactly where their pages lose points, with the top opportunities and estimated savings.
- **Portfolio-wide Core Web Vitals checks**: find the pages failing Google's "Good" thresholds in real-user data, the signal Google Search uses.
- **Competitive benchmarking** on mobile and desktop.
- **Feed dashboards and AI agents** through Google Sheets, Airtable, Make, Zapier or the Apify MCP server.

## How it works

For every URL and device strategy the Actor calls the official PageSpeed Insights API v5, exactly as pagespeed.web.dev does. Google runs Lighthouse on the page in its own data centre; nothing is scraped and no browser runs inside the Actor. The Actor reduces the large report to category scores (0 to 100), lab metrics, field data (when Google has enough real-user traffic for the page or its origin) and, optionally, the top failing audits.

Each audit takes Google roughly 10 to 30 seconds, so 100 URLs at the default concurrency finish in about 10 minutes. Two Lighthouse runs of the same page can differ by a few points.

## How to use it

1. Open the Actor and paste your page URLs into **Page URLs**, one per line.
2. Pick the **Device strategy**: mobile (what Google uses for ranking), desktop, or both.
3. Optionally narrow the **Lighthouse categories** and switch on **Include audit details** to get the top opportunities and failing audits.
4. Click **Start**. Results appear in the **Output** tab as they arrive; download them as JSON, CSV or Excel, or connect an integration.

To run it from code, use the **API** tab or the official [JavaScript](https://docs.apify.com/api/client/js) and [Python](https://docs.apify.com/api/client/python) clients.

```json
{
    "urls": ["https://example.com", "https://www.wikipedia.org"],
    "strategy": "both",
    "categories": ["performance", "accessibility", "best-practices", "seo"],
    "includeAuditDetails": true
}
```

## Output

One record per URL and strategy. A successful record (trimmed):

```json
{
    "url": "https://example.com",
    "finalUrl": "https://example.com/",
    "strategy": "mobile",
    "success": true,
    "scores": { "performance": 72, "accessibility": 88, "bestPractices": 96, "seo": 100 },
    "labMetrics": { "fcpMs": 2144, "lcpMs": 3413, "cls": 0.042, "tbtMs": 420, "speedIndexMs": 3187, "ttiMs": 4902 },
    "fieldData": {
        "lcpMs": { "percentile": 2371, "category": "FAST" },
        "inpMs": { "percentile": 214, "category": "AVERAGE" },
        "cls": { "percentile": 0.05, "category": "FAST" },
        "fcpMs": { "percentile": 1312, "category": "FAST" },
        "ttfbMs": { "percentile": 612, "category": "FAST" },
        "overallCategory": "FAST",
        "originFallback": false
    },
    "opportunities": [
        {
            "id": "render-blocking-resources",
            "title": "Eliminate render-blocking resources",
            "savingsMs": 780,
            "savingsBytes": null,
            "displayValue": "Est savings of 780 ms"
        },
        {
            "id": "unused-javascript",
            "title": "Reduce unused JavaScript",
            "savingsMs": 450,
            "savingsBytes": 120832,
            "displayValue": "Est savings of 118 KiB"
        }
    ],
    "failedAudits": [
        {
            "id": "color-contrast",
            "title": "Background and foreground colors do not have a sufficient contrast ratio.",
            "category": "accessibility",
            "score": 0,
            "displayValue": "3 failing elements"
        }
    ],
    "lighthouseVersion": "12.8.2",
    "analysisTimestamp": "2026-09-18T20:41:07.512Z",
    "fetchedAt": "2026-09-18T20:41:21.203Z"
}
```

Pages that could not be audited are still recorded, so nothing silently disappears from your list:

```json
{
    "url": "https://this-domain-does-not-exist.example",
    "strategy": "mobile",
    "success": false,
    "errorType": "dns",
    "error": "Lighthouse could not audit the page (DNS_FAILURE): ...",
    "statusCode": 500,
    "fetchedAt": "..."
}
```

### Fields

| Field                                     | Description                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url` / `finalUrl`                        | The URL you supplied and the URL Lighthouse ended on after redirects.                                                                                                                                                                                                                                                                                        |
| `strategy`                                | `mobile` or `desktop`.                                                                                                                                                                                                                                                                                                                                       |
| `success`                                 | `true` when Google returned a usable Lighthouse report. Only these records are billed.                                                                                                                                                                                                                                                                       |
| `scores`                                  | Lighthouse category scores as integers from 0 to 100 (`null` for categories you did not request). 90+ is "good", 50 to 89 "needs improvement".                                                                                                                                                                                                               |
| `labMetrics`                              | Lighthouse lab measurements from Google's test device: First Contentful Paint, Largest Contentful Paint, Cumulative Layout Shift, Total Blocking Time, Speed Index and Time to Interactive. Times in milliseconds.                                                                                                                                           |
| `fieldData`                               | Real-user Core Web Vitals from the Chrome UX Report (28-day 75th percentile): LCP, INP, CLS, FCP and TTFB, each with `percentile` and `category` (`FAST`, `AVERAGE`, `SLOW`), plus the `overallCategory` Google uses. `null` when the page has too little traffic. `originFallback` is `true` when the numbers are for the whole origin instead of the page. |
| `opportunities[]`                         | With **Include audit details**: failing performance audits with estimated `savingsMs` / `savingsBytes`, largest first, up to 15.                                                                                                                                                                                                                             |
| `failedAudits[]`                          | With **Include audit details**: failing accessibility, best-practices and SEO audits, most heavily weighted first, up to 15.                                                                                                                                                                                                                                 |
| `lighthouseVersion` / `analysisTimestamp` | The Lighthouse version Google used and when the analysis ran.                                                                                                                                                                                                                                                                                                |
| `errorType`                               | For failures: `invalid-url`, `rate-limited`, `http-error`, `dns`, `timeout`, `network`, `missing-api-key` or `other`.                                                                                                                                                                                                                                        |

## Pricing: how much does it cost to audit a page with PageSpeed Insights?

You pay a **flat price per successfully audited URL and strategy** (see the price next to the Start button). Auditing 100 URLs on mobile is 100 events; on both mobile and desktop it is 200. Invalid URLs, pages Google cannot load and quota errors cost nothing. There is no charge for Actor start-up, and the Actor stops automatically when it reaches the maximum cost you set for a run, so a large list never produces a surprise bill.

## API key and quota

By default the Actor uses a built-in Google API key shared by all its users. The PageSpeed Insights API is free but rate limited (25,000 requests per day and a few hundred per minute per key). For large or scheduled workloads, create your own free key in the [Google Cloud Console](https://developers.google.com/speed/docs/insights/v5/get-started) (enable the "PageSpeed Insights API", then create an API key) and paste it into the **Google API key** field. The key is stored encrypted and never written to the log or dataset. When a quota is exhausted you get free `rate-limited` failure records; retry later or use your own key.

## Tips

- **Mobile first**: Google Search ranks with mobile data; add `desktop` when the audience is mostly desktop.
- **Field data is the ranking signal**: `fieldData.overallCategory` reflects real users, `scores.performance` is a lab estimate. Fix field data first.
- **Variance**: for trend reports, audit on a schedule and look at the moving average rather than single runs.
- **Speed**: raise **Max concurrency** to 6 to 8 for large lists with your own API key. Higher values mostly produce per-minute quota errors.
- **Only what you need**: dropping unused categories makes each audit a little faster.

## FAQ

**Are the numbers identical to pagespeed.web.dev?**
Yes: same API, same Lighthouse run in Google's data centre, subject only to the usual run-to-run variance.

**Why is `fieldData` null for my page?**
Google only publishes Chrome UX Report data for pages and origins with enough real-user traffic. Low-traffic pages have lab data only.

**Can it audit pages behind a login, or a staging site?**
No. Google's servers must be able to fetch the page publicly; protected or localhost pages fail with `http-error`.

**Is this legal / does it scrape Google?**
No scraping is involved. The Actor uses Google's official, documented PageSpeed Insights API under its terms of service and audits only the public pages you specify.

**What happens when the quota is exhausted?**
Affected URLs are reported as free `rate-limited` failures and the run finishes normally. Supply your own key for a dedicated quota.

## Support and feedback

Found a page that fails unexpectedly, or a field you are missing? Open a ticket in the **Issues** tab of this Actor.

This Actor is open source under the MIT licence. PageSpeed Insights and Lighthouse are trademarks of Google LLC; this Actor is not affiliated with Google.
