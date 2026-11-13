export const PROVIDER_QUOTA_CACHE_TTL_MS = 60_000;

export function createProviderQuotaClient({ providerType, apiClient, now = () => Date.now(), maxConcurrentRequests = 4 } = {}) {
    const cache = new Map();
    const requests = new Map();
    const waiting = [];
    const concurrencyLimit = Math.max(1, Number(maxConcurrentRequests) || 4);
    let activeRequests = 0;

    function runWithConcurrency(task) {
        return new Promise((resolve, reject) => {
            const run = () => {
                Promise.resolve().then(task).then(resolve, reject).finally(() => {
                    const next = waiting.shift();
                    if (next) next();
                    else activeRequests -= 1;
                });
            };

            if (activeRequests < concurrencyLimit) {
                activeRequests += 1;
                run();
            } else {
                waiting.push(run);
            }
        });
    }

    function getQuota(providerUuid, { forceRefresh = false } = {}) {
        if (!providerUuid) return Promise.resolve({ error: true });
        const cached = cache.get(providerUuid);
        if (!forceRefresh && cached && now() - cached.cachedAt < PROVIDER_QUOTA_CACHE_TTL_MS) {
            return Promise.resolve(cached.result);
        }

        const inFlight = requests.get(providerUuid);
        if (inFlight) return inFlight;

        const request = runWithConcurrency(() => apiClient.get(
            `/providers/${encodeURIComponent(providerType)}/${encodeURIComponent(providerUuid)}/quota`
        ))
            .then(response => ({ response }))
            .catch(() => ({ error: true }))
            .then(result => {
                cache.set(providerUuid, { cachedAt: now(), result });
                return result;
            })
            .finally(() => requests.delete(providerUuid));
        requests.set(providerUuid, request);
        return request;
    }

    return { getQuota };
}
