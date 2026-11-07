// ============================================================
// Unit Tests: Drama Conflict Guard (Duplicate Drama Tracking & Query)
// ============================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    conflictDramaGuard,
    recordConflictDramas,
    parseConflictPairsFromMessage,
    getDramaConflict,
    isDramaConflict,
    clearConflictDramaGuard,
    loadConflictDramaGuard,
    reloadConflictDramaGuard,
} from '../../src/core/conflict_guard.ts';
import { CONFLICT_DRAMAS_PATH } from '../../src/core/paths.ts';

describe('DramaConflictGuard: 重复剧目冲突记录与预检', () => {
    beforeEach(() => {
        clearConflictDramaGuard();
    });

    test('初始状态为空，查询返回 null', () => {
        assert.equal(isDramaConflict('7684258927520778290'), false);
        assert.equal(getDramaConflict('7684258927520778290'), null);
    });

    test('recordConflictDramas 正确记录并持久化到文件', () => {
        const pairs = [
            { dramaId: '7684258927520778290', douyinAccount: '50458806167', taskId: '63060845' },
            { dramaId: '7684258927520778290', douyinAccount: '83886947981', taskId: '63060845' },
            { dramaId: '7644507297226213385', douyinAccount: '36180162413', taskId: '58041371' },
        ];
        const reason = '投手参数校验失败:已被其它任务创建过项目';
        const meta = {
            dramaNameMap: {
                '7684258927520778290': '母亲是巨龙我却是山海异兽第一季',
                '7644507297226213385': '侯门错嫁遇良人',
            },
        };

        const added = recordConflictDramas(pairs, reason, meta);
        assert.equal(added, 3);

        // 验证内存状态
        assert.equal(isDramaConflict('7684258927520778290'), true);
        assert.equal(isDramaConflict('7644507297226213385'), true);
        assert.equal(isDramaConflict('9999999999999999999'), false);

        // 验证精确匹配指定抖音号
        const matchAccount = getDramaConflict('7684258927520778290', '50458806167');
        assert.ok(matchAccount);
        assert.equal(matchAccount?.douyinAccount, '50458806167');
        assert.equal(matchAccount?.taskId, '63060845');
        assert.equal(matchAccount?.dramaName, '母亲是巨龙我却是山海异兽第一季');

        // 验证指定未冲突的抖音号时返回 null
        const noMatchAccount = getDramaConflict('7684258927520778290', '99999999999');
        assert.equal(noMatchAccount, null);

        // 验证按剧名匹配
        const matchByName = getDramaConflict('母亲是巨龙我却是山海异兽第一季');
        assert.ok(matchByName);
        assert.equal(matchByName?.dramaId, '7684258927520778290');

        // 验证文件持久化
        assert.ok(fs.existsSync(CONFLICT_DRAMAS_PATH));
        const disk = loadConflictDramaGuard();
        assert.ok(disk.items['7684258927520778290']);
        assert.equal(disk.items['7684258927520778290'].length, 2);
    });

    test('重复记录同剧目+同抖音号时更新信息并去重', () => {
        recordConflictDramas(
            [{ dramaId: '7684258927520778290', douyinAccount: '50458806167', taskId: '1111' }],
            '首次冲突'
        );
        assert.equal(conflictDramaGuard.items['7684258927520778290'].length, 1);
        assert.equal(conflictDramaGuard.items['7684258927520778290'][0].taskId, '1111');

        // 再次记录相同 pair，更新 taskId 和 reason，不重复追加
        const added = recordConflictDramas(
            [{ dramaId: '7684258927520778290', douyinAccount: '50458806167', taskId: '2222' }],
            '二次冲突'
        );
        assert.equal(added, 0);
        assert.equal(conflictDramaGuard.items['7684258927520778290'].length, 1);
        assert.equal(conflictDramaGuard.items['7684258927520778290'][0].taskId, '2222');
        assert.equal(conflictDramaGuard.items['7684258927520778290'][0].reason, '二次冲突');
    });

    test('reloadConflictDramaGuard 能读取磁盘上的最新记录', () => {
        fs.writeFileSync(
            CONFLICT_DRAMAS_PATH,
            JSON.stringify({
                version: 1,
                items: {
                    '7685229971061377059': [
                        {
                            dramaId: '7685229971061377059',
                            douyinAccount: '36180162413',
                            taskId: '65051001',
                            dramaName: '糯糯下山',
                            reason: '测试冲突',
                            recordedAt: new Date().toISOString(),
                        },
                    ],
                },
            }),
            'utf8'
        );

        reloadConflictDramaGuard();
        assert.equal(isDramaConflict('7685229971061377059'), true);
        assert.equal(isDramaConflict('糯糯下山'), true);
        const record = getDramaConflict('7685229971061377059');
        assert.equal(record?.douyinAccount, '36180162413');
        assert.equal(record?.taskId, '65051001');
    });

    test('损坏的文件读取失败时安全降级', () => {
        fs.writeFileSync(CONFLICT_DRAMAS_PATH, 'invalid json content!!!', 'utf8');
        const store = loadConflictDramaGuard();
        assert.equal(store.loadFailed, true);
        assert.deepEqual(store.items, {});
    });

    test('parseConflictPairsFromMessage 与 recordConflictDramas 正确解析单剧目与多剧目冲突信息', () => {
        const singleMsg = '投手参数校验失败:剧目 7690205370731464730 + 抖音号 37658739142 已被任务 66542003 创建过项目, 请勿重复配置, 请稍后重试';
        const parsedSingle = parseConflictPairsFromMessage(singleMsg);
        assert.deepEqual(parsedSingle, [{
            dramaId: '7690205370731464730',
            douyinAccount: '37658739142',
            taskId: '66542003',
        }]);

        const multiMsg = '投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目，请勿重复配置：剧目 7665000000000000001+抖音号 30200000001（任务 65000001）、剧目 7665000000000000001+抖音号 42800000002（任务 65000001）';
        const parsedMulti = parseConflictPairsFromMessage(multiMsg);
        assert.deepEqual(parsedMulti, [
            { dramaId: '7665000000000000001', douyinAccount: '30200000001', taskId: '65000001' },
            { dramaId: '7665000000000000001', douyinAccount: '42800000002', taskId: '65000001' },
        ]);

        const added = recordConflictDramas(['7690205370731464730'], singleMsg, {
            dramaNameMap: { '7690205370731464730': '测试短剧' },
        });
        assert.equal(added, 1);
        const record = getDramaConflict('7690205370731464730', '37658739142');
        assert.ok(record);
        assert.equal(record?.douyinAccount, '37658739142');
        assert.equal(record?.taskId, '66542003');
        assert.equal(record?.dramaName, '测试短剧');
    });
});
