import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
    buildPsiUrl,
    categorizeFetchError,
    categorizeHttpError,
    type Category,
    type ErrorType,
    type PsiResponse,
    type Strategy,
} from './psi.js';

export type PsiFetchResult =
    | { ok: true; response: PsiResponse; attempts: number }
    | { ok: false; errorType: ErrorType; error: string; statusCode?: number; attempts: number };

export interface PsiClientOptions {
    apiKey: string;
    /** Total time budget per request. PSI itself typically takes 10-60 s. */
    timeoutMs?: number;
    /** Extra attempts for transient failures (429 / 5xx / network). */
    maxRetries?: number;
    /** Base delay between retries in ms (doubles each attempt). */
    retryDelayMs?: number;
    /** Test-only: serve the bundled fixture instead of calling Google. Enabled by PSI_MOCK=1. */
    mock?: boolean;
    fetchImpl?: typeof fetch;
}

const TRANSIENT: ErrorType[] = ['rate-limited', 'network', 'timeout'];

function isTransientStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Loads test/fixtures/psi-response.json and rewrites the URL / strategy so the pipeline can be exercised
 * end-to-end without an API key. Hostnames containing "does-not-exist" or ending in ".invalid" simulate a
 * Lighthouse DNS failure so the failure path is covered too.
 */
export async function loadMockResponse(
    url: string,
    strategy: Strategy,
): Promise<{ status: number; body: PsiResponse }> {
    const fixturesDir = new URL('../test/fixtures/', import.meta.url);
    const { hostname } = new URL(url);
    if (hostname.includes('does-not-exist') || hostname.endsWith('.invalid')) {
        const body = JSON.parse(
            await readFile(fileURLToPath(new URL('psi-error-failed-document.json', fixturesDir)), 'utf8'),
        ) as PsiResponse;
        body.error!.message = body.error!.message!.replace('FAILED_DOCUMENT_REQUEST', 'DNS_FAILURE');
        return { status: 500, body };
    }
    const body = JSON.parse(
        await readFile(fileURLToPath(new URL('psi-response.json', fixturesDir)), 'utf8'),
    ) as PsiResponse;
    body.id = url;
    body.loadingExperience!.id = url;
    body.loadingExperience!.initial_url = url;
    body.lighthouseResult!.requestedUrl = url;
    body.lighthouseResult!.finalUrl = url;
    body.lighthouseResult!.finalDisplayedUrl = url;
    body.lighthouseResult!.configSettings!.emulatedFormFactor = strategy;
    body.lighthouseResult!.configSettings!.formFactor = strategy;
    body.analysisUTCTimestamp = new Date().toISOString();
    // Simulate the network latency of a real audit so concurrency behaviour is realistic.
    await sleep(150);
    return { status: 200, body };
}

export async function fetchPsi(
    url: string,
    strategy: Strategy,
    categories: Category[],
    options: PsiClientOptions,
): Promise<PsiFetchResult> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const maxRetries = options.maxRetries ?? 1;
    const retryDelayMs = options.retryDelayMs ?? 3000;
    const fetchImpl = options.fetchImpl ?? fetch;
    const requestUrl = buildPsiUrl(url, strategy, categories, options.apiKey);

    let last: PsiFetchResult | undefined;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        if (attempt > 1) await sleep(retryDelayMs * 2 ** (attempt - 2));
        try {
            let status: number;
            let text: string;
            if (options.mock) {
                const mocked = await loadMockResponse(url, strategy);
                status = mocked.status;
                text = JSON.stringify(mocked.body);
            } else {
                const res = await fetchImpl(requestUrl, {
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: { accept: 'application/json' },
                });
                status = res.status;
                text = await res.text();
            }

            let body: PsiResponse | undefined;
            try {
                body = JSON.parse(text) as PsiResponse;
            } catch {
                body = undefined;
            }

            if (status >= 200 && status < 300) {
                if (!body || typeof body !== 'object') {
                    return {
                        ok: false,
                        errorType: 'other',
                        error: 'PageSpeed Insights returned a non-JSON response',
                        statusCode: status,
                        attempts: attempt,
                    };
                }
                return { ok: true, response: body, attempts: attempt };
            }

            const categorized = categorizeHttpError(status, body, text);
            last = { ok: false, ...categorized, statusCode: status, attempts: attempt };
            // Lighthouse page-load failures come back as HTTP 500 but are deterministic: do not retry those.
            const lighthouseFailure = /Lighthouse returned error/i.test(body?.error?.message ?? '');
            if (!isTransientStatus(status) || lighthouseFailure) return last;
        } catch (err) {
            const categorized = categorizeFetchError(err);
            last = { ok: false, ...categorized, attempts: attempt };
            if (!TRANSIENT.includes(categorized.errorType)) return last;
        }
    }
    return last!;
}
