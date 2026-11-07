// ============================================================
// Unit Tests: QPS Backoff, Drama Requeue, and Conflict Pre-check
// ============================================================

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isQpsLimitError, createChangduOpenApiClient, ChangduOpenApiError } from '../../src/platform/changdu_openapi.ts';
import { run } from '../../src/runner.ts';
import { clearConflictDramaGuard, recordConflictDramas } from '../../src/core/conflict_guard.ts';

describe('Resilience: 常读 OpenAPI QPS 限制检测与指数退避重试', () => {
    test('isQpsLimitError 正确识别各种 QPS 上限错误', () => {
        assert.equal(isQpsLimitError(new Error('当前集团抖音端原生 OpenAPI QPS 已达上限')), true);
        assert.equal(isQpsLimitError(new ChangduOpenApiError('当前集团抖音端原生 OpenAPI QPS 已达上限', 500, 200, '/test')), true);
        assert.equal(isQpsLimitError('常读 OpenAPI 失败（HTTP 200，code 500）：当前集团抖音端原生 OpenAPI QPS 已达上限'), true);
        assert.equal(isQpsLimitError(new Error('QPS limit exceeded')), true);
        assert.equal(isQpsLimitError(new Error('访问速度过快')), true);
        assert.equal(isQpsLimitError(new ChangduOpenApiError('访问速度过快', 500, 200, '/test')), true);
        assert.equal(isQpsLimitError('常读 OpenAPI 失败（HTTP 200，code 500）：访问速度过快'), true);
        assert.equal(isQpsLimitError(new Error('接口访问速度过快')), true);
        assert.equal(isQpsLimitError({ code: 500, message: '访问速度过快' }), true);
        // 网络层限流中断（fetch failed / timeout 等 HTTP 0 错误）
        assert.equal(isQpsLimitError(new TypeError('fetch failed')), true);
        assert.equal(isQpsLimitError(new ChangduOpenApiError('fetch failed', undefined, 0, '/novelsale/openapi/content/aweme_series/list/v1/')), true);
        assert.equal(isQpsLimitError('常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：fetch failed'), true);
        assert.equal(isQpsLimitError(new Error('The operation was aborted due to timeout')), true);
        assert.equal(isQpsLimitError(new ChangduOpenApiError('The operation was aborted due to timeout', undefined, 0, '/novelsale/openapi/content/aweme_series/list/v1/')), true);
        assert.equal(isQpsLimitError('常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：The operation was aborted due to timeout'), true);
        // 分页提前结束不再视为 QPS 限流错误
        assert.equal(isQpsLimitError(new Error('常读 OpenAPI 分页提前结束')), false);
        assert.equal(isQpsLimitError('常读 OpenAPI 分页提前结束'), false);

        // 非 QPS 错误应返回 false
        assert.equal(isQpsLimitError(new Error('网络连接超时')), false);
        assert.equal(isQpsLimitError(new Error('未查询到对应端原生作品')), false);
        assert.equal(isQpsLimitError(new Error('投手参数校验失败')), false);
        assert.equal(isQpsLimitError(null), false);
    });

    test('持续 QPS 错误在第四次 GET 后耗尽，保留错误上下文且不再等待', async () => {
        const sleeps: number[] = [];
        let requests = 0;
        let currentTime = 1700000000000;
        const endpoint = '/novelsale/openapi/content/aweme_series/list/v1/';
        const client = createChangduOpenApiClient({
            freeDistributorId: '111',
            paidDistributorId: '222',
            secretKey: 'test-only',
            now: () => currentTime,
            sleep: async ms => {
                sleeps.push(ms);
                currentTime += ms;
            },
            fetch: async () => {
                requests++;
                // 若重试上限回归，立即终止测试，避免无限循环。
                if (requests > 4) throw new Error('超过四次请求上限');
                return new Response(JSON.stringify({
                    code: 500,
                    message: `QPS 已达上限，第 ${requests} 次响应`,
                }), { status: 200 });
            },
        });

        await assert.rejects(client.checkOpenApiBookEligibility('free', '7123456789012345678'), error => {
            assert.ok(error instanceof ChangduOpenApiError);
            assert.equal(error.code, 500);
            assert.equal(error.httpStatus, 200);
            assert.equal(error.endpoint, endpoint);
            assert.match(error.message, /QPS 已达上限，第 4 次响应/);
            return true;
        });
        assert.equal(requests, 4);
        assert.equal(sleeps.length, 3, '最后一次失败后不得再退避');
        const bounds = [[1000, 2000], [1500, 3000], [2250, 4500]];
        sleeps.forEach((ms, index) => {
            assert.ok(ms >= bounds[index][0] && ms <= bounds[index][1], `第 ${index + 1} 次退避超出范围: ${ms}ms`);
        });
    });

    test('常读 OpenAPI 遇到 QPS 上限时执行 1~2 秒随机指数退避重试', async () => {
        const calls: any[] = [];
        const sleeps: number[] = [];
        const bookId = '7123456789012345678';
        let currentTime = 1700000000000;

        const client = createChangduOpenApiClient({
            freeDistributorId: '111',
            paidDistributorId: '222',
            secretKey: 'secret',
            now: () => currentTime,
            fetch: async (url, init) => {
                calls.push({ url, init });
                if (calls.length === 1) {
                    return new Response(JSON.stringify({
                        code: 500,
                        message: '当前集团抖音端原生 OpenAPI QPS 已达上限',
                    }), { status: 200 });
                }
                return new Response(JSON.stringify({
                    code: 200,
                    data: [{
                        book_id: bookId, playlet_id: bookId, book_name: '测试',
                        publish_status: 2, permission_status: 4, delivery_status: true,
                    }],
                }), { status: 200 });
            },
            sleep: async ms => {
                sleeps.push(ms);
                currentTime += ms;
            },
        });

        const res = await client.checkOpenApiBookEligibility('free', bookId);
        assert.equal(calls.length, 2);
        assert.equal(sleeps.length, 1);
        // 退避时间应在 1000ms ~ 2000ms 随机区间内
        assert.ok(sleeps[0] >= 1000 && sleeps[0] <= 2000, `Sleep duration ${sleeps[0]} should be between 1000 and 2000ms`);
        assert.equal(res.playletId, bookId);
    });

    test('常读 OpenAPI 遇到“访问速度过快”时执行 1~2 秒随机指数退避重试', async () => {
        const calls: any[] = [];
        const sleeps: number[] = [];
        const bookId = '7123456789012345678';
        let currentTime = 1700000000000;

        const client = createChangduOpenApiClient({
            freeDistributorId: '111',
            paidDistributorId: '222',
            secretKey: 'secret',
            now: () => currentTime,
            fetch: async (url, init) => {
                calls.push({ url, init });
                if (calls.length === 1) {
                    return new Response(JSON.stringify({
                        code: 500,
                        message: '访问速度过快',
                    }), { status: 200 });
                }
                return new Response(JSON.stringify({
                    code: 200,
                    data: [{
                        book_id: bookId, playlet_id: bookId, book_name: '测试',
                        publish_status: 2, permission_status: 4, delivery_status: true,
                    }],
                }), { status: 200 });
            },
            sleep: async ms => {
                sleeps.push(ms);
                currentTime += ms;
            },
        });

        const res = await client.checkOpenApiBookEligibility('free', bookId);
        assert.equal(calls.length, 2);
        assert.equal(sleeps.length, 1);
        assert.ok(sleeps[0] >= 1000 && sleeps[0] <= 2000, `Sleep duration ${sleeps[0]} should be between 1000 and 2000ms`);
        assert.equal(res.playletId, bookId);
    });
});

describe('Orchestration: QPS 错误时剧目重新排队与重复剧预检跳过', () => {
    beforeEach(() => {
        clearConflictDramaGuard();
    });

    test('当剧目解析触发 QPS 上限时，移至待搭剧列表末尾后续重试', async () => {
        const keywords = ['QPS_RETRY_DRAMA', 'NORMAL_DRAMA'];
        const processedOrder: string[] = [];
        const deferredItems: string[] = [];
        const successfulItems: string[] = [];
        let qpsAttempts = 0;

        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async () => {},
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (keyword: string) => {
                    processedOrder.push(keyword);
                    if (keyword === 'QPS_RETRY_DRAMA') {
                        qpsAttempts++;
                        if (qpsAttempts === 1) {
                            // 第一次返回 QPS 限流错误
                            return {
                                ok: false,
                                status: '常读 OpenAPI 失败（HTTP 200，code 500）：当前集团抖音端原生 OpenAPI QPS 已达上限',
                            };
                        }
                    }
                    return {
                        ok: true,
                        name: keyword,
                        seriesId: '1234567890123456789',
                        douyinId: '1234567890123456789',
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: true,
            onItemDeferred: info => {
                deferredItems.push(info.keyword);
            },
            onItemSuccess: info => {
                successfulItems.push(info.keyword);
            },
        }, deps);

        // 验证执行顺序：QPS_RETRY_DRAMA 第一次被消费 -> 失败暂缓 -> NORMAL_DRAMA 执行成功 -> QPS_RETRY_DRAMA 在队列末尾再次执行成功
        assert.deepEqual(processedOrder, ['QPS_RETRY_DRAMA', 'NORMAL_DRAMA', 'QPS_RETRY_DRAMA']);
        assert.deepEqual(deferredItems, ['QPS_RETRY_DRAMA']);
        assert.equal(successfulItems.length, 2);
    });

    test('当剧目解析遇到“访问速度过快”时，与 QPS 限流一致移至待搭剧列表末尾后续重试', async () => {
        const keywords = ['SPEED_LIMIT_DRAMA', 'NORMAL_DRAMA'];
        const processedOrder: string[] = [];
        const deferredItems: string[] = [];
        const successfulItems: string[] = [];
        let speedLimitAttempts = 0;

        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async () => {},
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (keyword: string) => {
                    processedOrder.push(keyword);
                    if (keyword === 'SPEED_LIMIT_DRAMA') {
                        speedLimitAttempts++;
                        if (speedLimitAttempts === 1) {
                            return {
                                ok: false,
                                status: '常读 OpenAPI 失败（HTTP 200，code 500）：访问速度过快',
                            };
                        }
                    }
                    return {
                        ok: true,
                        name: keyword,
                        seriesId: '1234567890123456789',
                        douyinId: '1234567890123456789',
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: true,
            onItemDeferred: info => {
                deferredItems.push(info.keyword);
            },
            onItemSuccess: info => {
                successfulItems.push(info.keyword);
            },
        }, deps);

        assert.deepEqual(processedOrder, ['SPEED_LIMIT_DRAMA', 'NORMAL_DRAMA', 'SPEED_LIMIT_DRAMA']);
        assert.deepEqual(deferredItems, ['SPEED_LIMIT_DRAMA']);
        assert.equal(successfulItems.length, 2);
    });

    test('当剧目解析遇到 fetch failed 或 timeout 等 OpenAPI 错误时，与 QPS 限流一致移至待搭剧列表末尾后续重试', async () => {
        const keywords = ['FETCH_FAIL_DRAMA', 'TIMEOUT_DRAMA', 'NORMAL_DRAMA'];
        const processedOrder: string[] = [];
        const deferredItems: string[] = [];
        const successfulItems: string[] = [];
        let fetchFailAttempts = 0;
        let timeoutAttempts = 0;

        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async () => {},
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (keyword: string) => {
                    processedOrder.push(keyword);
                    if (keyword === 'FETCH_FAIL_DRAMA') {
                        fetchFailAttempts++;
                        if (fetchFailAttempts === 1) {
                            return {
                                ok: false,
                                status: '常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：fetch failed',
                            };
                        }
                    }
                    if (keyword === 'TIMEOUT_DRAMA') {
                        timeoutAttempts++;
                        if (timeoutAttempts === 1) {
                            return {
                                ok: false,
                                status: '常读 OpenAPI /novelsale/openapi/content/aweme_series/list/v1/ 失败（HTTP 0，code 未知）：The operation was aborted due to timeout',
                            };
                        }
                    }
                    return {
                        ok: true,
                        name: keyword,
                        seriesId: '1234567890123456789',
                        douyinId: '1234567890123456789',
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: true,
            rateLimitCooldownMs: 1,
            onItemDeferred: info => {
                deferredItems.push(info.keyword);
            },
            onItemSuccess: info => {
                successfulItems.push(info.keyword);
            },
        }, deps);

        assert.deepEqual(processedOrder, ['FETCH_FAIL_DRAMA', 'TIMEOUT_DRAMA', 'NORMAL_DRAMA', 'FETCH_FAIL_DRAMA', 'TIMEOUT_DRAMA']);
        assert.deepEqual(deferredItems, ['FETCH_FAIL_DRAMA', 'TIMEOUT_DRAMA']);
        assert.equal(successfulItems.length, 3);
    });

    test('当剧目解析遇到“常读 OpenAPI 分页提前结束”时，不作为 QPS 错误重试或重排，直接跳过并搭建下一部剧', async () => {
        const keywords = ['PREMATURE_PAGINATION_DRAMA', 'NORMAL_DRAMA'];
        const processedOrder: string[] = [];
        const deferredItems: string[] = [];
        const successfulItems: string[] = [];
        const failedItems: string[] = [];

        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async () => {},
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (keyword: string) => {
                    processedOrder.push(keyword);
                    if (keyword === 'PREMATURE_PAGINATION_DRAMA') {
                        return {
                            ok: false,
                            status: '常读 OpenAPI 分页提前结束',
                        };
                    }
                    return {
                        ok: true,
                        name: keyword,
                        seriesId: '1234567890123456789',
                        douyinId: '1234567890123456789',
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: true,
            rateLimitCooldownMs: 1,
            onItemDeferred: info => {
                deferredItems.push(info.keyword);
            },
            onItemSuccess: info => {
                successfulItems.push(info.keyword);
            },
            onItemFailure: info => {
                failedItems.push(info.keyword);
            },
        }, deps);

        assert.deepEqual(processedOrder, ['PREMATURE_PAGINATION_DRAMA', 'NORMAL_DRAMA']);
        assert.deepEqual(deferredItems, []);
        assert.deepEqual(failedItems, ['PREMATURE_PAGINATION_DRAMA']);
        assert.equal(successfulItems.length, 1);
        assert.deepEqual(successfulItems, ['NORMAL_DRAMA']);
    });

    test('持续 QPS 错误最多重排两次，第三轮仅记录一次最终失败且不占用槽位', async () => {
        const keyword = '持续限流剧';
        const normalKeyword = '正常剧';
        const reason = '常读 OpenAPI 失败（HTTP 200，code 500）：QPS 已达上限';
        const processedOrder: string[] = [];
        const events: string[] = [];
        const failures: Array<{ keyword: string; reason: string }> = [];
        const filledSlots: number[] = [];
        const successes: string[] = [];
        const progress: number[] = [];
        let qpsAttempts = 0;
        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async (_page, slot) => { filledSlots.push(slot); },
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (input: string) => {
                    processedOrder.push(input);
                    if (input === keyword) {
                        qpsAttempts++;
                        events.push(`attempt:${qpsAttempts}`);
                        // 上限失效时返回非 QPS 失败，确保测试能结束并报告断言失败。
                        return { ok: false, status: qpsAttempts > 3 ? '超过三轮处理上限' : reason };
                    }
                    return {
                        ok: true, name: input, seriesId: '1234567890123456789',
                        douyinId: '1234567890123456789',
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords: [keyword, normalKeyword],
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: true,
            onItemDeferred: info => { events.push(`deferred:${info.keyword}`); },
            onItemFailure: info => {
                events.push(`failure:${info.keyword}`);
                failures.push({ keyword: info.keyword, reason: info.reason });
            },
            onItemSuccess: info => { successes.push(info.keyword); },
            onProgress: info => { progress.push(info.current); },
        }, deps);

        assert.equal(qpsAttempts, 3);
        assert.deepEqual(processedOrder, [keyword, normalKeyword, keyword, keyword]);
        assert.deepEqual(events, [
            'attempt:1', `deferred:${keyword}`,
            'attempt:2', `deferred:${keyword}`,
            'attempt:3', `failure:${keyword}`,
        ]);
        assert.deepEqual(failures, [{ keyword, reason }]);
        assert.deepEqual(successes, [normalKeyword]);
        assert.deepEqual(filledSlots, [1], '限流剧不得填单，正常剧递补第一个槽位');
        // 正常剧填写、限流剧最终失败、页面提交分别通知进度；提交不增加处理数量。
        assert.deepEqual(progress, [1, 2, 2], '暂缓不得重复计入已处理数量');
    });

    test('投放前剧目冲突预检：已记录的重复剧在搭剧时被自动跳过', async () => {
        // 先在冲突记录库中登记某剧在指定抖音号下已创建
        recordConflictDramas([
            { dramaId: '7684258927520778290', douyinAccount: '50458806167', taskId: '63060845' },
        ], '投手参数校验失败:以下"剧目+抖音号"已被其它任务创建过项目', {
            dramaNameMap: { '7684258927520778290': '冲突巨龙剧' },
        });

        const keywords = ['7684258927520778290', '7699999999999999999'];
        const resolvedList: string[] = [];
        const failedList: Array<{ keyword: string; reason: string }> = [];
        const successfulList: string[] = [];

        const deps: Parameters<typeof run>[1] = {
            connectOverCDP: async () => ({ contexts: () => [{}], close: async () => {} }) as any,
            resolveUnifiedPages: async () => ({ freeList: null, stagePage: {} }) as any,
            prepareStageCopyPage: async () => 4,
            preflightStageSubtasks: async () => 4,
            openNextStageCopyTab: async () => { throw new Error('不应打开新Tab'); },
            triggerBrowserGC: async () => {},
            closeStageDialogIfOpen: async () => {},
            fillStageTaskWithReopenRetry: async () => {},
            trimUnusedStageTasks: async () => {},
            removeStageTasks: async () => {},
            submitStagePage: async () => ({ kind: 'success' }),
            createPipeline: () => ({
                get: async (keyword: string) => {
                    resolvedList.push(keyword);
                    return {
                        ok: true,
                        name: keyword,
                        seriesId: keyword,
                        douyinId: keyword,
                    };
                },
                prefetch: () => {},
                abort: () => {},
                drain: async () => {},
            }) as any,
        };

        await run({
            keywords,
            copyPageUrls: ['https://usergrowth.com.cn/onestop/ad/ad_create/copy?id=test'],
            roiRatio: '1',
            paidTemplate: '超超小额',
            skipSignalHandlers: true,
            skipConflictPreCheck: false,
            onItemFailure: info => {
                failedList.push({ keyword: info.keyword, reason: info.reason });
            },
            onItemSuccess: info => {
                successfulList.push(info.keyword);
            },
        }, deps);

        // 7684258927520778290 应当直接在预检阶段被跳过，甚至不调用 pipeline.get()
        assert.ok(!resolvedList.includes('7684258927520778290'), '冲突剧目不应调用 resolvePipeline');
        assert.ok(resolvedList.includes('7699999999999999999'), '正常剧目应正常解析');

        // 冲突剧目应记录在 failedList 中，且原因包含冲突说明
        assert.equal(failedList.length, 1);
        assert.equal(failedList[0].keyword, '7684258927520778290');
        assert.ok(failedList[0].reason.includes('重复剧预检拦截'));
        assert.ok(failedList[0].reason.includes('50458806167'));

        // 正常剧目搭建成功
        assert.deepEqual(successfulList, ['7699999999999999999']);
    });
});
