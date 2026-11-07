import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRequestSchema, configRequestSchema, parseInput } from '../../src/core/validation.ts';
import { validateOpenApiEnvelope, validateOpenApiRecords } from '../../src/platform/changdu_schema.ts';
import { transitionTask, type TaskStatus } from '../../src/core/task_state.ts';
import { formatRoiRatio } from '../../src/web/client/src/utils/formatters.ts';

test('配置校验拒绝非法类型、链接、ROI 和旧续搭参数，长 ID 保持字符串', () => {
    const url = 'https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=123';
    const valid = { keywords: [' 1234567890123456789 '], copyPageUrls: [url], roiRatio: '1.20', paidTemplate: '中额' };
    assert.deepEqual(parseInput(startRequestSchema, valid).keywords, ['1234567890123456789']);
    assert.equal(parseInput(startRequestSchema, { ...valid, roiRatio: '100' }).roiRatio, '100');
    for (const invalid of [null, [], { keywords: 'A' }, { keywords: [1234567890123456789] },
        { keywords: [''] }, { keywords: ['A\nB'] }, { keywords: [] }, { copyPageUrls: [] },
        { roiRatio: 'Infinity' }, { roiRatio: '-1' }, { roiRatio: '0' }, { roiRatio: '1e3' },
        { roiRatio: '100.01' }, { roiRatio: '101' },
        { paidTemplate: 'unknown' }, { resumeFromCheckpoint: true },
        ...['javascript:alert(1)', 'http://usergrowth.com.cn/onestop/ad/ad_create/copy',
            'https://usergrowth.com.cn.evil.test/onestop/ad/ad_create/copy', 'https://usergrowth.com.cn/other',
            'https://name:pass@usergrowth.com.cn/onestop/ad/ad_create/copy'].map(link => ({ copyPageUrls: [link] }))]) {
        assert.throws(() => parseInput(startRequestSchema, invalid), /参数校验失败/);
    }
    assert.deepEqual(parseInput(configRequestSchema, { keywords: [], copyUrls: [], roiRatio: 1.2 }),
        { keywords: [], copyUrls: [], roiRatio: '1.2' });
});

test('前端 ROI 输入保留后端允许的精度，也不会把非法输入改成默认值', () => {
    assert.equal(formatRoiRatio(' 0.001 '), '0.001');
    assert.equal(parseInput(configRequestSchema, { roiRatio: formatRoiRatio(' 0.001 ') }).roiRatio, '0.001');
    assert.equal(formatRoiRatio('1abc'), '1abc');
    assert.throws(() => parseInput(configRequestSchema, { roiRatio: formatRoiRatio('1abc') }), /参数校验失败/);
});

test('OpenAPI 响应校验阻断错误分页类型及损失精度的 ID，兼容未知扩展字段', () => {
    for (const value of [null, [], { code: '200' }, { code: 200, total: '0' },
        { code: 200, has_more: 'false' }, { code: 200, is_truncated: 1 }]) {
        assert.throws(() => validateOpenApiEnvelope(value), /无效/);
    }
    const longId = '9223372036854775807';
    assert.equal(validateOpenApiRecords([{ book_id: longId, extension: true }])[0].book_id, longId);
    for (const value of [[null], [{ book_id: Number(longId) }], [{ playlet_id: {} }],
        [{ book_name: 123 }]]) assert.throws(() => validateOpenApiRecords(value), /结构无效/);
});

test('任务成功必须经过整页提交，终态不能改写为可重试失败', () => {
    const item: { status: TaskStatus } = { status: 'pending' };
    transitionTask(item, 'running'); transitionTask(item, 'filled');
    assert.throws(() => transitionTask(item, 'success'), /无效/);
    transitionTask(item, 'submitting'); transitionTask(item, 'uncertain');
    assert.throws(() => transitionTask(item, 'failed'), /无效/);
});

test('等待中的任务允许预检失败，但不能直接成功或重新运行失败任务', () => {
    const item: { status: TaskStatus } = { status: 'pending' };
    assert.throws(() => transitionTask(item, 'success'), /无效/);
    transitionTask(item, 'failed');
    assert.equal(item.status, 'failed');
    assert.throws(() => transitionTask(item, 'running'), /无效/);
});
