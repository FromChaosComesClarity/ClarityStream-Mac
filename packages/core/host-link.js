'use strict';
// Asking a host what it is doing. Plain HTTP on 47989, which needs no pairing.
//
// Asked from this process rather than through curl. macOS gates the local
// network per application, and it only asks permission when the application
// itself connects: a curl it starts is refused with EHOSTUNREACH and nobody
// is asked, so an installed copy reported every host as "not answering" and
// never showed the prompt that would have fixed it. Run from a terminal it
// worked, because there the terminal's permission applied.

const http = require('node:http');

function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(xml ?? '');
  return m ? m[1] : null;
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
  return new Promise((resolve) => {
    let settled = false;
    const done = (xml, reason) => {
      if (settled) return;
      settled = true;
      const r = parseServerInfo(xml);
      resolve(r.reachable || !reason ? r : { ...r, reason });
    };
    const req = http.get({
      host: address, port, path: `/serverinfo?uniqueid=${uniqueId}`, timeout
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => done(body));
      res.on('error', (err) => done('', `No answer from the host: ${err.code ?? err.message}`));
    });
    req.on('timeout', () => { req.destroy(); done('', 'No answer from the host in time.'); });
    // EHOSTUNREACH here, for a host that answers everything else on this Mac,
    // is macOS refusing this application the local network.
    req.on('error', (err) => done('', `No answer from the host: ${err.code ?? err.message}`));
  });
}

module.exports = { serverInfo, parseServerInfo };
