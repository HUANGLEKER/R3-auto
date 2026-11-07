import { acquireSingleInstanceLock, releaseSingleInstanceLock } from '../../src/core/lock.ts';

process.send?.({ type: 'ready' });
process.on('message', message => {
    if (message === 'acquire') {
        try {
            acquireSingleInstanceLock();
            process.send?.({ type: 'result', acquired: true });
        } catch (error: any) {
            process.send?.({ type: 'result', acquired: false, reason: error.message });
        }
    }
    if (message === 'release') {
        releaseSingleInstanceLock();
        process.disconnect?.();
    }
});
