# Changelog

## 0.1.3 (2026-09-24)

- Short run timeouts: the Actor now watches the run's timeout, caps each audit so it cannot outlive the run, and stops starting new audits when time runs out. The remaining URLs are listed as free `timeout` records and the run finishes as SUCCEEDED, instead of the platform killing it. SUMMARY gains `stoppedEarlyDueToRunTimeout` and `notStartedDueToRunTimeout`.

## 0.1.2 (2026-09-23)

- Listing: joined the Best Damn series. New title "Best Damn PageSpeed Insights Audit", new description, icon and README banner. No change to inputs, output or pricing.
- README: new "Integrate and automate your workflow" section (Make, Zapier, n8n, Slack, Airbyte, GitHub, Google Drive, webhooks).
- Listing: "Best Damn" in the SEO title, refreshed banner, link to the new Best Damn YouTube Comments Scraper.
- README: link to the new Best Damn YouTube Scraper.

## 0.1.1 (2026-09-20)

- Duplicate input URLs are now deduplicated by the Actor instead of being rejected by input validation, as the field description already promised.

## 0.1.0 (2026-09-18)

- Initial release: bulk audits through the official PageSpeed Insights API v5 (mobile, desktop or both).
- Lighthouse category scores (performance, accessibility, best practices, SEO), lab metrics (FCP, LCP, CLS, TBT, Speed Index, TTI) and Chrome UX Report field data (LCP, INP, CLS, FCP, TTFB with percentile and category).
- Optional top performance opportunities with estimated savings and failing accessibility / best-practices / SEO audits.
- Own Google API key supported via the `apiKey` input (falls back to the `PSI_API_KEY` environment variable).
- Invalid URLs, pages Google cannot load and quota errors are reported in the dataset and never billed.
