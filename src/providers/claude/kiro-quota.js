// Kiro reports credits for AGENTIC_REQUEST, including separate trial/bonus pools.
export function normalizeKiroQuota(usage = {}, now = Date.now()) {
    const number = value => {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const timestamp = value => {
        if (value === null || value === undefined || value === '') return null;
        const numeric = Number(value);
        const parsed = Number.isFinite(numeric)
            ? numeric * (numeric < 1e12 ? 1000 : 1) : Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const items = [];
    let invalid = false;
    const add = (pool, type, expiry, status) => {
        const expiresAt = timestamp(expiry);
        if ((status && status !== 'ACTIVE') || (expiresAt !== null && expiresAt <= now)) return;
        const used = number(pool.currentUsageWithPrecision ?? pool.currentUsage);
        const limit = number(pool.usageLimitWithPrecision ?? pool.usageLimit);
        if (used === null || limit === null) { invalid = true; return; }
        items.push({ type, used, limit });
    };
    const breakdowns = usage?.usageBreakdownList ?? usage?.usageBreakdown;
    if (Array.isArray(breakdowns)) {
        for (const breakdown of breakdowns) {
            if (!['AGENTIC_REQUEST', 'CREDIT'].includes(breakdown?.resourceType)) continue;
            add(breakdown, 'base');
            if (breakdown.freeTrialInfo) {
                const trial = breakdown.freeTrialInfo;
                add(trial, 'trial', trial.freeTrialExpiry, trial.freeTrialStatus);
            }
            if (Array.isArray(breakdown.bonuses)) {
                for (const bonus of breakdown.bonuses) {
                    if (bonus) add(bonus, 'bonus', bonus.expiresAt, bonus.status);
                }
            }
        }
    }
    if (invalid || items.length === 0) return { available: false };
    const totalUsed = items.reduce((sum, item) => sum + item.used, 0);
    const totalLimit = items.reduce((sum, item) => sum + item.limit, 0);
    return {
        available: true,
        totalUsed,
        totalLimit,
        remaining: Math.max(0, totalLimit - totalUsed),
        unit: 'credits',
        items
    };
}
