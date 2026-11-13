// Optional extension to token usage. Credits are provider units, not USD cost.
export function creditUsageFields(usage) {
    const credits = usage?.credits;
    return typeof credits === 'number' && Number.isFinite(credits) && credits >= 0
        ? { credits } : {};
}

export function readKiroMeteringCredits(event) {
    if (!['credit', 'credits'].includes(event?.unit)) return null;
    const value = event.usage;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
