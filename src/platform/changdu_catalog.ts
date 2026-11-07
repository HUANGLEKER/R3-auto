// 常读列表页：负责将剧名解析为可投放的漫剧 ID。
import { TIMEOUT } from '../core/config.ts';
import { normalizeTitle } from '../core/utils.ts';
import { profiler } from '../infra/profiler.ts';
import { lockPageActive } from './cdp.ts';

export interface CatalogCandidate {
    index: number;
    name: string;
    status: string;
    authStatus: string;
    deliveryStatus: string;
    seriesId: string;
    rowText: string;
}

export function isEligibleCatalogCandidate(candidate: Pick<CatalogCandidate, 'status' | 'authStatus' | 'deliveryStatus'>): boolean {
    return candidate.status === '已发布'
        && candidate.deliveryStatus === '可投放'
        && ['独家授权', '普通授权'].includes(candidate.authStatus);
}

async function readRows(bookItems: any): Promise<CatalogCandidate[]> {
    return bookItems.evaluateAll((nodes: Element[]) => nodes.map((node, index) => {
        let row: Element | null = node.closest('tr');
        for (let depth = 0, current: Element | null = node; !row && current && depth < 8; depth++) {
            current = current.parentElement;
            const text = current?.textContent || '';
            if (/(?:剧目|短剧|漫剧)\s*ID\s*[:：]?\s*\d+/i.test(text) || /已发布|未发布|已下架/.test(text)) row = current;
        }
        const rowText = row?.textContent || '';
        const id = rowText.match(/(?:剧目|短剧|漫剧)\s*ID\s*[:：]?\s*([0-9]+)/i)?.[1] || '';
        return {
            index,
            name: (node.textContent || '').trim(),
            status: rowText.includes('已下架') ? '已下架' : rowText.includes('已发布') ? '已发布' : rowText.includes('未发布') ? '未发布' : '未知',
            authStatus: rowText.includes('独家授权') ? '独家授权' : rowText.includes('普通授权') ? '普通授权' : rowText.includes('无授权') ? '无授权' : '未知',
            deliveryStatus: rowText.includes('不可投放') ? '不可投放' : rowText.includes('即将下架') ? '即将下架' : rowText.includes('可投放') ? '可投放' : '未知',
            seriesId: id,
            rowText,
        };
    }));
}

export async function searchFreeDrama(page: any, keyword: string): Promise<{
    found: boolean; reason?: string; candidates: CatalogCandidate[];
}> {
    const span = profiler.startSpan('catalog.search_drama', 'DOM', { keyword });
    await lockPageActive(page);
    const searchInput = page.locator('input#query_input');
    const searchButton = page.locator('button.e2e-form-search-btn');
    const bookItems = page.locator('div.book_name_content');
    await searchInput.fill('');
    await searchInput.fill(keyword);
    await searchButton.click();
    await page.waitForFunction((target: string) => {
        const normalize = (value: string) => value.trim().replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
        const names = Array.from(document.querySelectorAll('div.book_name_content')).map(node => node.textContent || '');
        return names.some(name => normalize(name) === target) || /暂无数据|暂无内容|没有数据|无数据/.test(document.body?.innerText || '');
    }, normalizeTitle(keyword), { timeout: TIMEOUT.SEARCH_XHR }).catch(() => {});
    const sameName = (await readRows(bookItems)).filter(row => row.name === keyword || normalizeTitle(row.name) === normalizeTitle(keyword));
    const candidates = sameName.filter(isEligibleCatalogCandidate);
    const reason = candidates.length ? undefined : sameName.length ? '无可投放且已授权的已发布版本' : '未找到匹配';
    span.end({ found: Boolean(candidates.length), candidateCount: candidates.length, reason });
    return { found: Boolean(candidates.length), reason, candidates };
}
