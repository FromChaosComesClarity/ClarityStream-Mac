'use strict';
// Moonlight, on macOS.
//
// Three things differ from the Linux client and all three are found rather
// than assumed, because assuming a path is what has cost this project the
// most time: the application is a bundle in an unpredictable place, its
// settings are a plist rather than an INI, and the key names inside that
// plist come from Qt rather than from Moonlight.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { tryExec, which } = require('./run');
const plist = require('./plist-xml');

const HOME = os.homedir();

// Where a person might reasonably have put it, in the order macOS itself
// would look. Homebrew's cask is not a separate place: it installs into
// /Applications, leaves only a symlink in its versioned Caskroom folder, and
// links a `moonlight` command into its bin, which the PATH check finds.
const BUNDLE_PLACES = [
  '/Applications/Moonlight.app',
  path.join(HOME, 'Applications', 'Moonlight.app')
];

function bundleExecutable(bundle) {
  const exe = path.join(bundle, 'Contents', 'MacOS', 'Moonlight');
  try { fs.accessSync(exe, fs.constants.X_OK); return exe; } catch { return null; }
}

// Spotlight knows where applications are even when nobody else does, so it is
// the last resort rather than the first guess: it is slow and it is off on
// some machines.
function findViaSpotlight() {
  const r = tryExec('mdfind', ['kMDItemCFBundleIdentifier == "com.moonlight-stream.Moonlight"'], { timeout: 8000 });
  if (!r.ok) return null;
  for (const line of r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const exe = bundleExecutable(line);
    if (exe) return { bundle: line, exe };
  }
  return null;
}

function find() {
  const tried = [];
  for (const b of BUNDLE_PLACES) {
    tried.push(b);
    const exe = bundleExecutable(b);
    if (exe) return { found: true, bundle: b, exe, via: 'the usual places', tried };
  }
  const spot = findViaSpotlight();
  if (spot) return { found: true, ...spot, via: 'Spotlight', tried: [...tried, 'Spotlight'] };

  // A command-line moonlight is unusual on macOS but costs nothing to check.
  const cli = which('moonlight');
  if (cli) return { found: true, bundle: null, exe: cli, via: 'PATH', tried: [...tried, 'PATH'] };

  return { found: false, exe: null, tried };
}

// Qt names the plist after the organisation's domain, reversed, and the
// application: Moonlight 6.2 writes com.moonlight-stream.Moonlight.plist, and
// only appears there once it has been opened. Anything else in Moonlight's own
// domain is accepted in case the application name changes, but nothing outside
// it: "any name containing moonlight" picked up the game Moonlighter on the
// first Mac this ran on, and read it as a Moonlight that knew no hosts.
const SETTINGS_NAME = 'com.moonlight-stream.Moonlight.plist';

function pickSettingsFile(names) {
  const candidates = names
    .filter((n) => /^com\.moonlight-stream\.[^/]+\.plist$/i.test(n))
    .sort((a, b) => (b === SETTINGS_NAME) - (a === SETTINGS_NAME));
  return candidates[0] ?? null;
}

function settingsFile() {
  const dir = path.join(HOME, 'Library', 'Preferences');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const name = pickSettingsFile(names);
  return name ? path.join(dir, name) : null;
}

// plutil ships with macOS, so the plist is converted rather than decoded by
// hand: binary plists are the normal case. It is converted to XML, not JSON,
// because the certificates in it are <data>, which JSON cannot hold and
// plutil will not drop.
function readSettings() {
  const file = settingsFile();
  if (!file) return { ok: false, reason: 'No Moonlight preferences file found. Has Moonlight been opened once?', file: null };
  const r = tryExec('plutil', ['-convert', 'xml1', '-o', '-', file], { timeout: 8000 });
  if (!r.ok) return { ok: false, reason: `plutil could not read ${file}: ${(r.stderr ?? '').trim()}`, file };
  try { return { ok: true, file, data: plist.parse(r.stdout) }; }
  catch (err) { return { ok: false, reason: `Could not read ${file} as a property list: ${err.message}`, file }; }
}

// On macOS QSettings flattens its groups into single keys joined by dots, so a
// host looks like "hosts.1.hostname" (the Linux .conf has slashes). Each
// address has its own port beside it, and an address that is not set is an
// empty string with a port of 0, not a missing key.
function hostsFromSettings(data) {
  if (!data || typeof data !== 'object') return [];
  const hosts = new Map();
  const get = (i) => {
    if (!hosts.has(i)) hosts.set(i, { index: i, apps: [] });
    return hosts.get(i);
  };

  for (const [key, value] of Object.entries(data)) {
    const m = /^hosts\.(\d+)\.(.+)$/.exec(key);
    if (!m) continue;
    const h = get(Number(m[1]));
    const field = m[2];

    const app = /^apps\.(\d+)\.(.+)$/.exec(field);
    if (app) {
      const n = Number(app[1]) - 1;
      h.apps[n] = h.apps[n] ?? {};
      if (app[2] === 'name') h.apps[n].name = String(value);
      if (app[2] === 'id') h.apps[n].id = String(value);
      if (app[2] === 'hidden') h.apps[n].hidden = value === true || value === 'true';
      continue;
    }

    if (field === 'hostname') h.hostname = String(value);
    if (field === 'uuid') h.uuid = String(value);
    if (field === 'manualaddress') h.manualAddress = value ? String(value) : null;
    if (field === 'localaddress') h.localAddress = value ? String(value) : null;
    if (field === 'remoteaddress') h.remoteAddress = value ? String(value) : null;
    if (field === 'manualport') h.manualPort = Number(value) || null;
    if (field === 'localport') h.localPort = Number(value) || null;
    if (field === 'remoteport') h.remotePort = Number(value) || null;
    // Pairing is proven by the server certificate Moonlight keeps once it has
    // paired. Asking the host does not work: /serverinfo over plain HTTP
    // reports PairStatus 0 even for a paired client. It is <data>, so it
    // arrives as a Buffer, and an unpaired host has an empty one.
    if (field === 'srvcert') h.paired = (value?.length ?? 0) > 20;
  }

  return [...hosts.values()]
    .filter((h) => h.hostname)
    .map((h) => {
      // The port goes with the address it was stored beside.
      const [address, port] = [
        [h.manualAddress, h.manualPort],
        [h.localAddress, h.localPort],
        [h.remoteAddress, h.remotePort]
      ].find(([a]) => a) ?? [h.hostname, null];
      return {
        ...h,
        apps: h.apps.filter(Boolean).filter((a) => a.name && !a.hidden),
        address,
        port: port || 47989,
        paired: Boolean(h.paired)
      };
    });
}

function knownHosts() {
  const s = readSettings();
  if (!s.ok) return { ok: false, reason: s.reason, file: s.file, hosts: [] };
  return { ok: true, file: s.file, hosts: hostsFromSettings(s.data) };
}

function randomPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function pairArgs(address, pin) { return ['pair', address, '--pin', pin]; }

// How Moonlight gets out of the way of this Mac's own shortcuts.
//
//   never       Command-Tab and the rest stay here, so they do not reach the
//               host and a stream window can be closed out from under you
//   fullscreen  they go to the host while the stream is fullscreen
//   always      they go to the host even windowed
//
// On macOS this needs Moonlight to hold Accessibility permission, in System
// Settings under Privacy & Security. Without it the setting is accepted and
// quietly does nothing, which is worth saying in the window rather than
// leaving someone to discover.
//
// Ctrl+Alt+Shift+Q always ends the session whatever the setting: Moonlight
// reserves it so there is a way out of a capture that is working.
const CAPTURE_KEYS = ['never', 'fullscreen', 'always'];
const ESCAPE_COMBO = 'Ctrl+Alt+Shift+Q';

function streamArgs(address, appName, opts = {}) {
  const args = ['stream', address, appName];
  if (opts.captureSystemKeys && CAPTURE_KEYS.includes(opts.captureSystemKeys)) {
    args.push('--capture-system-keys', opts.captureSystemKeys);
  }
  if (opts.resolution) args.push('--resolution', opts.resolution);
  if (opts.fps) args.push('--fps', String(opts.fps));
  if (opts.bitrate) args.push('--bitrate', String(opts.bitrate));
  if (opts.displayMode) args.push('--display-mode', opts.displayMode);
  if (opts.vsync === false) args.push('--no-vsync');
  return args;
}

module.exports = {
  find, pickSettingsFile, settingsFile, readSettings, hostsFromSettings, knownHosts,
  randomPin, pairArgs, streamArgs, CAPTURE_KEYS, ESCAPE_COMBO, BUNDLE_PLACES
};
