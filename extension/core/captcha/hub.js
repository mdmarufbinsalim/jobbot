// The meeting point between the solver and whatever interface a person uses (the extension's side panel, locally or
// through the server's HTTP API). One challenge at a time; everything is in memory and dropped when it ends.
//
//   solver side:  open(meta) / update(patch) / wait(id, signal) / finish(status, message)
//   panel side:   view() / respond(answer)
//
// status: awaiting (needs a person) · working (clicking / checking) · solved · closed (given up or cancelled)
let current = null, waiter = null, seq = 0;
const listeners = new Set();
const notify = () => { for (const fn of listeners) try { fn(); } catch {} };
const id = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export const hub = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  open(meta) { current = { id: id(), status: 'awaiting', attempt: 1, lastResult: null, message: '', ...meta }; notify(); return current.id; },
  update(patch) { if (current) { Object.assign(current, patch); notify(); } },
  // Ends the challenge. The image goes at once; the small record stays so the panel can show how it ended.
  finish(status, message = '', lastResult = current?.lastResult ?? null) {
    if (!current) return;
    Object.assign(current, { status, message, lastResult, image: null });
    if (waiter) { waiter.resolve({ action: 'giveup' }); waiter = null; }
    if (status === 'solved') { const done = current; setTimeout(() => { if (current === done) hub.clear(); }, 3000); } // show the result briefly
    notify();
  },
  clear() { current = null; waiter = null; notify(); },

  // Waits for the next answer from a panel: { action: 'submit' | 'refresh' | 'giveup', ... }. Aborting gives 'giveup'.
  wait(forId, signal) {
    return new Promise((resolve) => {
      if (!current || current.id !== forId || signal?.aborted) return resolve({ action: 'giveup' });
      const done = (a) => { signal?.removeEventListener('abort', onAbort); waiter = null; resolve(a); };
      const onAbort = () => done({ action: 'giveup' });
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter = { resolve: done, id: forId };
    });
  },

  // What panels see. Never includes more than the current challenge.
  view() { return current ? { ...current } : null; },
  // Called by a panel. Throws if the answer is for a challenge that is no longer the current one.
  respond(answer) {
    if (!current || answer?.id !== current.id) throw new Error('that challenge is no longer showing');
    if (current.status !== 'awaiting' || !waiter) throw new Error('the challenge is not waiting for an answer');
    waiter.resolve(answer);
  },
};
