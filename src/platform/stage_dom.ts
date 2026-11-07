import { STAGE_SELECTORS } from '../core/config.ts';

export function getStageSubtaskContainers(page: any): any {
    return page
        .locator(STAGE_SELECTORS.subtaskContainerBase)
        .filter({
            has: page.locator(STAGE_SELECTORS.editIcon),
        });
}

export async function getStageSubtaskStats(page: any): Promise<{
    rawCount: number;
    taskCount: number;
    auxiliaryCount: number;
}> {
    const rawCount = await page
        .locator(STAGE_SELECTORS.subtaskContainerBase)
        .count()
        .catch(() => 0);

    const taskCount = await getStageSubtaskContainers(page)
        .count()
        .catch(() => 0);

    return {
        rawCount,
        taskCount,
        auxiliaryCount: Math.max(0, rawCount - taskCount),
    };
}

export async function tryClickStageReload(page: any): Promise<boolean> {
    return await page.evaluate(() => {
        const nodes = document.querySelectorAll(
            'button, [role="button"], span, a'
        );

        for (const rawNode of Array.from(nodes)) {
            const node = rawNode as HTMLElement;
            const text = (
                node.textContent || ''
            ).replace(/\s/g, '');

            if (
                text.includes('重新加载') ||
                text.toLowerCase().includes('reload') ||
                text.includes('重载')
            ) {
                if (node.offsetWidth > 0) {
                    node.click();
                    return true;
                }
            }
        }

        return false;
    });
}

