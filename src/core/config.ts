// ============================================================
// Core Configuration & Constants
// ============================================================

export const CDP_PORT = 9224;

export const BAT_LOG_LEVEL = String(
    process.env.BAT_LOG_LEVEL || 'normal'
).toLowerCase();

export const TIMEOUT = {
    SEARCH_XHR: 5000,
    SEARCH_DOM: 1800,
};

export const COPY_PAGE_URL =
    'https://usergrowth.com.cn/onestop/ad/ad_create/copy?_app_id=796433&ad_platform=toutiao&id=55602179';

export const PAID_PANEL_OPTIONS = ['中额', '小额', '超小额', '超超小额'] as const;
export type PaidPanelOption = typeof PAID_PANEL_OPTIONS[number];

export const UNIFIED = {
    PAID_TEMPLATE: '超超小额',
    TASK_NAME_PREFIX: '',
    DAILY_BUDGET: '300',
    PAGE_DETECT_TIMEOUT: 1800,
    STAGE_DIALOG_TIMEOUT: 15000,
    STAGE_LOAD_TIMEOUT: 20000,
    STAGE_PAGE_READY_TIMEOUT: 30000,
    STAGE_SEARCH_TIMEOUT: 12000,
    STAGE_ACTION_TIMEOUT: 12000,
    STAGE_SAVE_TIMEOUT: 15000,
    // 内容名称在单次弹窗内连续搜索失败后，取消并重新打开同一子任务。
    // 同一弹窗内第二次搜索前，真清空后点击标题区域失焦，再重新打开下拉搜索。
    // 单轮执行 2 次搜索，仍失败才取消并重开，最多 3 轮，共最多 6 次作品ID搜索。
    STAGE_DRAMA_SEARCH_RETRY: 2,
    STAGE_DIALOG_REOPEN_MAX: 3,

    // 搭剧平台单个复制任务页最多允许 10 个真实子任务。
    // 输入超过 10 条时不再终止，而是每 10 条在同一 Chrome 窗口中新建一个搭剧 Tab。
    // 页面 DOM 在真实子任务后还会渲染“添加配置”等辅助节点，
    // 这些节点不能计入子任务数量，也不能参与 nth 定位。
    STAGE_MAX_SUBTASKS: 10,

    // P2：同一运行周期内按 seriesId 缓存只读查询结果与最终可用数据。
    RUNTIME_CACHE_ENABLED: true,
};

export const STAGE_SELECTION_STATE = Object.freeze({
    VERIFIED: 'VERIFIED',
    RETRY: 'RETRY',
} as const);

export const STAGE_SELECTORS = {
    subtaskContainerBase:
        '#sub-micro-container div[class*="content-"] > div > form > div > div > div > div:nth-child(2) > div[class*="box-card-content-"] > div > div',
    basicConfigEditBtn:
        '#sub-micro-container div[class*="content-"] > div > form > div > div > div > div:nth-child(1) button:has(.arco-icon-edit)',
    unifiedConfigEditBtn:
        '#sub-micro-container div[class*="content-"] > div > form > div > div > div > div:nth-child(3) button:has(.arco-icon-edit)',
    editIcon: '.arco-icon-edit',
    dialog: '.arco-modal, .arco-drawer, [class*="modal"], [class*="drawer"]',
    contentNameDropdown: '#product_info_book_info_book_id_input',
    okBtn: 'button:has-text("确定")',
    cancelBtn: 'button:has-text("取消")',
    autoMatchRadio: '.arco-radio-button:has-text("自动匹配"), [role="radio"]:has-text("自动匹配")',
    productMatchMethodGroup: '.arco-form-item:has(label:has-text("商品匹配方式"))',
    customMatchRadio: '.arco-radio-button:has-text("自定义指定"), [role="radio"]:has-text("自定义指定")',
    productDropdown: '.arco-form-item:has(label:text-is("商品 *")) .arco-select-view, .arco-form-item:has(label:text-is("商品")) .arco-select-view',
    roiRatioInput: 'input#bid_info_omni_roi_coefficient_input, input[id*="omni_roi_coefficient"], input[placeholder*="全域ROI系数"]',
};

export const STAGE_ENDPOINTS = Object.freeze({
    HOST_SUFFIX: 'usergrowth.com.cn',
    API_PREFIX: '/advertising/api/',
    CONTENT_SEARCH: /\/advertising\/api\/v1\/(?:[^?#]+\/)?pack_list\/?$/i,
    AUTO_MATCH_HINT: /match|pack|book|content|product|material|link/i,
    SAVE_HINT: /\/(?:save|update|upsert)\/?$/i,
});

