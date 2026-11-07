import { STAGE_SELECTION_STATE } from '../core/config.ts';

/** Selection evidence is evaluated independently of browser locators and retry timing. */
export function evaluateStageSelection(expectedId: string, optionValues: string[], selectedValues: string[], query: string, optionCount: number) {
    const direct = !!expectedId && optionValues.some(value => value.includes(expectedId));
    const selected = !!expectedId && selectedValues.some(value => value.includes(expectedId));
    if (direct || selected) {
        return { state: STAGE_SELECTION_STATE.VERIFIED, source: direct ? 'OPTION_IDENTITY' : 'SELECTED_VALUE' };
    }
    if (expectedId && query === expectedId && optionCount === 1) {
        return { state: STAGE_SELECTION_STATE.VERIFIED, source: 'EXACT_QUERY_SINGLE_OPTION' };
    }
    return { state: STAGE_SELECTION_STATE.RETRY, source: 'AMBIGUOUS_SELECTION', detail: `query=${query}, optionCount=${optionCount}` };
}
