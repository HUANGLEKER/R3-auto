const mode = process.env.IPC_TEST_MODE;
if (mode === 'exit') process.exit(1);
if (mode !== 'timeout') {
    console.log('http://127.0.0.1:9999');
    process.send?.({ type: 'r3:ready', instanceId: 'wrong', pid: process.pid, port: 9999 });
    process.send?.({ type: 'r3:ready', instanceId: process.env.R3_WEB_INSTANCE_ID, pid: process.pid, port: 32123 });
}
process.on('message', message => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'r3:shutdown') {
        process.disconnect?.();
    }
});
process.on('disconnect', () => process.exit(0));
