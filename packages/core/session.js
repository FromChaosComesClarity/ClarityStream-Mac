'use strict';
// Ending a session, and knowing whether it ended.
//
// Closing Moonlight's window does not end a Sunshine session: the host goes on
// reporting SUNSHINE_SERVER_BUSY and refuses the next connection until its own
// timeout gives up. Moonlight's `quit` verb is the only thing a client holds,
// and it cannot be taken at its word. On this Mac, unpaired, against a host
// with no session, it ran for nine seconds, sent the host nothing but
// /serverinfo, and exited 0.
//
// So the host is asked before and after, and the answer is what the host
// says. What this cannot do is force a session closed: that is Sunshine's
// authenticated /api/apps/close, whose credentials only the host has.

const HOST_WINDOW = 'The Stop button in the host’s own window ends it.';

async function endSession({
  address, port = 47989, paired,
  // Injected so what matters here, what is concluded from the host's state
  // over time, can be tested without a host or a Moonlight.
  probe, quit,
  timeout = 25000, pollMs = 1000
}) {
  const started = Date.now();
  const waited = () => Date.now() - started;
  const secs = () => Math.round(waited() / 1000);

  const before = await probe(address, port);
  if (!before.reachable) {
    return { ok: false, ended: null, reason: 'The host did not answer, so nothing was asked of it.' };
  }
  if (!before.busy) {
    return { ok: true, ended: true, alreadyFree: true, reason: 'No session was running.' };
  }
  // Moonlight sends the request with the certificate it got when it paired.
  // Unpaired, it sends nothing and still exits 0, so there is no point
  // waiting out the deadline to learn what is already known.
  if (!paired) {
    return {
      ok: false, ended: false,
      reason: `This Mac is not paired with the host, so it cannot ask it to stop. ${HOST_WINDOW}`
    };
  }

  // Waited for, not fired and forgotten. Moonlight starts a whole Qt
  // application to send this one request, so it takes seconds.
  const r = await quit(address);
  const commandOk = Boolean(r?.ok);

  // The exit status is reported and not trusted. The host's state decides.
  for (;;) {
    const now = await probe(address, port);
    if (now.reachable && !now.busy) return { ok: true, ended: true, waitedMs: waited(), commandOk };
    if (waited() >= timeout) {
      return {
        ok: false, ended: now.reachable ? false : null, waitedMs: waited(), commandOk,
        reason: now.reachable
          ? `The host still reports a session after ${secs()}s. Moonlight’s quit ends the ` +
            `running app, which does not always release the session. ${HOST_WINDOW}`
          : 'The host stopped answering while it was being checked, so whether the session ended is unknown.'
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

module.exports = { endSession };
