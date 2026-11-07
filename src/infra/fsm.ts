// ============================================================
// Finite State Machine (FSM) Infrastructure
// Deterministic State Management, Lifecycle Guards & Transition Auditing
// ============================================================

import { profiler } from './profiler.ts';
import { writeStructuredLog } from '../core/structured_log.ts';

export interface TransitionDefinition<TState extends string, TEvent extends string, TContext> {
    from: TState | TState[];
    event: TEvent;
    to: TState;
    guard?: (ctx: TContext, payload?: any) => boolean;
    action?: (ctx: TContext, payload?: any) => Promise<void> | void;
    name?: string;
}

export interface StateTransitionRecord<TState extends string, TEvent extends string> {
    from: TState;
    to: TState;
    event: TEvent;
    timestamp: number;
    durationMs: number;
    payload?: any;
}

export interface FSMConfig<TState extends string, TEvent extends string, TContext> {
    name: string;
    initialState: TState;
    context: TContext;
    transitions: TransitionDefinition<TState, TEvent, TContext>[];
    onTransition?: (from: TState, to: TState, event: TEvent, context: TContext) => void;
    onError?: (error: Error, state: TState, context: TContext) => void;
}

export class StateMachine<TState extends string, TEvent extends string, TContext extends Record<string, any>> {
    private name: string;
    private currentState: TState;
    private context: TContext;
    private transitions: TransitionDefinition<TState, TEvent, TContext>[];
    private history: StateTransitionRecord<TState, TEvent>[] = [];
    private onTransitionCallback?: (from: TState, to: TState, event: TEvent, context: TContext) => void;
    private onErrorCallback?: (error: Error, state: TState, context: TContext) => void;
    private lastTransitionTime = performance.now();

    constructor(config: FSMConfig<TState, TEvent, TContext>) {
        this.name = config.name;
        this.currentState = config.initialState;
        this.context = { ...config.context };
        this.transitions = config.transitions;
        this.onTransitionCallback = config.onTransition;
        this.onErrorCallback = config.onError;
    }

    public getState(): TState {
        return this.currentState;
    }

    public getContext(): Readonly<TContext> {
        return this.context;
    }

    public updateContext(partial: Partial<TContext>): void {
        Object.assign(this.context, partial);
    }

    public getHistory(): StateTransitionRecord<TState, TEvent>[] {
        return [...this.history];
    }

    public is(state: TState): boolean {
        return this.currentState === state;
    }

    public can(event: TEvent, payload?: any): boolean {
        return this.transitions.some(t => {
            const matchesFrom = Array.isArray(t.from)
                ? t.from.includes(this.currentState)
                : t.from === this.currentState;
            if (!matchesFrom || t.event !== event) {
                return false;
            }
            if (t.guard && !t.guard(this.context, payload)) {
                return false;
            }
            return true;
        });
    }

    public async send(event: TEvent, payload?: any): Promise<TState> {
        const span = profiler.startSpan(`FSM:${this.name}:${event}`, 'FSM', {
            fsm: this.name,
            fromState: this.currentState,
            event,
        });

        const matching = this.transitions.find(t => {
            const matchesFrom = Array.isArray(t.from)
                ? t.from.includes(this.currentState)
                : t.from === this.currentState;
            if (!matchesFrom || t.event !== event) {
                return false;
            }
            if (t.guard && !t.guard(this.context, payload)) {
                return false;
            }
            return true;
        });

        if (!matching) {
            const error = new Error(
                `[FSM:${this.name}] 非法状态转移: 当前状态 [${this.currentState}] 无法响应事件 [${event}]`
            );
            span.endWithError(error);
            if (this.onErrorCallback) {
                this.onErrorCallback(error, this.currentState, this.context);
            }
            throw error;
        }

        const fromState = this.currentState;
        const toState = matching.to;
        const now = performance.now();
        const stateDurationMs = Math.round((now - this.lastTransitionTime) * 100) / 100;
        this.lastTransitionTime = now;

        if (matching.action) {
            try {
                await matching.action(this.context, payload);
            } catch (actionError: any) {
                span.endWithError(actionError);
                if (this.onErrorCallback) {
                    this.onErrorCallback(actionError, this.currentState, this.context);
                }
                throw actionError;
            }
        }

        this.currentState = toState;
        this.history.push({
            from: fromState,
            to: toState,
            event,
            timestamp: Date.now(),
            durationMs: stateDurationMs,
            payload,
        });

        writeStructuredLog('FSM_TRANSITION', {
            fsm: this.name,
            fromState,
            toState,
            event,
            stateDurationMs,
        });

        if (this.onTransitionCallback) {
            this.onTransitionCallback(fromState, toState, event, this.context);
        }

        span.end({ toState });
        return this.currentState;
    }

    public reset(initialState?: TState, initialContext?: TContext): void {
        if (initialState) {
            this.currentState = initialState;
        }
        if (initialContext) {
            this.context = { ...initialContext };
        }
        this.history = [];
        this.lastTransitionTime = performance.now();
    }
}

// ------------------------------------------------------------
// 1. 搭剧子任务状态机 (Stage Subtask FSM)
// ------------------------------------------------------------
export type StageSubtaskState =
    | 'IDLE'
    | 'OPENING'
    | 'DIALOG_READY'
    | 'SEARCHING_DRAMA'
    | 'DRAMA_SELECTED'
    | 'FILLING_ROI'
    | 'ROI_FILLED'
    | 'SEARCHING_PRODUCT'
    | 'PRODUCT_SELECTED'
    | 'AUTO_MATCHING'
    | 'LINKS_FILLING'
    | 'LINKS_VERIFIED'
    | 'SUBMITTING'
    | 'COMPLETED'
    | 'HEALING_DISCARD'
    | 'DISCARD_CONFIRMED'
    | 'REOPEN_READY'
    | 'BLOCKED'
    | 'FAILED';

export type StageSubtaskEvent =
    | 'START_OPEN'
    | 'DIALOG_OPENED'
    | 'START_SEARCH'
    | 'SELECT_SUCCESS'
    | 'SEARCH_FAILED'
    | 'START_FILL_ROI'
    | 'ROI_FILLED_SUCCESS'
    | 'START_SELECT_PRODUCT'
    | 'PRODUCT_SELECTED_SUCCESS'
    | 'PRODUCT_SEARCH_FAILED'
    | 'START_AUTO_MATCH'
    | 'AUTO_MATCH_COMPLETED'
    | 'START_FILL_LINKS'
    | 'LINKS_VERIFIED_SUCCESS'
    | 'START_SUBMIT'
    | 'SUBMIT_SUCCESS'
    | 'SUBMIT_FAILED'
    | 'START_HEAL'
    | 'DISCARD_DONE'
    | 'REOPEN_ROUND_START'
    | 'TRIGGER_BLOCK'
    | 'FATAL_ERROR';

export interface StageSubtaskContext {
    subtaskIndex: number;
    requiredCount: number;
    dramaName: string;
    douyinId: string;
    roiRatio?: string;
    round: number;
    maxRounds: number;
    error?: string;
}

export function createStageSubtaskFSM(context: StageSubtaskContext): StateMachine<StageSubtaskState, StageSubtaskEvent, StageSubtaskContext> {
    return new StateMachine<StageSubtaskState, StageSubtaskEvent, StageSubtaskContext>({
        name: `StageSubtask_${context.subtaskIndex}`,
        initialState: 'IDLE',
        context,
        transitions: [
            { from: ['IDLE', 'REOPEN_READY'], event: 'START_OPEN', to: 'OPENING' },
            { from: 'OPENING', event: 'DIALOG_OPENED', to: 'DIALOG_READY' },
            { from: 'DIALOG_READY', event: 'START_SEARCH', to: 'SEARCHING_DRAMA' },
            { from: 'SEARCHING_DRAMA', event: 'SELECT_SUCCESS', to: 'DRAMA_SELECTED' },
            { from: 'SEARCHING_DRAMA', event: 'SEARCH_FAILED', to: 'HEALING_DISCARD' },
            { from: ['DRAMA_SELECTED', 'ROI_FILLED'], event: 'START_FILL_ROI', to: 'FILLING_ROI' },
            { from: 'FILLING_ROI', event: 'ROI_FILLED_SUCCESS', to: 'ROI_FILLED' },
            { from: ['DRAMA_SELECTED', 'ROI_FILLED'], event: 'START_SELECT_PRODUCT', to: 'SEARCHING_PRODUCT' },
            { from: 'SEARCHING_PRODUCT', event: 'PRODUCT_SELECTED_SUCCESS', to: 'PRODUCT_SELECTED' },
            { from: 'SEARCHING_PRODUCT', event: 'PRODUCT_SEARCH_FAILED', to: 'HEALING_DISCARD' },
            { from: ['DRAMA_SELECTED', 'ROI_FILLED'], event: 'START_AUTO_MATCH', to: 'AUTO_MATCHING' },
            { from: 'AUTO_MATCHING', event: 'AUTO_MATCH_COMPLETED', to: 'LINKS_FILLING' },
            { from: ['PRODUCT_SELECTED', 'DRAMA_SELECTED', 'ROI_FILLED', 'LINKS_FILLING'], event: 'START_FILL_LINKS', to: 'LINKS_FILLING' },
            { from: 'LINKS_FILLING', event: 'LINKS_VERIFIED_SUCCESS', to: 'LINKS_VERIFIED' },
            { from: ['LINKS_VERIFIED', 'LINKS_FILLING', 'ROI_FILLED', 'AUTO_MATCHING', 'PRODUCT_SELECTED', 'DRAMA_SELECTED'], event: 'START_SUBMIT', to: 'SUBMITTING' },
            { from: 'SUBMITTING', event: 'SUBMIT_SUCCESS', to: 'COMPLETED' },
            { from: 'SUBMITTING', event: 'SUBMIT_FAILED', to: 'FAILED' },
            { from: ['SEARCHING_DRAMA', 'FILLING_ROI', 'ROI_FILLED', 'AUTO_MATCHING', 'SEARCHING_PRODUCT', 'DIALOG_READY', 'OPENING', 'DRAMA_SELECTED', 'PRODUCT_SELECTED'], event: 'START_HEAL', to: 'HEALING_DISCARD' },
            { from: 'HEALING_DISCARD', event: 'DISCARD_DONE', to: 'DISCARD_CONFIRMED' },
            { from: 'DISCARD_CONFIRMED', event: 'REOPEN_ROUND_START', to: 'REOPEN_READY' },
            { from: ['HEALING_DISCARD', 'DISCARD_CONFIRMED', 'SEARCHING_DRAMA', 'SEARCHING_PRODUCT'], event: 'TRIGGER_BLOCK', to: 'BLOCKED' },
            {
                from: [
                    'IDLE', 'OPENING', 'DIALOG_READY', 'SEARCHING_DRAMA',
                    'DRAMA_SELECTED', 'FILLING_ROI', 'ROI_FILLED', 'SEARCHING_PRODUCT', 'PRODUCT_SELECTED',
                    'AUTO_MATCHING', 'LINKS_FILLING', 'LINKS_VERIFIED',
                    'SUBMITTING', 'HEALING_DISCARD',
                ],
                event: 'FATAL_ERROR',
                to: 'FAILED',
            },
        ],
    });
}

// ------------------------------------------------------------
// 2. 短剧解析器状态机 (Drama Resolver FSM)
// ------------------------------------------------------------
export type DramaResolverState =
    | 'INITIAL'
    | 'SEARCHING_FREE'
    | 'CANDIDATES_EVALUATING'
    | 'PARALLEL_READING'
    | 'CONFIRMING_FREE_IAA'
    | 'CONFIRMING_DOUYIN_ID'
    | 'CONFIRMING_PAID_IAP'
    | 'RESOLVED'
    | 'NEXT_CANDIDATE'
    | 'NO_USABLE_DRAMA'
    | 'FAILED';

export type DramaResolverEvent =
    | 'START_RESOLVE'
    | 'FREE_SEARCH_OK'
    | 'NO_FREE_CANDIDATES'
    | 'START_PARALLEL_READ'
    | 'CACHE_HIT'
    | 'PARALLEL_READ_DONE'
    | 'FREE_IAA_READY'
    | 'DOUYIN_ID_READY'
    | 'PAID_IAP_READY'
    | 'RESOLVED_SUCCESS'
    | 'ADVANCE_CANDIDATE'
    | 'ALL_CANDIDATES_EXHAUSTED'
    | 'FATAL_ERROR';

export interface DramaResolverContext {
    keyword: string;
    candidateIndex: number;
    candidateCount: number;
    seriesId?: string;
    douyinId?: string;
    attempts: string[];
}

export function createDramaResolverFSM(keyword: string): StateMachine<DramaResolverState, DramaResolverEvent, DramaResolverContext> {
    return new StateMachine<DramaResolverState, DramaResolverEvent, DramaResolverContext>({
        name: `DramaResolver_${keyword}`,
        initialState: 'INITIAL',
        context: {
            keyword,
            candidateIndex: 0,
            candidateCount: 0,
            attempts: [],
        },
        transitions: [
            { from: 'INITIAL', event: 'START_RESOLVE', to: 'SEARCHING_FREE' },
            { from: 'SEARCHING_FREE', event: 'FREE_SEARCH_OK', to: 'CANDIDATES_EVALUATING' },
            { from: 'SEARCHING_FREE', event: 'NO_FREE_CANDIDATES', to: 'NO_USABLE_DRAMA' },
            { from: ['CANDIDATES_EVALUATING', 'NEXT_CANDIDATE'], event: 'START_PARALLEL_READ', to: 'PARALLEL_READING' },
            { from: ['CANDIDATES_EVALUATING', 'PARALLEL_READING'], event: 'CACHE_HIT', to: 'RESOLVED' },
            { from: 'PARALLEL_READING', event: 'PARALLEL_READ_DONE', to: 'CONFIRMING_FREE_IAA' },
            { from: 'CONFIRMING_FREE_IAA', event: 'FREE_IAA_READY', to: 'CONFIRMING_DOUYIN_ID' },
            { from: 'CONFIRMING_DOUYIN_ID', event: 'DOUYIN_ID_READY', to: 'CONFIRMING_PAID_IAP' },
            { from: 'CONFIRMING_PAID_IAP', event: 'PAID_IAP_READY', to: 'RESOLVED' },
            { from: ['CONFIRMING_FREE_IAA', 'CONFIRMING_DOUYIN_ID', 'CONFIRMING_PAID_IAP', 'PARALLEL_READING'], event: 'ADVANCE_CANDIDATE', to: 'NEXT_CANDIDATE' },
            { from: ['CANDIDATES_EVALUATING', 'NEXT_CANDIDATE'], event: 'ALL_CANDIDATES_EXHAUSTED', to: 'NO_USABLE_DRAMA' },
            {
                from: [
                    'INITIAL', 'SEARCHING_FREE', 'CANDIDATES_EVALUATING',
                    'PARALLEL_READING', 'CONFIRMING_FREE_IAA', 'CONFIRMING_DOUYIN_ID',
                    'CONFIRMING_PAID_IAP', 'NEXT_CANDIDATE',
                ],
                event: 'FATAL_ERROR',
                to: 'FAILED',
            },
        ],
    });
}
