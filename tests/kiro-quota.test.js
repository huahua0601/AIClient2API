import { normalizeKiroQuota } from '../src/providers/claude/kiro-quota.js';

const now = Date.UTC(2026, 10, 13);
const pool = (used, limit, extra = {}) => ({ currentUsage: used, usageLimit: limit, ...extra });
const usage = extra => ({ usageBreakdownList: [{ resourceType: 'AGENTIC_REQUEST', ...pool(10, 50), ...extra }] });

test('sums precise credits, active trial and bonuses, excluding expired and unrelated resources', () => {
    const data = usage({
        currentUsageWithPrecision: 10.125,
        freeTrialInfo: pool(20.25, 500, { freeTrialStatus: 'ACTIVE', freeTrialExpiry: now / 1000 + 60 }),
        bonuses: [
            pool('3.5', '100', { status: 'ACTIVE', expiresAt: now + 60_000 }),
            pool(7, 80, { status: 'EXPIRED' }),
            pool(7, 80, { status: 'ACTIVE', expiresAt: now - 1 }),
            pool(7, 80, { status: 'INACTIVE' })
        ]
    });
    data.usageBreakdownList.push({ resourceType: 'STORAGE', ...pool(1000, 2000) });
    expect(normalizeKiroQuota(data, now)).toMatchObject({
        available: true, totalUsed: 33.875, totalLimit: 650, remaining: 616.125, unit: 'credits'
    });
});

test('does not count an expired trial even when its status is still active', () => {
    expect(normalizeKiroQuota(usage({ freeTrialInfo: pool(20, 500, {
        freeTrialStatus: 'ACTIVE', freeTrialExpiry: new Date(now - 1).toISOString()
    }) }), now)).toMatchObject({ totalUsed: 10, totalLimit: 50 });
});

test('preserves zero precision and over-limit usage', () => {
    expect(normalizeKiroQuota(usage({ currentUsageWithPrecision: 0, usageLimitWithPrecision: 0 })))
        .toMatchObject({ available: true, totalUsed: 0, totalLimit: 0 });
    expect(normalizeKiroQuota(usage({ currentUsage: 60 })))
        .toMatchObject({ totalUsed: 60, totalLimit: 50, remaining: 0 });
});

test.each([null, {}, { usageBreakdownList: {} }, usage({ currentUsage: null }),
    usage({ usageLimit: '' }), usage({ currentUsage: 'bad' })])('missing or invalid data is unavailable: %p', data => {
    expect(normalizeKiroQuota(data)).toEqual({ available: false });
});

test('supports the alternate breakdown field and long-lived bonus pools', () => {
    const data = usage({ bonuses: [pool(1, 100, { status: 'ACTIVE', expiresAt: now + 365 * 86400000 })] });
    expect(normalizeKiroQuota({ usageBreakdown: data.usageBreakdownList }, now))
        .toMatchObject({ totalUsed: 11, totalLimit: 150 });
});

test('accepts current Kiro CREDIT resource type', () => {
    expect(normalizeKiroQuota({ usageBreakdownList: [{ resourceType: 'CREDIT', currentUsageWithPrecision: 178.14, usageLimitWithPrecision: 10000 }] })).toMatchObject({ available: true, totalUsed: 178.14, totalLimit: 10000 });
});
