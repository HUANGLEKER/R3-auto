// ============================================================
// Unified Test Suite Runner (Unit & Integration Tests)
// ============================================================

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFiles = [
    path.join(__dirname, 'unit', 'architecture.test.ts'),
    path.join(__dirname, 'integration', 'architecture_bridge.test.ts'),
    path.join(__dirname, 'integration', 'stage_submit_dom.test.ts'),
    path.join(__dirname, 'unit', 'stage_submit.test.ts'),
    path.join(__dirname, 'unit', 'stage_recovery.test.ts'),
    path.join(__dirname, 'unit', 'stage_auto_match.test.ts'),
    path.join(__dirname, 'unit', 'config_store.test.ts'),
    path.join(__dirname, 'unit', 'frontend_performance.test.ts'),
    path.join(__dirname, 'integration', 'frontend_performance_dom.test.ts'),
    path.join(__dirname, 'integration', 'frontend_dropdown_dom.test.ts'),
    path.join(__dirname, 'integration', 'frontend_state_dom.test.ts'),
    path.join(__dirname, 'integration', 'stage_project_name_dom.test.ts'),
    path.join(__dirname, 'unit', 'stage_project_name.test.ts'),
    path.join(__dirname, 'integration', 'stage_iaa_iap_dom.test.ts'),
    path.join(__dirname, 'unit', 'stage_iaa_iap.test.ts'),
    path.join(__dirname, 'unit', 'utils.test.ts'),
    path.join(__dirname, 'unit', 'drama_input.test.ts'),
    path.join(__dirname, 'unit', 'catalog_eligibility.test.ts'),
    path.join(__dirname, 'unit', 'changdu_openapi.test.ts'),
    path.join(__dirname, 'unit', 'lock.test.ts'),
    path.join(__dirname, 'unit', 'validation.test.ts'),
    path.join(__dirname, 'unit', 'cache.test.ts'),
    path.join(__dirname, 'unit', 'fsm.test.ts'),
    path.join(__dirname, 'unit', 'locator.test.ts'),
    path.join(__dirname, 'unit', 'profiler.test.ts'),
    path.join(__dirname, 'unit', 'pipeline.test.ts'),
    path.join(__dirname, 'unit', 'regressions.test.ts'),
    path.join(__dirname, 'unit', 'jitter_retry.test.ts'),
    path.join(__dirname, 'integration', 'web_server_api.test.ts'),
    path.join(__dirname, 'integration', 'desktop_backend.test.ts'),
    path.join(__dirname, 'integration', 'run_lock.test.ts'),
    path.join(__dirname, 'integration', 'runner_lifecycle.test.ts'),
    path.join(__dirname, 'integration', 'runner_no_candidates.test.ts'),
    path.join(__dirname, 'integration', 'runner_deferred_search.test.ts'),
    path.join(__dirname, 'integration', 'runner_conflict_batch.test.ts'),
    path.join(__dirname, 'integration', 'runner_unverified_native_content.test.ts'),
    path.join(__dirname, 'integration', 'runner_tab_close.test.ts'),
    path.join(__dirname, 'integration', 'changdu_resolver.test.ts'),
    path.join(__dirname, 'integration', 'changdu_review_regressions.test.ts'),
    path.join(__dirname, 'unit', 'conflict_guard.test.ts'),
    path.join(__dirname, 'unit', 'qps_backoff_and_requeue.test.ts'),
    path.join(__dirname, 'unit', 'logger.test.ts'),
    path.join(__dirname, 'unit', 'config_single_source_and_batch_commit.test.ts'),
    path.join(__dirname, 'unit', 'stage_page_config.test.ts'),
];





console.log('\n============================================================');
console.log('🧪 R3 自动化系统 - 全量测试套件启动 (Node 24 Native Test)');
console.log('============================================================\n');

// Tests mutate conflict records and configuration files. Never use user data.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r3-tests-'));
process.env.R3_DATA_DIR = testDataDir;
const testStream = run({
    files: testFiles,
    concurrency: false,
});

testStream.compose(new spec()).pipe(process.stdout);

testStream.on('test:fail', () => {
    process.exitCode = 1;
});
testStream.on('end', () => fs.rmSync(testDataDir, { recursive: true, force: true }));
