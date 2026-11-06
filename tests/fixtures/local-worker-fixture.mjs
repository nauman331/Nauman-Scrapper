let active = false;
process.send({ type: 'ready', pid: process.pid });
process.on('message', message => {
  if (message.type === 'shutdown') process.exit(0);
  if (message.type === 'cancel') {
    if (active === message.jobId) {
      process.send({ type: 'done', jobId: active });
      active = false;
    }
  }
  if (message.type === 'run') {
    if (message.payload.targetUrl === 'crash') process.exit(2);
    active = message.payload.jobId;
    // Use an IPC barrier to prove simultaneous jobs occupy distinct processes.
    if (message.payload.targetUrl === 'cancel') return;
    setTimeout(() => {
      if (active) process.send({ type: 'done', jobId: active, error: `pid:${process.pid}` });
      active = false;
    }, 300);
  }
});
process.on('disconnect', () => process.exit(0));
