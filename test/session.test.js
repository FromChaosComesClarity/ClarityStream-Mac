'use strict';
// What the Stop button concludes, from the host's state over time. The host
// and Moonlight are stand-ins; the conclusions are the thing under test.
const { test } = require('node:test');
const assert = require('node:assert');
const { endSession } = require('../packages/core/session');
const { parseServerInfo } = require('../packages/core/host-link');
const { quitArgs } = require('../packages/core/moonlight-mac');

const FREE = { reachable: true, busy: false };
const BUSY = { reachable: true, busy: true };
const GONE = { reachable: false };

// Answers in order, then keeps giving the last one.
function host(...answers) {
  const asked = [];
  return {
    asked,
    probe: async (address, port) => { asked.push([address, port]); return answers[Math.min(asked.length - 1, answers.length - 1)]; }
  };
}
function moonlight(result = { ok: true }) {
  const calls = [];
  return { calls, quit: async (address) => { calls.push(address); return result; } };
}
const fast = { timeout: 60, pollMs: 5 };

test('an unreachable host is not asked anything and nothing is claimed', async () => {
  const h = host(GONE); const m = moonlight();
  const r = await endSession({ address: 'omarchy.local', paired: true, probe: h.probe, quit: m.quit, ...fast });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ended, null);
  assert.strictEqual(m.calls.length, 0);
});

test('a host with no session runs nothing', async () => {
  const h = host(FREE); const m = moonlight();
  const r = await endSession({ address: 'omarchy.local', paired: true, probe: h.probe, quit: m.quit, ...fast });
  assert.deepStrictEqual([r.ok, r.ended, r.alreadyFree], [true, true, true]);
  assert.strictEqual(m.calls.length, 0);
});

test('unpaired, it says so at once rather than running a quit that sends nothing', async () => {
  // Seen on this Mac: unpaired, `Moonlight quit` sent the host only
  // /serverinfo and exited 0.
  const h = host(BUSY); const m = moonlight();
  const r = await endSession({ address: 'omarchy.local', paired: false, probe: h.probe, quit: m.quit, ...fast });
  assert.strictEqual(r.ended, false);
  assert.match(r.reason, /not paired/);
  assert.match(r.reason, /host’s own window/);
  assert.strictEqual(m.calls.length, 0);
});

test('ended only once the host stops reporting a session', async () => {
  const h = host(BUSY, BUSY, BUSY, FREE); const m = moonlight();
  const r = await endSession({ address: 'omarchy.local', port: 47989, paired: true, probe: h.probe, quit: m.quit, timeout: 5000, pollMs: 5 });
  assert.deepStrictEqual([r.ok, r.ended, r.commandOk], [true, true, true]);
  assert.deepStrictEqual(m.calls, ['omarchy.local']);
  assert.strictEqual(h.asked.length, 4);
  assert.deepStrictEqual(h.asked[0], ['omarchy.local', 47989]);
});

test('a quit that exits 0 is not success while the host is still busy', async () => {
  const h = host(BUSY); const m = moonlight({ ok: true });
  const r = await endSession({ address: 'omarchy.local', paired: true, probe: h.probe, quit: m.quit, ...fast });
  assert.deepStrictEqual([r.ok, r.ended, r.commandOk], [false, false, true]);
  assert.match(r.reason, /still reports a session/);
  assert.match(r.reason, /host’s own window/);
});

test('the host decides even when the command reports failure', async () => {
  const h = host(BUSY, FREE); const m = moonlight({ ok: false, code: 1 });
  const r = await endSession({ address: 'omarchy.local', paired: true, probe: h.probe, quit: m.quit, ...fast });
  assert.deepStrictEqual([r.ok, r.ended, r.commandOk], [true, true, false]);
});

test('a host that vanishes mid-check leaves the outcome unknown, not failed', async () => {
  const h = host(BUSY, GONE); const m = moonlight();
  const r = await endSession({ address: 'omarchy.local', paired: true, probe: h.probe, quit: m.quit, ...fast });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.ended, null);
  assert.match(r.reason, /unknown/);
});

test('quit names the host and nothing else', () => {
  assert.deepStrictEqual(quitArgs('omarchy.local'), ['quit', 'omarchy.local']);
});

test('/serverinfo: appversion is the protocol version, not Sunshine’s', () => {
  const xml = '<?xml version="1.0" encoding="utf-8"?><root status_code="200">' +
    '<hostname>omarchy</hostname><appversion>7.1.431.-1</appversion>' +
    '<state>SUNSHINE_SERVER_BUSY</state><currentgame>881448767</currentgame></root>';
  const r = parseServerInfo(xml);
  assert.strictEqual(r.protocolVersion, '7.1.431.-1');
  assert.strictEqual('version' in r, false);
  assert.strictEqual(r.busy, true);
  assert.strictEqual(r.currentGameId, '881448767');
  assert.deepStrictEqual(
    [parseServerInfo(xml.replace('BUSY', 'FREE').replace('881448767', '0')).busy,
      parseServerInfo(xml.replace('881448767', '0')).currentGameId],
    [false, null]);
  assert.strictEqual(parseServerInfo('').reachable, false);
});
