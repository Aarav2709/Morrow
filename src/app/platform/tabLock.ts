// only one window may write to the workspace at a time, others wait or take over
const LOCK_NAME = 'morrow-workspace';
const CHANNEL_NAME = 'morrow';

let release: (() => void) | null = null;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

function hold(resolve: () => void): Promise<void> {
  resolve();
  return new Promise<void>((done) => {
    release = done;
  });
}

// waits briefly because a reloading window may still be releasing the lock
export function tryAcquireLock(waitMs = 2000): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    navigator.locks
      .request(LOCK_NAME, { signal: AbortSignal.timeout(waitMs) }, () => hold(() => resolve(true)))
      .catch(() => resolve(false));
  });
}

// asks the current owner to step aside and waits for the lock
export function takeOverLock(): Promise<void> {
  if (!navigator.locks) return Promise.resolve();
  channel?.postMessage({ type: 'takeover' });
  return new Promise((resolve) => {
    void navigator.locks.request(LOCK_NAME, () => hold(resolve));
  });
}

export function onTakeoverRequest(handler: () => Promise<void>): () => void {
  if (!channel) return () => {};
  const listener = (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type !== 'takeover') return;
    void handler().finally(() => {
      release?.();
      release = null;
    });
  };
  channel.addEventListener('message', listener);
  return () => channel.removeEventListener('message', listener);
}
