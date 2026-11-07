import type { CatalogPort } from '../contracts/platform.ts';
import { searchFreeDrama } from './changdu_catalog.ts';

export function createCatalogPort(page: Parameters<typeof searchFreeDrama>[0]): CatalogPort {
    return { async search(keyword, signal) {
        signal?.throwIfAborted();
        const result = await searchFreeDrama(page, keyword);
        signal?.throwIfAborted();
        return result;
    } };
}
