'use strict';
// Asking a host what it is doing. The same on every platform, because it is
// just HTTP, and curl ships with macOS.

const { tryExec } = require('./run');

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml ?? '');
  return m ? m[1] : null;
}

function serverInfo(address, port = 47989, { uniqueId = '0123456789ABCDEF', timeout = 5000 } = {}) {
  const url = `http://${address}:${port}/serverinfo?uniqueid=${uniqueId}`;
  const r = tryExec('curl', ['-s', '-m', String(Math.ceil(timeout / 1000)), url], { timeout: timeout + 2000 });
  if (!r.ok || !r.stdout) return { reachable: false, reason: 'No answer from the host.' };
  const current = tag(r.stdout, 'currentgame');
  return {
    reachable: true,
    hostname: tag(r.stdout, 'hostname'),
    version: tag(r.stdout, 'appversion'),
    state: tag(r.stdout, 'state'),
    // A session already running refuses a new one, and the message a client
    // shows for that is unhelpfully generic.
    busy: /BUSY/i.test(tag(r.stdout, 'state') ?? ''),
    currentGameId: current && current !== '0' ? current : null
  };
}

module.exports = { serverInfo };
