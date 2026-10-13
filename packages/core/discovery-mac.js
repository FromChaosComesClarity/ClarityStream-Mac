'use strict';
// Finding hosts, on macOS.
//
// Sunshine advertises _nvstream._tcp over mDNS, the same as everywhere. What
// differs is the tool: there is no avahi-browse, there is `dns-sd`, and it
// browses until it is stopped rather than answering and exiting. So each step
// is given a time limit and whatever it printed by then is used.
//
// The resolved `.local` name is kept rather than chased down to an address.
// macOS resolves those itself, so the extra lookup would add a round of
// parsing and a way to fail for nothing.

const { runFor } = require('./run');

const SERVICE = '_nvstream._tcp';

// `dns-sd -B` prints a table. The rows that matter say Add, and the instance
// name is everything after the service type, which may contain spaces.
function parseBrowse(stdout) {
  const names = [];
  for (const line of (stdout ?? '').split('\n')) {
    if (!/\bAdd\b/.test(line)) continue;
    const at = line.indexOf(`${SERVICE}.`);
    if (at === -1) continue;
    const name = line.slice(at + SERVICE.length + 1).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// `dns-sd -L` says: "<instance> can be reached at <host>:<port> (interface N)"
function parseResolve(stdout) {
  const m = /can be reached at\s+(\S+?):(\d+)/.exec(stdout ?? '');
  if (!m) return null;
  // Trailing dot on a fully qualified name is correct and confuses everything
  // that is handed it later.
  return { host: m[1].replace(/\.$/, ''), port: Number(m[2]) || 47989 };
}

async function discover({ browseMs = 3000, resolveMs = 2500 } = {}) {
  const browse = await runFor('dns-sd', ['-B', SERVICE], browseMs);
  if (!browse.ok) {
    return { ok: false, reason: `dns-sd could not run: ${browse.reason}`, hosts: [] };
  }
  const names = parseBrowse(browse.stdout);
  if (!names.length) return { ok: true, hosts: [] };

  // Resolved together rather than one after another: three hosts should not
  // cost three times the wait on a window the user is staring at.
  const hosts = await Promise.all(names.map(async (name) => {
    const r = await runFor('dns-sd', ['-L', name, SERVICE, 'local'], resolveMs);
    const addr = r.ok ? parseResolve(r.stdout) : null;
    return {
      name,
      // Without a resolved name the instance name is the best guess, and it
      // is usually the hostname anyway.
      address: addr?.host ?? `${name}.local`,
      port: addr?.port ?? 47989,
      resolved: Boolean(addr)
    };
  }));
  return { ok: true, hosts };
}

module.exports = { discover, parseBrowse, parseResolve, SERVICE };
