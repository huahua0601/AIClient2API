import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKiroQuotaBadgeLoader } from '../../static/app/kiro-quota-badges.js';
import { createProviderQuotaClient } from '../../static/app/provider-quota-client.js';
import { createCodexQuotaClient } from '../../static/app/codex-quota-badges.js';

const translate = (key, values) => key + (values ? JSON.stringify(values) : '');
const badge = uuid => ({ dataset: { providerUuid: uuid }, isConnected: true, setAttribute() {} });
const container = (...badges) => ({ querySelectorAll: () => badges });

test('shows decimals, reuses cached data after rerender and refreshes on click', async () => {
    let calls = 0;
    const apiClient = { get: async path => {
        calls++;
        assert.equal(path, '/providers/claude-kiro-oauth/account%2F1/quota');
        return { quota: { available: true, totalUsed: calls === 1 ? 12.34 : 20, totalLimit: 550 } };
    } };
    const load = createKiroQuotaBadgeLoader({ apiClient, translate });
    const first = badge('account/1');
    await load(container(first));
    assert.match(first.textContent, /12.34/);
    assert.match(first.textContent, /550/);
    assert.equal(first.disabled, false);
    const second = badge('account/1');
    await load(container(second));
    assert.equal(calls, 1);
    let stopped = false;
    await second.onclick({ stopPropagation() { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(calls, 2);
    assert.match(second.textContent, /20/);
});

test('failed request is unavailable and can be retried; zero remains a valid quota', async () => {
    let fail = true;
    const load = createKiroQuotaBadgeLoader({ translate, apiClient: { get: async () => {
        if (fail) throw Error('offline');
        return { quota: { available: true, totalUsed: 0, totalLimit: 0 } };
    } } });
    const target = badge('a');
    await load(container(target));
    assert.equal(target.textContent, 'providers.kiroQuota.unavailable');
    assert.equal(target.disabled, false);
    fail = false;
    await target.onclick({ stopPropagation() {} });
    assert.match(target.textContent, /"used":"0","limit":"0"/);
});

test('limits concurrent queries, deduplicates in-flight requests, and expires cache', async () => {
    let now = 0;
    let calls = 0;
    let active = 0;
    let peak = 0;
    const client = createProviderQuotaClient({ providerType: 'claude-kiro-oauth', now: () => now,
        maxConcurrentRequests: 2, apiClient: { get: async () => {
            calls++; active++; peak = Math.max(peak, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
            return { quota: { available: false } };
        } }
    });
    await Promise.all(['a', 'a', 'b', 'c', 'd', 'e'].map(uuid => client.getQuota(uuid)));
    assert.equal(calls, 5);
    assert.equal(peak, 2);
    await client.getQuota('a');
    assert.equal(calls, 5);
    now = 60_001;
    await client.getQuota('a');
    assert.equal(calls, 6);
});

test('shared client extraction preserves Codex endpoint and cache', async () => {
    const paths = [];
    const client = createCodexQuotaClient({ apiClient: { get: async path => { paths.push(path); return {}; } } });
    await client.getQuota('a/b');
    await client.getQuota('a/b');
    assert.deepEqual(paths, ['/providers/openai-codex-oauth/a%2Fb/quota']);
});
