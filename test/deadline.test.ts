import { describe, expect, it } from 'vitest';

import { auditBudget, MIN_AUDIT_MS, RUN_TIMEOUT_RESERVE_MS } from '../src/deadline.js';

const now = Date.parse('2026-09-24T12:00:00Z');
const at = (msFromNow: number) => new Date(now + msFromNow);

describe('auditBudget', () => {
    it('uses the full request timeout with a retry when the run has no timeout', () => {
        expect(auditBudget(null, 120_000, now)).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
        expect(auditBudget(undefined, 120_000, now)).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
        expect(auditBudget(new Date('nope'), 120_000, now)).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
    });

    it('keeps the retry when two attempts fit before the run timeout', () => {
        expect(auditBudget(at(3_600_000), 120_000, now)).toEqual({ timeoutMs: 120_000, maxRetries: 1 });
    });

    it('drops the retry and caps the request timeout when time is short', () => {
        const budget = auditBudget(at(100_000), 120_000, now);
        expect(budget).toEqual({ timeoutMs: 100_000 - RUN_TIMEOUT_RESERVE_MS, maxRetries: 0 });
    });

    it('refuses to start an audit when less than the minimum is left', () => {
        expect(auditBudget(at(RUN_TIMEOUT_RESERVE_MS + MIN_AUDIT_MS - 1), 120_000, now)).toBeNull();
        expect(auditBudget(at(-5_000), 120_000, now)).toBeNull();
        expect(auditBudget(at(RUN_TIMEOUT_RESERVE_MS + MIN_AUDIT_MS), 120_000, now)).not.toBeNull();
    });
});
