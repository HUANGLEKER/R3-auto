# 常读作品解析验证记录

当前回归覆盖两渠道资格、作品 ID 一致性、长整数精度、分页重复与提前结束、鉴权错误、有限重试、取消传播和流水线排空。

运行 `node/node.exe tests/run_all_tests.ts`、`npm run typecheck` 及 `node/node.exe tools/review_changdu_api.ts` 验证当前实现。全部 HTTP 使用模拟。

详见 [API 实现说明](changdu_native_api_implementation.md)。
