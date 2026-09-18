import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fetchPsi, loadMockResponse } from '../src/client.js';
import { runPool } from '../src/pool.js';
import {
    assertUsableResponse,
    buildPsiUrl,
    categorizeFetchError,
    categorizeHttpError,
    categorizeLighthouseError,
    extractFailedAudits,
    extractOpportunities,
    MAX_OPPORTUNITIES,
    normalizeUrl,
    parseFieldData,
    parsePsiResponse,
    PsiResponseError,
    type PsiResponse,
    resolveCategories,
    resolveStrategies,
} from '../src/psi.js';

function loadFixture(name: string): PsiResponse {
    return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as PsiResponse;
}

const fixture = loadFixture('psi-response.json');
const failedDocument = loadFixture('psi-error-failed-document.json');
const rateLimited = loadFixture('psi-error-rate-limited.json');
const ALL = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

describe('normalizeUrl', () => {
    it('adds https:// when the scheme is missing', () => {
        expect(normalizeUrl('example.com')).toBe('https://example.com/');
        expect(normalizeUrl('  www.wikipedia.org/wiki/Main_Page ')).toBe('https://www.wikipedia.org/wiki/Main_Page');
    });

    it('keeps explicit http and paths/queries', () => {
        expect(normalizeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1');
    });

    it('rejects junk, empty strings, non-http schemes and credentials', () => {
        expect(normalizeUrl('')).toBeNull();
        expect(normalizeUrl('not a url')).toBeNull();
        expect(normalizeUrl('localhost')).toBeNull();
        expect(normalizeUrl('ftp://example.com')).toBeNull();
        expect(normalizeUrl('mailto:someone@example.com')).toBeNull();
        expect(normalizeUrl('https://user:pass@example.com')).toBeNull();
    });
});

describe('resolveStrategies / resolveCategories', () => {
    it('maps strategy input', () => {
        expect(resolveStrategies(undefined)).toEqual(['mobile']);
        expect(resolveStrategies('desktop')).toEqual(['desktop']);
        expect(resolveStrategies('Both')).toEqual(['mobile', 'desktop']);
        expect(resolveStrategies('tablet')).toBeNull();
    });

    it('filters unknown categories and defaults to all four', () => {
        expect(resolveCategories(undefined)).toEqual([...ALL]);
        expect(resolveCategories([])).toEqual([...ALL]);
        expect(resolveCategories(['seo', 'PERFORMANCE', 'pwa'])).toEqual(['performance', 'seo']);
        expect(resolveCategories(['pwa'])).toEqual([...ALL]);
    });
});

describe('buildPsiUrl', () => {
    it('builds the documented v5 request with repeated category params and the key', () => {
        const url = buildPsiUrl('https://example.com/', 'mobile', ['performance', 'seo'], 'KEY123');
        const parsed = new URL(url);
        expect(parsed.origin + parsed.pathname).toBe('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
        expect(parsed.searchParams.get('url')).toBe('https://example.com/');
        expect(parsed.searchParams.get('strategy')).toBe('mobile');
        expect(parsed.searchParams.getAll('category')).toEqual(['performance', 'seo']);
        expect(parsed.searchParams.get('key')).toBe('KEY123');
    });
});

describe('parsePsiResponse', () => {
    const item = parsePsiResponse(fixture, {
        url: 'https://example.com',
        strategy: 'mobile',
        categories: [...ALL],
        includeAuditDetails: false,
        fetchedAt: 'T',
    });

    it('extracts 0-100 integer category scores', () => {
        expect(item.scores).toEqual({ performance: 72, accessibility: 88, bestPractices: 96, seo: 100 });
    });

    it('extracts rounded lab metrics', () => {
        expect(item.labMetrics).toEqual({
            fcpMs: 2144,
            lcpMs: 3413,
            cls: 0.042,
            tbtMs: 420,
            speedIndexMs: 3187,
            ttiMs: 4902,
        });
    });

    it('extracts CrUX field data with percentile + category and rescales CLS', () => {
        expect(item.fieldData).toEqual({
            lcpMs: { percentile: 2371, category: 'FAST' },
            inpMs: { percentile: 214, category: 'AVERAGE' },
            cls: { percentile: 0.05, category: 'FAST' },
            fcpMs: { percentile: 1312, category: 'FAST' },
            ttfbMs: { percentile: 612, category: 'FAST' },
            overallCategory: 'FAST',
            originFallback: false,
        });
    });

    it('carries identity and metadata fields', () => {
        expect(item.url).toBe('https://example.com');
        expect(item.finalUrl).toBe('https://example.com/');
        expect(item.strategy).toBe('mobile');
        expect(item.success).toBe(true);
        expect(item.lighthouseVersion).toBe('12.8.2');
        expect(item.analysisTimestamp).toBe('2026-09-18T20:41:07.512Z');
        expect(item.fetchedAt).toBe('T');
        expect(item.runWarnings).toEqual([]);
        expect(item.opportunities).toBeUndefined();
        expect(item.failedAudits).toBeUndefined();
    });

    it('includes opportunities and failed audits when includeAuditDetails is on', () => {
        const detailed = parsePsiResponse(fixture, {
            url: 'https://example.com',
            strategy: 'desktop',
            categories: [...ALL],
            includeAuditDetails: true,
        });
        expect(detailed.opportunities?.map((o) => o.id)).toEqual([
            'render-blocking-resources',
            'unused-javascript',
            'modern-image-formats',
        ]);
        expect(detailed.opportunities?.[0]).toEqual({
            id: 'render-blocking-resources',
            title: 'Eliminate render-blocking resources',
            savingsMs: 780,
            savingsBytes: null,
            displayValue: 'Est savings of 780 ms',
        });
        expect(detailed.opportunities?.[1].savingsBytes).toBe(120832);
        expect(detailed.failedAudits?.map((a) => `${a.category}:${a.id}`)).toEqual([
            'accessibility:color-contrast',
            'best-practices:errors-in-console',
        ]);
    });

    it('returns null scores for categories that were not requested / not returned', () => {
        const partial = structuredClone(fixture);
        delete partial.lighthouseResult!.categories!.accessibility;
        delete partial.lighthouseResult!.categories!.seo;
        const out = parsePsiResponse(partial, {
            url: 'x',
            strategy: 'mobile',
            categories: ['performance', 'best-practices'],
            includeAuditDetails: false,
        });
        expect(out.scores).toEqual({ performance: 72, accessibility: null, bestPractices: 96, seo: null });
    });

    it('returns null field data when Google has no CrUX data for the page', () => {
        expect(parseFieldData(undefined)).toBeNull();
        expect(parseFieldData({ metrics: {}, overall_category: 'NONE' })).toBeNull();
        const noField = structuredClone(fixture);
        noField.loadingExperience = { id: 'x', metrics: {}, overall_category: 'NONE' };
        const out = parsePsiResponse(noField, {
            url: 'x',
            strategy: 'mobile',
            categories: [...ALL],
            includeAuditDetails: false,
        });
        expect(out.fieldData).toBeNull();
    });

    it('flags origin fallback', () => {
        const fb = parseFieldData({ ...fixture.loadingExperience, origin_fallback: true });
        expect(fb?.originFallback).toBe(true);
    });

    it('tolerates missing audits and null scores', () => {
        const sparse: PsiResponse = {
            lighthouseResult: {
                categories: { performance: { score: 0.5 } },
                audits: { 'largest-contentful-paint': { numericValue: 1000 } },
            },
        };
        const out = parsePsiResponse(sparse, {
            url: 'x',
            strategy: 'mobile',
            categories: ['performance'],
            includeAuditDetails: true,
        });
        expect(out.scores.performance).toBe(50);
        expect(out.labMetrics.lcpMs).toBe(1000);
        expect(out.labMetrics.fcpMs).toBeNull();
        expect(out.opportunities).toEqual([]);
        expect(out.failedAudits).toEqual([]);
        expect(out.finalUrl).toBe('x');
    });
});

describe('assertUsableResponse (silent-failure guard)', () => {
    it('rejects an empty or shapeless body', () => {
        expect(() => assertUsableResponse({}, ['performance'])).toThrow(PsiResponseError);
        expect(() => assertUsableResponse({ lighthouseResult: {} }, ['performance'])).toThrow(/no category scores/);
    });

    it('rejects a body whose requested category has no score', () => {
        expect(() =>
            assertUsableResponse({ lighthouseResult: { categories: { seo: { score: 1 } } } }, ['performance']),
        ).toThrow(PsiResponseError);
    });

    it('surfaces Lighthouse runtime errors with a categorised errorType', () => {
        const body: PsiResponse = {
            lighthouseResult: {
                runtimeError: { code: 'DNS_FAILURE', message: 'nope' },
                categories: { performance: { score: null } },
            },
        };
        try {
            assertUsableResponse(body, ['performance']);
            expect.unreachable();
        } catch (err) {
            expect(err).toBeInstanceOf(PsiResponseError);
            expect((err as PsiResponseError).errorType).toBe('dns');
        }
        expect(() =>
            assertUsableResponse(
                { lighthouseResult: { runtimeError: { code: 'NO_ERROR' }, categories: { performance: { score: 1 } } } },
                ['performance'],
            ),
        ).not.toThrow();
    });
});

describe('extractOpportunities / extractFailedAudits', () => {
    it('sorts by savings and caps the list', () => {
        const many = structuredClone(fixture);
        const audits = many.lighthouseResult!.audits!;
        const refs = many.lighthouseResult!.categories!.performance!.auditRefs!;
        for (let i = 0; i < 30; i++) {
            const id = `synthetic-${i}`;
            audits[id] = {
                id,
                title: id,
                score: 0.1,
                scoreDisplayMode: 'metricSavings',
                metricSavings: { LCP: 1000 + i },
            };
            refs.push({ id, weight: 0 });
        }
        const out = extractOpportunities(many);
        expect(out).toHaveLength(MAX_OPPORTUNITIES);
        expect(out[0].id).toBe('synthetic-29');
        expect(out[0].savingsMs).toBe(1029);
    });

    it('ignores passing audits, informative audits and audits without savings', () => {
        const ids = extractOpportunities(fixture).map((o) => o.id);
        expect(ids).not.toContain('server-response-time');
        expect(ids).not.toContain('uses-text-compression');
        expect(ids).not.toContain('diagnostics');
        expect(ids).not.toContain('uses-long-cache-ttl');
    });

    it('ignores manual/informative audits in failed audit list', () => {
        const ids = extractFailedAudits(fixture).map((a) => a.id);
        expect(ids).not.toContain('structured-data');
        expect(ids).not.toContain('image-alt');
    });
});

describe('error categorisation', () => {
    it('maps the 429 quota error to rate-limited with a helpful message', () => {
        const out = categorizeHttpError(429, rateLimited);
        expect(out.errorType).toBe('rate-limited');
        expect(out.error).toContain('apiKey');
        expect(out.error).toContain('Quota exceeded');
    });

    it('maps RESOURCE_EXHAUSTED with another status to rate-limited', () => {
        expect(categorizeHttpError(403, { error: { status: 'RESOURCE_EXHAUSTED', message: 'x' } }).errorType).toBe(
            'rate-limited',
        );
    });

    it('maps FAILED_DOCUMENT_REQUEST to http-error', () => {
        const out = categorizeHttpError(500, failedDocument);
        expect(out.errorType).toBe('http-error');
        expect(out.error).toContain('FAILED_DOCUMENT_REQUEST');
    });

    it('maps other Lighthouse codes', () => {
        expect(categorizeLighthouseError('DNS_FAILURE')).toBe('dns');
        expect(categorizeLighthouseError('PROTOCOL_TIMEOUT')).toBe('timeout');
        expect(categorizeLighthouseError('NOT_HTML')).toBe('http-error');
        expect(categorizeLighthouseError('SOMETHING_NEW')).toBe('other');
        expect(
            categorizeHttpError(500, { error: { message: 'Lighthouse returned error: DNS_FAILURE. x' } }).errorType,
        ).toBe('dns');
    });

    it('maps a 400 URL rejection to invalid-url', () => {
        const body: PsiResponse = {
            error: {
                code: 400,
                message:
                    "Invalid value 'foo'. Values must match the following regular expression: '(?i)(url:|origin:)?http(s)?://.*'",
                status: 'INVALID_ARGUMENT',
            },
        };
        expect(categorizeHttpError(400, body).errorType).toBe('invalid-url');
    });

    it('explains an API key rejection', () => {
        const out = categorizeHttpError(400, {
            error: {
                code: 400,
                message: 'API key not valid. Please pass a valid API key.',
                errors: [{ reason: 'badRequest' }],
            },
        });
        expect(out.errorType).toBe('other');
        expect(out.error).toMatch(/rejected the API key/);
    });

    it('handles non-JSON bodies and generic statuses', () => {
        expect(categorizeHttpError(502, undefined, '<html>Bad gateway</html>')).toEqual({
            errorType: 'http-error',
            error: expect.stringContaining('502'),
        });
        expect(categorizeHttpError(418, undefined).errorType).toBe('other');
    });

    it('categorises thrown fetch errors', () => {
        expect(
            categorizeFetchError(
                Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
            ).errorType,
        ).toBe('timeout');
        expect(
            categorizeFetchError(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })).errorType,
        ).toBe('dns');
        expect(
            categorizeFetchError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })).errorType,
        ).toBe('network');
        expect(categorizeFetchError(new Error('weird')).errorType).toBe('other');
    });
});

describe('fetchPsi', () => {
    const jsonResponse = (status: number, body: unknown): Response =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    it('returns the parsed body on 200 and passes the request URL with the key', async () => {
        let requested = '';
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            fetchImpl: async (input) => {
                requested = String(input);
                return jsonResponse(200, fixture);
            },
        });
        expect(result.ok).toBe(true);
        expect(new URL(requested).searchParams.get('key')).toBe('K');
        if (result.ok) expect(result.response.lighthouseResult?.lighthouseVersion).toBe('12.8.2');
    });

    it('retries once on 429 and then reports rate-limited', async () => {
        let calls = 0;
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            retryDelayMs: 1,
            fetchImpl: async () => {
                calls += 1;
                return jsonResponse(429, rateLimited);
            },
        });
        expect(calls).toBe(2);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errorType).toBe('rate-limited');
            expect(result.statusCode).toBe(429);
            expect(result.attempts).toBe(2);
        }
    });

    it('recovers when the retry succeeds', async () => {
        let calls = 0;
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            retryDelayMs: 1,
            fetchImpl: async () => {
                calls += 1;
                return calls === 1 ? jsonResponse(503, { error: { message: 'backend' } }) : jsonResponse(200, fixture);
            },
        });
        expect(result.ok).toBe(true);
        expect(result.attempts).toBe(2);
    });

    it('does not retry deterministic Lighthouse page failures (HTTP 500 FAILED_DOCUMENT_REQUEST)', async () => {
        let calls = 0;
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            retryDelayMs: 1,
            fetchImpl: async () => {
                calls += 1;
                return jsonResponse(500, failedDocument);
            },
        });
        expect(calls).toBe(1);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errorType).toBe('http-error');
    });

    it('reports a non-JSON 200 as a failure instead of billing it', async () => {
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            fetchImpl: async () => new Response('<html>oops</html>', { status: 200 }),
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errorType).toBe('other');
    });

    it('categorises thrown network errors and retries them once', async () => {
        let calls = 0;
        const result = await fetchPsi('https://example.com/', 'mobile', ['performance'], {
            apiKey: 'K',
            retryDelayMs: 1,
            fetchImpl: async () => {
                calls += 1;
                throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
            },
        });
        expect(calls).toBe(2);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errorType).toBe('network');
    });

    it('serves the fixture in mock mode with the URL and strategy rewritten', async () => {
        const result = await fetchPsi('https://www.wikipedia.org/', 'desktop', ['performance'], {
            apiKey: '',
            mock: true,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.response.lighthouseResult?.finalUrl).toBe('https://www.wikipedia.org/');
            expect(result.response.lighthouseResult?.configSettings?.formFactor).toBe('desktop');
        }
        const dns = await loadMockResponse('https://this-domain-does-not-exist-abc123.com/', 'mobile');
        expect(dns.status).toBe(500);
        expect(categorizeHttpError(dns.status, dns.body).errorType).toBe('dns');
    });
});

describe('runPool', () => {
    it('limits concurrency and processes every item', async () => {
        let inFlight = 0;
        let peak = 0;
        const done: number[] = [];
        const result = await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 5));
            done.push(n);
            inFlight -= 1;
        });
        expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(peak).toBe(3);
        expect(result).toEqual({ started: 7, skipped: 0 });
    });

    it('stops handing out work when shouldStop flips', async () => {
        let stop = false;
        const result = await runPool(
            [1, 2, 3, 4, 5],
            1,
            async (n) => {
                if (n === 2) stop = true;
            },
            () => stop,
        );
        expect(result).toEqual({ started: 2, skipped: 3 });
    });

    it('handles an empty list', async () => {
        expect(await runPool([], 4, async () => {})).toEqual({ started: 0, skipped: 0 });
    });
});
