import { setTimeout as sleep } from 'node:timers/promises';

import { Actor, log } from 'apify';

import { fetchPsi } from './client.js';
import { runPool } from './pool.js';
import {
    type Category,
    type FailureItem,
    normalizeUrl,
    parsePsiResponse,
    PsiResponseError,
    resolveCategories,
    resolveStrategies,
    type Strategy,
} from './psi.js';

const CHARGE_EVENT = 'audit';
const MISSING_KEY_MESSAGE =
    'No Google API key available. Add your free PageSpeed Insights API key to the "apiKey" input ' +
    '(https://developers.google.com/speed/docs/insights/v5/get-started) or set the PSI_API_KEY environment variable.';

interface Input {
    urls?: (string | { url: string })[];
    strategy?: string;
    categories?: string[];
    includeAuditDetails?: boolean;
    apiKey?: string;
    maxConcurrency?: number;
    timeoutSecs?: number;
}

interface Task {
    url: string;
    originalUrl: string;
    strategy: Strategy;
}

await Actor.init();

let aborting = false;
Actor.on('aborting', async () => {
    aborting = true;
    await sleep(1000);
    await Actor.exit();
});

const input = (await Actor.getInput<Input>()) ?? {};
const strategies = resolveStrategies(input.strategy);
if (!strategies) {
    await Actor.fail(`Input "strategy" must be "mobile", "desktop" or "both" (got "${input.strategy}").`);
}
const categories: Category[] = resolveCategories(input.categories);
const includeAuditDetails = input.includeAuditDetails ?? false;
const maxConcurrency = Math.min(Math.max(Math.floor(input.maxConcurrency ?? 4), 1), 10);
const timeoutSecs = Math.min(Math.max(input.timeoutSecs ?? 120, 30), 300);
const mock = process.env.PSI_MOCK === '1';
const apiKey = (input.apiKey ?? process.env.PSI_API_KEY ?? '').trim();

const rawUrls = (input.urls ?? []).map((u) => (typeof u === 'string' ? u : (u?.url ?? '')));
if (rawUrls.length === 0) {
    await Actor.fail('Input "urls" is empty. Provide at least one page URL, e.g. ["https://example.com"].');
}

// Validate and de-duplicate URLs; invalid ones become free failure records immediately.
const seen = new Set<string>();
const tasks: Task[] = [];
const earlyFailures: FailureItem[] = [];
for (const raw of rawUrls) {
    const normalized = normalizeUrl(raw);
    if (!normalized) {
        earlyFailures.push({
            url: raw,
            strategy: null,
            success: false,
            errorType: 'invalid-url',
            error: 'Not a valid public http(s) URL',
            fetchedAt: new Date().toISOString(),
        });
        continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    for (const strategy of strategies!) tasks.push({ url: normalized, originalUrl: raw, strategy });
}
if (earlyFailures.length) await Actor.pushData(earlyFailures);

const chargingManager = Actor.getChargingManager();
const { isPayPerEvent } = chargingManager.getPricingInfo();
let audited = 0;
let charged = 0;
let failed = earlyFailures.length;
let stopBecauseOfBudget = false;

if (!apiKey && !mock) {
    // Friendly, free failure records instead of a crash: the run finishes and the user sees exactly what to do.
    log.error(MISSING_KEY_MESSAGE);
    const items: FailureItem[] = tasks.map((t) => ({
        url: t.originalUrl,
        strategy: t.strategy,
        success: false,
        errorType: 'missing-api-key',
        error: MISSING_KEY_MESSAGE,
        fetchedAt: new Date().toISOString(),
    }));
    if (items.length) await Actor.pushData(items);
    failed += items.length;
} else {
    if (mock)
        log.warning('PSI_MOCK=1: serving the bundled fixture instead of calling Google. Do not use in production.');
    let keySource = 'environment';
    if (input.apiKey) keySource = 'input';
    else if (mock) keySource = 'mock';
    log.info(
        `Auditing ${seen.size} URL(s) x ${strategies!.join('+')} = ${tasks.length} audit(s), categories [${categories.join(', ')}], concurrency ${maxConcurrency}, ` +
            `key from ${keySource}.`,
    );

    await runPool(
        tasks,
        maxConcurrency,
        async (task) => {
            const started = Date.now();
            const result = await fetchPsi(task.url, task.strategy, categories, {
                apiKey,
                mock,
                timeoutMs: timeoutSecs * 1000,
            });
            const seconds = ((Date.now() - started) / 1000).toFixed(1);

            if (!result.ok) {
                failed += 1;
                const item: FailureItem = {
                    url: task.originalUrl,
                    strategy: task.strategy,
                    success: false,
                    errorType: result.errorType,
                    error: result.error.slice(0, 500),
                    statusCode: result.statusCode,
                    fetchedAt: new Date().toISOString(),
                };
                log.warning(`${task.url} [${task.strategy}]: ${item.errorType} after ${seconds}s - ${item.error}`);
                await Actor.pushData(item); // free of charge
                return;
            }

            let item;
            try {
                item = parsePsiResponse(result.response, {
                    url: task.originalUrl,
                    strategy: task.strategy,
                    categories,
                    includeAuditDetails,
                });
            } catch (err) {
                failed += 1;
                const errorType = err instanceof PsiResponseError ? err.errorType : 'other';
                const item2: FailureItem = {
                    url: task.originalUrl,
                    strategy: task.strategy,
                    success: false,
                    errorType,
                    error: (err as Error).message.slice(0, 500),
                    fetchedAt: new Date().toISOString(),
                };
                log.warning(`${task.url} [${task.strategy}]: ${errorType} - ${item2.error}`);
                await Actor.pushData(item2); // free of charge: the response was not usable
                return;
            }

            const { eventChargeLimitReached } = await Actor.pushData(item, CHARGE_EVENT);
            audited += 1;
            charged += 1;
            const s = item.scores;
            log.info(
                `${item.finalUrl} [${task.strategy}]: perf ${s.performance ?? '-'} / a11y ${s.accessibility ?? '-'} / bp ${s.bestPractices ?? '-'} / seo ${s.seo ?? '-'}, ` +
                    `LCP ${item.labMetrics.lcpMs ?? '-'}ms, CLS ${item.labMetrics.cls ?? '-'}, field ${item.fieldData?.overallCategory ?? 'n/a'} (${seconds}s)`,
            );
            if (eventChargeLimitReached) {
                stopBecauseOfBudget = true;
                log.warning(
                    'Maximum charge limit for this run reached; stopping early. Raise the run cost limit to audit more URLs.',
                );
            }
        },
        () => stopBecauseOfBudget || aborting,
    );
}

const summary = {
    requested: rawUrls.length,
    strategies: strategies!,
    categories,
    plannedAudits: tasks.length,
    audited,
    failed,
    skipped: Math.max(tasks.length - audited - (failed - earlyFailures.length), 0),
    chargedEvents: isPayPerEvent ? charged : undefined,
    stoppedEarlyDueToBudget: stopBecauseOfBudget,
};
await Actor.setValue('SUMMARY', summary);
log.info(`Done. ${JSON.stringify(summary)}`);

await Actor.exit();
