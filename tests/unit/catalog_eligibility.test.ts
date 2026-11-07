import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleCatalogCandidate } from '../../src/platform/changdu_catalog.ts';

describe('常读列表候选资格', () => {
    const base = { status: '已发布', authStatus: '普通授权', deliveryStatus: '可投放' } as const;

    test('仅明确可投放、已发布且已授权的候选可进入后续流程', () => {
        assert.equal(isEligibleCatalogCandidate(base), true);
        assert.equal(isEligibleCatalogCandidate({ ...base, authStatus: '独家授权' }), true);
        assert.equal(isEligibleCatalogCandidate({ ...base, deliveryStatus: '未知' }), false);
        assert.equal(isEligibleCatalogCandidate({ ...base, deliveryStatus: '不可投放' }), false);
        assert.equal(isEligibleCatalogCandidate({ ...base, status: '未发布' }), false);
        assert.equal(isEligibleCatalogCandidate({ ...base, authStatus: '无授权' }), false);
    });
});
