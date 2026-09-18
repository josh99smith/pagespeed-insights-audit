/**
 * Pure, network-free logic for the PageSpeed Insights API v5:
 * input normalisation, request URL building, response parsing and error categorisation.
 * Everything in this file is unit-tested against fixtures in test/fixtures.
 */

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STRATEGIES = ['mobile', 'desktop'] as const;
export type Strategy = (typeof STRATEGIES)[number];
export type StrategyInput = Strategy | 'both';

export const MAX_OPPORTUNITIES = 15;
export const MAX_FAILED_AUDITS = 15;

export type ErrorType =
    'missing-api-key' | 'invalid-url' | 'rate-limited' | 'http-error' | 'dns' | 'timeout' | 'network' | 'other';

/** Minimal typing of the parts of the PSI response we read. */
export interface PsiAudit {
    id?: string;
    title?: string;
    description?: string;
    score?: number | null;
    scoreDisplayMode?: string;
    displayValue?: string;
    numericValue?: number;
    numericUnit?: string;
    metricSavings?: Record<string, number>;
    details?: { type?: string; overallSavingsMs?: number; overallSavingsBytes?: number; [key: string]: unknown };
}

export interface PsiCategory {
    id?: string;
    title?: string;
    score?: number | null;
    auditRefs?: { id: string; weight?: number; group?: string }[];
}

export interface PsiFieldMetric {
    percentile?: number;
    category?: string;
    distributions?: { min?: number; max?: number; proportion?: number }[];
}

export interface PsiLoadingExperience {
    id?: string;
    initial_url?: string;
    overall_category?: string;
    origin_fallback?: boolean;
    metrics?: Record<string, PsiFieldMetric>;
}

export interface PsiResponse {
    captchaResult?: string;
    kind?: string;
    id?: string;
    loadingExperience?: PsiLoadingExperience;
    originLoadingExperience?: PsiLoadingExperience;
    lighthouseResult?: {
        requestedUrl?: string;
        finalUrl?: string;
        finalDisplayedUrl?: string;
        lighthouseVersion?: string;
        fetchTime?: string;
        runWarnings?: string[];
        runtimeError?: { code?: string; message?: string };
        configSettings?: { emulatedFormFactor?: string; formFactor?: string; locale?: string };
        audits?: Record<string, PsiAudit>;
        categories?: Partial<Record<Category, PsiCategory>>;
    };
    analysisUTCTimestamp?: string;
    error?: { code?: number; message?: string; status?: string; errors?: { reason?: string; message?: string }[] };
}

export interface FieldMetric {
    percentile: number;
    category: string;
}

export interface FieldData {
    lcpMs: FieldMetric | null;
    inpMs: FieldMetric | null;
    cls: FieldMetric | null;
    fcpMs: FieldMetric | null;
    ttfbMs: FieldMetric | null;
    overallCategory: string;
    /** true when Google had no page-level data and fell back to origin-level data. */
    originFallback: boolean;
}

export interface Opportunity {
    id: string;
    title: string;
    savingsMs: number | null;
    savingsBytes: number | null;
    displayValue: string | null;
}

export interface FailedAudit {
    id: string;
    title: string;
    category: Category;
    score: number | null;
    displayValue: string | null;
}

export interface SuccessItem {
    url: string;
    finalUrl: string;
    strategy: Strategy;
    success: true;
    scores: {
        performance: number | null;
        accessibility: number | null;
        bestPractices: number | null;
        seo: number | null;
    };
    labMetrics: {
        fcpMs: number | null;
        lcpMs: number | null;
        cls: number | null;
        tbtMs: number | null;
        speedIndexMs: number | null;
        ttiMs: number | null;
    };
    fieldData: FieldData | null;
    opportunities?: Opportunity[];
    failedAudits?: FailedAudit[];
    runWarnings: string[];
    lighthouseVersion: string | null;
    analysisTimestamp: string | null;
    fetchedAt: string;
}

export interface FailureItem {
    url: string;
    strategy: Strategy | null;
    success: false;
    errorType: ErrorType;
    error: string;
    statusCode?: number;
    fetchedAt: string;
}

export type ResultItem = SuccessItem | FailureItem;

/** Accepts `example.com`, `https://example.com/path` etc. Returns null for anything that is not a public http(s) URL. */
export function normalizeUrl(raw: string): string | null {
    let value = (raw ?? '').trim();
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.')) return null;
        if (parsed.username || parsed.password) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

export function resolveStrategies(input: string | undefined): Strategy[] | null {
    const value = (input ?? 'mobile').toLowerCase();
    if (value === 'both') return ['mobile', 'desktop'];
    if (value === 'mobile' || value === 'desktop') return [value];
    return null;
}

/** Keeps only known categories (in canonical order) and falls back to all four when the list is empty. */
export function resolveCategories(input: string[] | undefined): Category[] {
    const wanted = new Set((input ?? []).map((c) => String(c).toLowerCase().trim()));
    const picked = CATEGORIES.filter((c) => wanted.has(c));
    return picked.length ? picked : [...CATEGORIES];
}

export function buildPsiUrl(url: string, strategy: Strategy, categories: Category[], apiKey: string): string {
    const params = new URLSearchParams();
    params.set('url', url);
    params.set('strategy', strategy);
    for (const c of categories) params.append('category', c);
    params.set('key', apiKey);
    return `${PSI_ENDPOINT}?${params.toString()}`;
}

function toScore(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;
}

function roundMs(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function roundCls(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function fieldMetric(metric: PsiFieldMetric | undefined, scale = 1): FieldMetric | null {
    if (!metric || typeof metric.percentile !== 'number') return null;
    const percentile = scale === 1 ? metric.percentile : Math.round(metric.percentile * scale * 1000) / 1000;
    return { percentile, category: metric.category ?? 'NONE' };
}

/** Converts `loadingExperience` (CrUX field data) into a compact shape, or null when Google has no data for the page. */
export function parseFieldData(experience: PsiLoadingExperience | undefined): FieldData | null {
    const metrics = experience?.metrics;
    if (!metrics || Object.keys(metrics).length === 0) return null;
    const overall = experience?.overall_category ?? 'NONE';
    const data: FieldData = {
        lcpMs: fieldMetric(metrics.LARGEST_CONTENTFUL_PAINT_MS),
        inpMs: fieldMetric(metrics.INTERACTION_TO_NEXT_PAINT),
        // CrUX reports CLS as an integer that is 100x the actual score (5 => 0.05).
        cls: fieldMetric(metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE, 0.01),
        fcpMs: fieldMetric(metrics.FIRST_CONTENTFUL_PAINT_MS),
        ttfbMs: fieldMetric(metrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE),
        overallCategory: overall,
        originFallback: experience?.origin_fallback === true,
    };
    if (!data.lcpMs && !data.inpMs && !data.cls && !data.fcpMs && !data.ttfbMs) return null;
    return data;
}

function savingsOf(audit: PsiAudit): number | null {
    const overall = audit.details?.overallSavingsMs;
    if (typeof overall === 'number' && Number.isFinite(overall)) return Math.round(overall);
    const fromMetrics = Object.values(audit.metricSavings ?? {}).filter(
        (v) => typeof v === 'number' && Number.isFinite(v),
    );
    if (fromMetrics.length) return Math.round(Math.max(...fromMetrics));
    return null;
}

/** Failing performance audits that carry an estimated time saving, largest saving first, capped at MAX_OPPORTUNITIES. */
export function extractOpportunities(response: PsiResponse): Opportunity[] {
    const lh = response.lighthouseResult;
    const audits = lh?.audits ?? {};
    const refs = lh?.categories?.performance?.auditRefs?.map((r) => r.id) ?? Object.keys(audits);
    const out: Opportunity[] = [];
    for (const id of refs) {
        const audit = audits[id];
        if (!audit) continue;
        if (typeof audit.score !== 'number' || audit.score >= 0.9) continue;
        const isOpportunity =
            audit.details?.type === 'opportunity' ||
            audit.scoreDisplayMode === 'metricSavings' ||
            !!audit.metricSavings;
        if (!isOpportunity) continue;
        const savingsMs = savingsOf(audit);
        const savingsBytes =
            typeof audit.details?.overallSavingsBytes === 'number'
                ? Math.round(audit.details.overallSavingsBytes)
                : null;
        if (!savingsMs && !savingsBytes) continue;
        out.push({ id, title: audit.title ?? id, savingsMs, savingsBytes, displayValue: audit.displayValue ?? null });
    }
    out.sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0) || (b.savingsBytes ?? 0) - (a.savingsBytes ?? 0));
    return out.slice(0, MAX_OPPORTUNITIES);
}

/** Weighted audits (score < 1) in the non-performance categories, most important first, capped at MAX_FAILED_AUDITS. */
export function extractFailedAudits(response: PsiResponse): FailedAudit[] {
    const lh = response.lighthouseResult;
    const audits = lh?.audits ?? {};
    const out: (FailedAudit & { weight: number })[] = [];
    for (const category of CATEGORIES) {
        if (category === 'performance') continue;
        for (const ref of lh?.categories?.[category]?.auditRefs ?? []) {
            const audit = audits[ref.id];
            if (!audit || typeof audit.score !== 'number' || audit.score >= 1) continue;
            if (
                audit.scoreDisplayMode === 'manual' ||
                audit.scoreDisplayMode === 'informative' ||
                audit.scoreDisplayMode === 'notApplicable'
            )
                continue;
            out.push({
                id: ref.id,
                title: audit.title ?? ref.id,
                category,
                score: audit.score,
                displayValue: audit.displayValue ?? null,
                weight: ref.weight ?? 0,
            });
        }
    }
    out.sort((a, b) => b.weight - a.weight || (a.score ?? 0) - (b.score ?? 0));
    return out.slice(0, MAX_FAILED_AUDITS).map(({ weight: _weight, ...rest }) => rest);
}

export interface ParseOptions {
    url: string;
    strategy: Strategy;
    categories: Category[];
    includeAuditDetails: boolean;
    fetchedAt?: string;
}

export class PsiResponseError extends Error {
    constructor(
        message: string,
        public readonly errorType: ErrorType,
    ) {
        super(message);
        this.name = 'PsiResponseError';
    }
}

/**
 * Silent-failure guard: a 200 response must contain a Lighthouse result with at least one of the requested
 * category scores, otherwise the item is not billable.
 */
export function assertUsableResponse(response: PsiResponse, categories: Category[]): void {
    const lh = response?.lighthouseResult;
    if (!lh || typeof lh !== 'object') throw new PsiResponseError('PSI response contains no lighthouseResult', 'other');
    const { runtimeError } = lh;
    if (runtimeError?.code && runtimeError.code !== 'NO_ERROR') {
        throw new PsiResponseError(
            `Lighthouse runtime error ${runtimeError.code}: ${runtimeError.message ?? ''}`.trim(),
            categorizeLighthouseError(runtimeError.code),
        );
    }
    const hasScore = categories.some((c) => typeof lh.categories?.[c]?.score === 'number');
    if (!hasScore)
        throw new PsiResponseError('PSI response contains no category scores for the requested categories', 'other');
}

export function parsePsiResponse(response: PsiResponse, options: ParseOptions): SuccessItem {
    assertUsableResponse(response, options.categories);
    const lh = response.lighthouseResult!;
    const audits = lh.audits ?? {};
    const cats = lh.categories ?? {};

    const item: SuccessItem = {
        url: options.url,
        finalUrl: lh.finalDisplayedUrl ?? lh.finalUrl ?? response.id ?? options.url,
        strategy: options.strategy,
        success: true,
        scores: {
            performance: toScore(cats.performance?.score),
            accessibility: toScore(cats.accessibility?.score),
            bestPractices: toScore(cats['best-practices']?.score),
            seo: toScore(cats.seo?.score),
        },
        labMetrics: {
            fcpMs: roundMs(audits['first-contentful-paint']?.numericValue),
            lcpMs: roundMs(audits['largest-contentful-paint']?.numericValue),
            cls: roundCls(audits['cumulative-layout-shift']?.numericValue),
            tbtMs: roundMs(audits['total-blocking-time']?.numericValue),
            speedIndexMs: roundMs(audits['speed-index']?.numericValue),
            ttiMs: roundMs(audits.interactive?.numericValue),
        },
        fieldData: parseFieldData(response.loadingExperience),
        runWarnings: Array.isArray(lh.runWarnings) ? lh.runWarnings.map(String) : [],
        lighthouseVersion: lh.lighthouseVersion ?? null,
        analysisTimestamp: response.analysisUTCTimestamp ?? lh.fetchTime ?? null,
        fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    };
    if (options.includeAuditDetails) {
        item.opportunities = extractOpportunities(response);
        item.failedAudits = extractFailedAudits(response);
    }
    return item;
}

/** Maps a Lighthouse runtime error code (as embedded in PSI error messages) to our error types. */
export function categorizeLighthouseError(code: string | undefined): ErrorType {
    switch (code) {
        case 'DNS_FAILURE':
            return 'dns';
        case 'FAILED_DOCUMENT_REQUEST':
        case 'ERRORED_DOCUMENT_REQUEST':
        case 'INVALID_URL':
        case 'NOT_HTML':
        case 'INSECURE_DOCUMENT_REQUEST':
            return 'http-error';
        case 'PROTOCOL_TIMEOUT':
        case 'PAGE_HUNG':
        case 'NO_FCP':
        case 'NO_LCP':
            return 'timeout';
        default:
            return 'other';
    }
}

/**
 * Categorises a non-2xx PSI response. `body` is the parsed JSON error body when available.
 * Returns a friendly message that never includes the API key.
 */
export function categorizeHttpError(
    status: number,
    body: PsiResponse | undefined,
    rawText?: string,
): { errorType: ErrorType; error: string } {
    const message = body?.error?.message ?? (rawText ? rawText.slice(0, 300) : '') ?? '';
    const reason = body?.error?.errors?.[0]?.reason ?? '';
    const lhCode = /Lighthouse returned error: ([A-Z_]+)/.exec(message)?.[1];

    if (status === 429 || reason === 'rateLimitExceeded' || body?.error?.status === 'RESOURCE_EXHAUSTED') {
        return {
            errorType: 'rate-limited',
            error: `PageSpeed Insights quota exceeded (HTTP ${status}). Supply your own Google API key in the "apiKey" input or wait and retry. ${message}`.trim(),
        };
    }
    if (lhCode) {
        return {
            errorType: categorizeLighthouseError(lhCode),
            error: `Lighthouse could not audit the page (${lhCode}): ${message}`,
        };
    }
    if (status === 400 && /invalid value|url/i.test(message)) {
        return { errorType: 'invalid-url', error: `PageSpeed Insights rejected the URL: ${message}` };
    }
    if (status === 400 || status === 403) {
        if (
            /api key|apikey|key not valid|forbidden|permission/i.test(message) ||
            reason === 'forbidden' ||
            reason === 'keyInvalid'
        ) {
            return {
                errorType: 'other',
                error: `Google rejected the API key (HTTP ${status}): ${message.replace(/\.\s*$/, '')}. Check that the key is valid and the PageSpeed Insights API is enabled for it.`,
            };
        }
    }
    if (status >= 500)
        return {
            errorType: 'http-error',
            error: `PageSpeed Insights server error (HTTP ${status}): ${message || 'no details'}`,
        };
    return { errorType: 'other', error: `PageSpeed Insights returned HTTP ${status}: ${message || 'no details'}` };
}

/** Categorises a thrown fetch error (network failure, abort/timeout, ...). */
export function categorizeFetchError(err: unknown): { errorType: ErrorType; error: string } {
    const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
    const text =
        `${e?.name ?? ''} ${e?.message ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`.toLowerCase();
    if (
        e?.name === 'TimeoutError' ||
        e?.name === 'AbortError' ||
        text.includes('timeout') ||
        text.includes('timed out')
    ) {
        return {
            errorType: 'timeout',
            error: `PageSpeed Insights did not respond in time: ${e?.message ?? 'timeout'}`,
        };
    }
    if (text.includes('enotfound') || text.includes('getaddrinfo') || text.includes('eai_again')) {
        return {
            errorType: 'dns',
            error: `Could not resolve the PageSpeed Insights API host: ${e?.message ?? ''}`.trim(),
        };
    }
    if (
        text.includes('econn') ||
        text.includes('socket') ||
        text.includes('tls') ||
        text.includes('certificate') ||
        text.includes('fetch failed')
    ) {
        return {
            errorType: 'network',
            error: `Network error while calling PageSpeed Insights: ${e?.cause?.message ?? e?.message ?? 'unknown'}`,
        };
    }
    return { errorType: 'other', error: (e?.message ?? String(err)).slice(0, 500) };
}
