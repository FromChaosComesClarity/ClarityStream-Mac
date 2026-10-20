'use strict';
// Asking a host what it is doing. The same on every platform, because it is
// just HTTP, and curl ships with macOS.

const { tryExec, execAsync } = require('./run');

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml ?? '');
  return m ? m[1] : null;
}

function serverInfoUrl(address, port, uniqueId) {
  return `http://${address}:${port}/serverinfo?uniqueid=${uniqueId}`;
}

function parseServerInfo(xml) {
  if (!xml) return { reachable: false, reason: 'No answer from the host.' };
  const current = tag(xml, 'currentgame');
  return {
    reachable: true,
    hostname: tag(xml, 'hostname'),
    // NOT Sunshine's version. `appversion` is the GameStream protocol version
    // Sunshine reports for compatibility (7.1.431.-1 from a host running
    // Sunshine 2026.914), and /serverinfo does not carry the real one at all.
    protocolVersion: tag(xml, 'appversion'),
    state: tag(xml, 'state'),
    // A session already running refuses a new one, and the message a client
    // shows for that is unhelpfully generic.
    busy: /BUSY/i.test(tag(xml, 'state') ?? ''),
    currentGameId: current && current !== '0' ? current : null
  };
}

function serverInfo(address, port = 47989, { uniqueId = '0123456789ABCDEF', timeout = 5000 } = {}) {
  const url = serverInfoUrl(address, port, uniqueId);
  const r = tryExec('curl', ['-s', '-m', String(Math.ceil(timeout / 1000)), url], { timeout: timeout + 2000 });
  return parseServerInfo(r.ok ? r.stdout : '');
}

// For anything that asks repeatedly, so the main process is free between
// answers.
async function serverInfoAsync(address, port = 47989, { uniqueId = '0123456789ABCDEF', timeout = 5000 } = {}) {
  const url = serverInfoUrl(address, port, uniqueId);
  const r = await execAsync('curl', ['-s', '-m', String(Math.ceil(timeout / 1000)), url], { timeout: timeout + 2000 });
  return parseServerInfo(r.ok ? r.stdout : '');
}

module.exports = { serverInfo, serverInfoAsync, parseServerInfo };
