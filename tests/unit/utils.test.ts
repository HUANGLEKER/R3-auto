// ============================================================
// Unit Tests: Core Utils (ID Normalization, JSON Decoding, Panel Match)
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeDouyinId,
    normalizeTitle,
    getPaidPanelCategory,
    isPaidTemplateMatched,
    parseJsonPreserveIds,
} from '../../src/core/utils.ts';

describe('Core Utils: 18~20位长数字与作品ID精度保护', () => {
    test('normalizeDouyinId 正确保留超长数字字符串且不发生精度截断', () => {
        const longId19 = '7384920182746192837';
        const longId20 = '12345678901234567890';
        
        assert.equal(normalizeDouyinId(longId19), longId19);
        assert.equal(normalizeDouyinId(longId20), longId20);
        
        assert.equal(normalizeDouyinId('abc1234567'), '');
        assert.equal(normalizeDouyinId('12345'), '');
        assert.equal(normalizeDouyinId(''), '');
        assert.equal(normalizeDouyinId(null), '');
    });







    test('parseJsonPreserveIds 保持 JSON 中大整数为 String，杜绝超过 2^53-1 精度截断', () => {
        const rawJson = '{"series_id": 7384920182746192837, "playlet_id": 7384920182746192839, "BOOK_ID": 7384920182746192841, "amount": 100}';
        const parsed = parseJsonPreserveIds(rawJson);
        assert.ok(parsed);
        assert.equal(typeof parsed.series_id, 'string');
        assert.equal(parsed.series_id, '7384920182746192837');
        assert.equal(typeof parsed.playlet_id, 'string');
        assert.equal(parsed.playlet_id, '7384920182746192839');
        assert.equal(typeof parsed.BOOK_ID, 'string');
        assert.equal(parsed.BOOK_ID, '7384920182746192841');
        assert.equal(parsed.amount, 100);
    });
});

describe('Core Utils: 付费充值模板与大类同构识别', () => {
    test('getPaidPanelCategory 正确识别四大分类且不混淆超超小额与超小额', () => {
        assert.equal(getPaidPanelCategory('超超小额'), '超超小额');
        assert.equal(getPaidPanelCategory('超超小额（60集以上）'), '超超小额');
        assert.equal(getPaidPanelCategory('超超小额(30集-50集)'), '超超小额');

        assert.equal(getPaidPanelCategory('超小额'), '超小额');
        assert.equal(getPaidPanelCategory('超小额（30集以上）'), '超小额');

        assert.equal(getPaidPanelCategory('小额'), '小额');
        assert.equal(getPaidPanelCategory('小额（50集以上）'), '小额');

        assert.equal(getPaidPanelCategory('中额'), '中额');
        assert.equal(getPaidPanelCategory('中额（30集以上）'), '中额');

        assert.equal(getPaidPanelCategory('未知模板'), null);
    });

    test('isPaidTemplateMatched 支持目标大类与带括号备注的同构匹配', () => {
        assert.equal(isPaidTemplateMatched('超超小额', '超超小额（60集以上）'), true);
        assert.equal(isPaidTemplateMatched('超超小额', '超小额（60集以上）'), false);
        assert.equal(isPaidTemplateMatched('中额', '中额（30集以上）'), true);
        assert.equal(isPaidTemplateMatched('中额', '小额（30集以上）'), false);
    });


});

describe('Core Utils: 文本清洗', () => {
    test('normalizeTitle 移除非法控制字符并保留中文及标点', () => {
        const cleaned = normalizeTitle('《都市极品医仙》\x00\x1F');
        assert.equal(cleaned, '《都市极品医仙》');
        assert.equal(normalizeTitle('剧名<script>alert(1)</script>'), '剧名scriptalert(1)/script');
    });


});
