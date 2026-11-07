// ============================================================
// Unit Tests: Exponential Backoff with Full Jitter
// ============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { retryWithJitter } from '../../src/core/utils.ts';

describe('Resilience: Full Jitter 指数退避重试算法', () => {
    test('一次成功的操作直接返回结果且不触发等待', async () => {
        let attempts = 0;
        const result = await retryWithJitter(async () => {
            attempts++;
            return 'success_val';
        }, { maxRetries: 3, baseMs: 50, maxMs: 200 });

        assert.equal(result, 'success_val');
        assert.equal(attempts, 1);
    });

    test('重试中途成功能够自愈并返回正确结果', async () => {
        let attempts = 0;
        const retryLogs: Array<{ attempt: number; delayMs: number }> = [];

        const result = await retryWithJitter(async (att) => {
            attempts++;
            if (att < 3) {
                throw new Error(`Transient error at attempt ${att}`);
            }
            return 'recovered_val';
        }, {
            maxRetries: 4,
            baseMs: 10,
            maxMs: 50,
            onRetry: (attempt, delayMs) => {
                retryLogs.push({ attempt, delayMs });
            },
        });

        assert.equal(result, 'recovered_val');
        assert.equal(attempts, 3);
        assert.equal(retryLogs.length, 2);
        // 延迟必须在限制范围内
        assert.ok(retryLogs[0].delayMs <= 10);
        assert.ok(retryLogs[1].delayMs <= 20);
    });

    test('耗尽重试次数后抛出最后的错误', async () => {
        let attempts = 0;

        await assert.rejects(
            async () => {
                await retryWithJitter(async () => {
                    attempts++;
                    throw new Error('Fatal persistent error');
                }, { maxRetries: 3, baseMs: 5, maxMs: 20 });
            },
            {
                message: 'Fatal persistent error',
            }
        );

        assert.equal(attempts, 3);
    });
});
