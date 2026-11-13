import { createProviderQuotaClient } from './provider-quota-client.js';

export function createKiroQuotaBadgeLoader({ apiClient, translate: t, now } = {}) {
    const client = createProviderQuotaClient({ apiClient, now, providerType: 'claude-kiro-oauth' });
    const format = value => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

    function render(badge, result) {
        if (badge.isConnected === false) return;
        const quota = result?.response?.quota;
        if (result?.error || !quota?.available ||
            !Number.isFinite(quota.totalUsed) || !Number.isFinite(quota.totalLimit)) {
            badge.textContent = t('providers.kiroQuota.unavailable');
            badge.title = t('providers.kiroQuota.refresh');
            return;
        }
        badge.textContent = t('providers.kiroQuota.used', {
            used: format(quota.totalUsed), limit: format(quota.totalLimit)
        });
        badge.title = t('providers.kiroQuota.details', {
            remaining: format(Math.max(0, quota.totalLimit - quota.totalUsed))
        });
    }

    async function loadBadge(badge, forceRefresh = false) {
        badge.disabled = true;
        badge.setAttribute('aria-busy', 'true');
        badge.textContent = t('providers.kiroQuota.loading');
        const result = await client.getQuota(badge.dataset.providerUuid, { forceRefresh });
        render(badge, result);
        badge.disabled = false;
        badge.setAttribute('aria-busy', 'false');
    }

    return function loadKiroQuotaBadges(container) {
        const badges = Array.from(container.querySelectorAll('.kiro-quota-badge[data-provider-uuid]'));
        return Promise.all(badges.map(badge => {
            badge.onclick = event => {
                event.stopPropagation();
                return loadBadge(badge, true);
            };
            return loadBadge(badge);
        }));
    };
}
