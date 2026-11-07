import { currentRunContext, currentRunId, newRunId, withRunContext } from './run_context.ts';
import { acquireSingleInstanceLock, releaseSingleInstanceLock } from './lock.ts';

/** Owns the run scope and lock; callers drain external operations before release. */
export class RunSession {
    static execute<T>(id: string | undefined, operation: () => T): T {
        return currentRunContext() ? operation() : withRunContext(id ?? newRunId(), operation);
    }
    readonly runId = currentRunId();
    acquire(): void { acquireSingleInstanceLock(); }
    release(): void { releaseSingleInstanceLock(); }
}
