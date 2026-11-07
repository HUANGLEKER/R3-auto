import {z} from 'zod';

export const itemStatuses = ['pending', 'running', 'filled', 'submitting', 'success', 'failed', 'uncertain'] as const;
export const itemSchema = z.object({
    index: z.number().int().positive(),
    keyword: z.string(),
    status: z.enum(itemStatuses),
    name: z.string().optional(),
    seriesId: z.string().optional(),
    douyinId: z.string().optional(),
    tabIndex: z.number().optional(),
    subtaskIndex: z.number().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
    time: z.string().optional()
});
export type TaskItem = z.infer<typeof itemSchema>;
export type ItemStatus = TaskItem['status'];
export const logSchema = z.object({
    time: z.string(),
    tag: z.string(),
    text: z.string(),
    level: z.enum(['info', 'warn', 'error']).optional(),
    stack: z.string().optional()
});
export type LogEntry = z.infer<typeof logSchema>;
export const progressSchema = z.object({
    current: z.number(),
    total: z.number(),
    percentage: z.number(),
    successCount: z.number(),
    failedCount: z.number()
});
export type ProgressInfo = z.infer<typeof progressSchema>;
export const phases = ['resolving', 'filling', 'verifying', 'submitting', 'idle'] as const;
export type RunPhase = typeof phases[number];
export const healthSchema = z.object({
    status: z.enum(['ready', 'faulted']),
    reason: z.string().nullable(),
    faultedAt: z.number().nullable()
});
export const patchSchema = z.object({
    items: z.array(itemSchema).optional(),
    moveToEnd: z.number().optional(),
    status: z.enum(['idle', 'running', 'completed', 'error', 'aborted']).optional(),
    currentItem: z.object({
        index: z.number(),
        keyword: z.string(),
        tabIndex: z.number(),
        subtaskIndex: z.number()
    }).nullable().optional(),
    progress: progressSchema.optional(),
    startedAt: z.number().nullable().optional(),
    finishedAt: z.number().nullable().optional(),
    lastError: z.string().nullable().optional(),
    paidTemplate: z.enum(['中额', '小额', '超小额', '超超小额']).optional(),
    taskNamePrefix: z.string().optional(),
    dailyBudget: z.string().optional(),
    summary: z.unknown().optional(),
    health: healthSchema.optional(),
});
export const snapshotSchema = patchSchema.extend({
    items: z.array(itemSchema),
    logs: z.array(logSchema),
    status: z.enum(['idle', 'running', 'completed', 'error', 'aborted']),
    progress: progressSchema
});
const base = {protocolVersion: z.literal(1), runId: z.string(), seq: z.number().int().nonnegative()};
export const consoleEventSchema = z.discriminatedUnion('kind', [
    z.object({...base, kind: z.literal('snapshot'), data: snapshotSchema}),
    z.object({...base, kind: z.literal('patch'), data: patchSchema}),
    z.object({...base, kind: z.literal('logs'), data: z.array(logSchema)}),
    z.object({
        ...base,
        kind: z.literal('phase'),
        data: z.object({phase: z.enum(phases), index: z.number().optional()})
    }),
    z.object({...base, kind: z.literal('logs_cleared'), data: z.object({})}),
    z.object({...base, kind: z.literal('error'), data: z.object({message: z.string()})}),
]);
export type ConsoleEvent = z.infer<typeof consoleEventSchema>;
export type ConsolePatch = z.infer<typeof patchSchema>;
