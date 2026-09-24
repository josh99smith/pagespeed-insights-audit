/** Time kept free before the platform's run timeout so the Actor can push results, write SUMMARY and exit cleanly. */
export const RUN_TIMEOUT_RESERVE_MS = 15_000;
/** Do not start an audit with less time than this; Google needs 10-30 s for a typical page. */
export const MIN_AUDIT_MS = 20_000;

export interface AuditBudget {
    timeoutMs: number;
    maxRetries: number;
}

/**
 * Decides how long the next audit may take given the run's hard timeout (`timeoutAt`, null when the run has none).
 * Returns null when there is not enough time left to start another audit. The per-request timeout is capped so
 * an audit never outlives the run, and the retry is dropped when two attempts would not fit.
 */
export function auditBudget(
    timeoutAt: Date | null | undefined,
    requestTimeoutMs: number,
    now = Date.now(),
    retryDelayMs = 3000,
): AuditBudget | null {
    if (!timeoutAt || Number.isNaN(timeoutAt.getTime())) return { timeoutMs: requestTimeoutMs, maxRetries: 1 };
    const available = timeoutAt.getTime() - now - RUN_TIMEOUT_RESERVE_MS;
    if (available < MIN_AUDIT_MS) return null;
    const timeoutMs = Math.min(requestTimeoutMs, available);
    const maxRetries = timeoutMs * 2 + retryDelayMs <= available ? 1 : 0;
    return { timeoutMs, maxRetries };
}
