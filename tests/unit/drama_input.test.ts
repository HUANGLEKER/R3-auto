import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { needsFreeDramaList, parseDramaInput, classifyDramaInputs } from '../../src/core/drama_input.ts';

describe('Drama Input: 剧名与 ID 输入识别', () => {
    test('长数字和带 ID 前缀的输入识别为直连 ID', () => {
        assert.deepEqual(parseDramaInput('7676052763846921240'), {
            raw: '7676052763846921240', kind: 'ambiguous_id', id: '7676052763846921240',
        });
        assert.equal(parseDramaInput('漫剧ID：7676052763846921240').kind, 'book_id');
        assert.equal(parseDramaInput('抖音作品ID：7676052763846921240').kind, 'douyin_id');
        assert.equal(needsFreeDramaList(['7676052763846921240']), false);
    });

    test('只要包含剧名就需要漫剧列表页', () => {
        assert.equal(parseDramaInput('李不走的甜').kind, 'title');
        assert.equal(needsFreeDramaList(['7676052763846921240', '李不走的甜']), true);
    });

    test('空行与空白字符不被误判为剧名，纯 ID 输入识别为 pureId 模式', () => {
        assert.equal(needsFreeDramaList(['7676052763846921240', '', '   ']), false);
        const res1 = classifyDramaInputs(['7676052763846921240', '漫剧ID: 7676052763846921240', '']);
        assert.equal(res1.isPureId, true);
        assert.equal(res1.requiresFreeList, false);
        assert.equal(res1.idCount, 2);
        assert.equal(res1.titleCount, 0);

        const res2 = classifyDramaInputs(['7676052763846921240', '九品县令']);
        assert.equal(res2.isPureId, false);
        assert.equal(res2.requiresFreeList, true);
        assert.equal(res2.idCount, 1);
        assert.equal(res2.titleCount, 1);

        const res3 = classifyDramaInputs(['', '  ']);
        assert.equal(res3.total, 0);
        assert.equal(res3.isPureId, false);
        assert.equal(res3.requiresFreeList, true);
    });
});
