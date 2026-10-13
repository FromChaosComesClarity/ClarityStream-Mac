'use strict';
// The macOS-specific parsing. None of this can be run on the machine it was
// written on, so the shapes are pinned here instead: a QSettings plist once
// plutil has flattened it to JSON, and dns-sd's output.
const { test } = require('node:test');
const assert = require('node:assert');
const { hostsFromSettings, pickSettingsFile } = require('../packages/core/moonlight-mac');
const plist = require('../packages/core/plist-xml');
const { parseBrowse, parseResolve } = require('../packages/core/discovery-mac');

// QSettings on macOS writes its groups as dot-joined keys, so the plist is
// flat. Shape copied from Moonlight 6.2.0's own plist on an M2 Mac; addresses
// are documentation values. Certificates are <data>, so they arrive as Buffers.
const PLIST = {
  'hosts.1.customname': false,
  'hosts.1.hostname': 'omarchy',
  'hosts.1.uuid': '00000000-0000-4000-8000-000000000001',
  'hosts.1.ipv6address': '',
  'hosts.1.ipv6port': 0,
  'hosts.1.manualaddress': '',
  'hosts.1.manualport': 0,
  'hosts.1.localaddress': '192.0.2.10',
  'hosts.1.localport': 47989,
  'hosts.1.remoteaddress': '198.51.100.7',
  'hosts.1.remoteport': 47999,
  'hosts.1.mac': Buffer.alloc(0),
  'hosts.1.srvcert': Buffer.from('-----BEGIN CERTIFICATE-----\nMIIC0jCCAbqgAwIBAgIUZ...\n-----END CERTIFICATE-----\n'),
  'hosts.1.apps.1.name': 'Clarity Couch Mode',
  'hosts.1.apps.1.id': 348444178,
  'hosts.1.apps.1.hidden': false,
  'hosts.1.apps.2.name': 'Clarity Desktop',
  'hosts.1.apps.2.id': 1684772458,
  'hosts.1.apps.2.hidden': false,
  'hosts.1.apps.3.name': 'Hidden One',
  'hosts.1.apps.3.id': 999,
  'hosts.1.apps.3.hidden': true,
  'hosts.2.hostname': 'never-paired',
  'hosts.2.manualaddress': '',
  'hosts.2.manualport': 0,
  'hosts.2.localaddress': '192.0.2.11',
  'hosts.2.localport': 47989,
  'hosts.2.srvcert': Buffer.alloc(0),
  'hosts.size': 2,
  'latestsupportedversion-v1': '99.99.99.99',
  'gcmapping.size': 0
};

test('hosts come out of a flattened plist', () => {
  const hosts = hostsFromSettings(PLIST);
  assert.strictEqual(hosts.length, 2);
  const omarchy = hosts.find((h) => h.hostname === 'omarchy');
  assert.ok(omarchy);
  assert.strictEqual(omarchy.address, '192.0.2.10');
  assert.strictEqual(omarchy.port, 47989);
});

test('pairing is read from the stored certificate, not from the host', () => {
  // Asking the host does not work: /serverinfo over plain HTTP reports
  // PairStatus 0 even for a client that is paired.
  const hosts = hostsFromSettings(PLIST);
  assert.strictEqual(hosts.find((h) => h.hostname === 'omarchy').paired, true);
  assert.strictEqual(hosts.find((h) => h.hostname === 'never-paired').paired, false);
});

test('hidden apps are left out and the rest keep their order', () => {
  const apps = hostsFromSettings(PLIST).find((h) => h.hostname === 'omarchy').apps;
  assert.deepStrictEqual(apps.map((a) => a.name), ['Clarity Couch Mode', 'Clarity Desktop']);
});

test('an empty manualaddress does not win over a real one', () => {
  // Qt writes the key with an empty string rather than omitting it.
  assert.strictEqual(hostsFromSettings(PLIST)[0].address, '192.0.2.10');
});

test('rubbish in, nothing out, no crash', () => {
  assert.deepStrictEqual(hostsFromSettings(null), []);
  assert.deepStrictEqual(hostsFromSettings({}), []);
  assert.deepStrictEqual(hostsFromSettings({ 'hosts.1.uuid': 'no hostname here' }), []);
});

test('dns-sd browse: Add rows only, names may contain spaces', () => {
  const out = [
    'Browsing for _nvstream._tcp',
    'Timestamp     A/R Flags if Domain Service Type    Instance Name',
    '21:30:00.456  Add     3  4 local. _nvstream._tcp.   omarchy',
    '21:30:00.457  Add     2  4 local. _nvstream._tcp.   living room pc',
    '21:30:01.000  Rmv     0  4 local. _nvstream._tcp.   gone-away'
  ].join('\n');
  assert.deepStrictEqual(parseBrowse(out), ['omarchy', 'living room pc']);
});

test('dns-sd resolve: the trailing dot is dropped', () => {
  // A fully qualified name ends in a dot, which is correct and confuses
  // everything downstream that is handed it.
  const r = parseResolve('21:30:05.1  omarchy._nvstream._tcp.local. can be reached at omarchy.local.:47989 (interface 4)');
  assert.deepStrictEqual(r, { host: 'omarchy.local', port: 47989 });
});

test('dns-sd output that resolves nothing is null, not a guess', () => {
  assert.strictEqual(parseResolve('Lookup omarchy._nvstream._tcp.local'), null);
  assert.strictEqual(parseResolve(''), null);
  assert.strictEqual(parseBrowse('').length, 0);
});

test('a manual address brings its own port', () => {
  const h = hostsFromSettings({ ...PLIST, 'hosts.1.manualaddress': '192.0.2.99', 'hosts.1.manualport': 48000 })
    .find((x) => x.hostname === 'omarchy');
  assert.strictEqual(h.address, '192.0.2.99');
  assert.strictEqual(h.port, 48000);
});

test("Moonlight's own plist is chosen, never a game called Moonlighter", () => {
  // The first Mac this ran on had Moonlighter installed and no Moonlight.
  assert.strictEqual(pickSettingsFile(['unity.DigitalSunGames.Moonlighter.plist']), null);
  assert.strictEqual(
    pickSettingsFile(['unity.DigitalSunGames.Moonlighter.plist', 'com.moonlight-stream.Moonlight.plist']),
    'com.moonlight-stream.Moonlight.plist');
});

test('plist XML: data, empty elements, entities, nesting', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>certificate</key>
	<data>
	LS0tLS1CRUdJTg==
	</data>
	<key>hosts.1.mac</key>
	<data>
	</data>
	<key>hosts.1.hostname</key>
	<string>a &amp; b &lt;c&gt;</string>
	<key>blank</key>
	<string></string>
	<key>hosts.1.localport</key>
	<integer>47989</integer>
	<key>on</key>
	<true/>
	<key>off</key>
	<false/>
	<key>list</key>
	<array><integer>1</integer><dict/></array>
</dict>
</plist>`;
  const d = plist.parse(xml);
  assert.strictEqual(d.certificate.toString(), '-----BEGIN');
  assert.strictEqual(d['hosts.1.mac'].length, 0);
  assert.strictEqual(d['hosts.1.hostname'], 'a & b <c>');
  assert.strictEqual(d.blank, '');
  assert.strictEqual(d['hosts.1.localport'], 47989);
  assert.strictEqual(d.on, true);
  assert.strictEqual(d.off, false);
  assert.strictEqual(d.list.length, 2);
  assert.throws(() => plist.parse('<plist><dict><key>x</key>'));
});
