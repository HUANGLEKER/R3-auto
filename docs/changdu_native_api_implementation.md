# 常读端原生 API 当前实现

当前客户端仅负责作品 ID 解析及免费、付费渠道资格核验。剧名先通过免费漫剧列表页检索候选，再调用内容接口核验。搭剧页面的 IAA/IAP 配置由浏览器填写。

## 接口与数据流

基址：`https://openapi.changdupingtai.com`。

唯一业务接口为 GET `/novelsale/openapi/content/aweme_series/list/v1/`，发送 `distributor_id`、`query`、`page_index`、`page_size`。读取 `book_id`、`playlet_id`、剧名及发布、投放、授权状态。内部 ID 均使用字符串。

解析器检查两渠道返回的 `playlet_id` 一致，返回剧名、漫剧 ID 与抖音作品 ID。缓存命中时仍重新核验两渠道资格与作品身份。

## 资格与分页

- 当前请求只传 query，不发送 publish_status 筛选。响应 `publish_status === 2` 才放行。
- 可投要求 `delivery_status === true`。
- 授权仅放行已核验的 `permission_status === 4`；2 为无授权，其余未知值保守阻断。
- 内容查询使用每页 20 条，从第 0 页开始。此大小沿用服务端兼容策略。
- 核对 total 的整数性、稳定性及记录总数；检测整页重复、单条记录重复、提前空页、缺失列表和截断响应。异常不能当作查无作品。
- 保留 `result`、`data.list` 和 `has_more` 的列表兼容分支。

## 签名、限流与取消

GET 按参数名排序，将每个值附加 `|` 拼接。签名为 MD5(distributor_id + secret + 秒级时间戳 + 参数串)，以小写输出；鉴权头为 header-ts、header-sign。密钥不作为业务参数发送。JSON 解码前保护长整数 ID，避免经过 Number 丢失精度。

同一客户端的两个渠道共用接口队列，开始时间间隔至少 1000ms，单次请求超时 10 秒。临时故障最多请求 3 次，限流最多请求 4 次；重试重新签名并考虑 Retry-After，超过 30 秒不自动等待。410–413 鉴权错误不重试。

停止信号贯通流水线、解析器、队列、退避和 fetch。runner 等待 drain 后释放单实例锁。每次执行从当前输入开始，不读取或写入旧 checkpoint。

## 搭剧配置

作品解析完成后，浏览器选择搭剧内容并填写项目名称、ROI、IAA 和 IAP 配置。IAA 选择默认应用、主管账号、名称词包及第二个起始解锁选项；IAP 选择默认应用、主管账号、名称词包及目标充值模板。

文本框填入后核验实际值。保存结果依据弹窗关闭、页面错误及本次关联请求；整页提交确认成功后才计入成功数，不确定结果阻断运行。

## 验证

统一测试入口为 `tests/run_all_tests.ts`，使用临时 R3_DATA_DIR 和模拟 HTTP。`tools/review_changdu_api.ts` 独立验证内容查询、两渠道资格核验及长 ID 精度。
