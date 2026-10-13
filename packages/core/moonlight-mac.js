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

const HOME = os.homedir();

// Where a person might reasonably have put it, in the order macOS itself
// would look.
const BUNDLE_PLACES = [
  '/Applications/Moonlight.app',
  path.join(HOME, 'Applications', 'Moonlight.app'),
  '/opt/homebrew/Caskroom/moonlight/latest/Moonlight.app'
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

// Qt writes QSettings into a plist whose name comes from the organisation and
// application it was given, and Moonlight has used more than one over the
// years. So the file is looked for rather than named.
function settingsFile() {
  const dir = path.join(HOME, 'Library', 'Preferences');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const candidates = names
    .filter((n) => /moonlight/i.test(n) && n.endsWith('.plist'))
    // A domain that mentions the streaming project is more likely the app's
    // own than something else that merely has the word in its name.
    .sort((a, b) => (/moonlight-stream/i.test(b) ? 1 : 0) - (/moonlight-stream/i.test(a) ? 1 : 0));
  return candidates.length ? path.join(dir, candidates[0]) : null;
}

// plutil ships with macOS, so the plist is converted rather than parsed by
// hand. Binary plists are the normal case and are not readable as text.
function readSettings() {
  const file = settingsFile();
  if (!file) return { ok: false, reason: 'No Moonlight preferences file found.', file: null };
  const r = tryExec('plutil', ['-convert', 'json', '-o', '-', file], { timeout: 8000 });
  if (!r.ok) return { ok: false, reason: `plutil could not read ${file}`, file };
  try { return { ok: true, file, data: JSON.parse(r.stdout) }; }
  catch (err) { return { ok: false, reason: `That plist is not valid JSON once converted: ${err.message}`, file }; }
}

// QSettings flattens its groups into single keys joined by slashes, so a host
// looks like "hosts/1/hostname". The same information as the Linux .conf,
// wearing a different coat.
function hostsFromSettings(data) {
  if (!data || typeof data !== 'object') return [];
  const hosts = new Map();
  const get = (i) => {
    if (!hosts.has(i)) hosts.set(i, { index: i, apps: [] });
    return hosts.get(i);
  };

  for (const [key, value] of Object.entries(data)) {
    const m = /^hosts\/(\d+)\/(.+)$/.exec(key);
    if (!m) continue;
    const h = get(Number(m[1]));
    const field = m[2];

    const app = /^apps\/(\d+)\/(.+)$/.exec(field);
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
    if (field === 'manualport') h.port = Number(value) || 47989;
    // Pairing is proven by the server certificate Moonlight keeps once it has
    // paired. Asking the host does not work: /serverinfo over plain HTTP
    // reports PairStatus 0 even for a paired client.
    if (field === 'srvcert') h.paired = String(value ?? '').length > 20;
  }

  return [...hosts.values()]
    .filter((h) => h.hostname)
    .map((h) => ({
      ...h,
      apps: h.apps.filter(Boolean).filter((a) => a.name && !a.hidden),
      address: h.manualAddress || h.localAddress || h.remoteAddress || h.hostname,
      paired: Boolean(h.paired)
    }));
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

function streamArgs(address, appName, opts = {}) {
  const args = ['stream', address, appName];
  if (opts.resolution) args.push('--resolution', opts.resolution);
  if (opts.fps) args.push('--fps', String(opts.fps));
  if (opts.bitrate) args.push('--bitrate', String(opts.bitrate));
  if (opts.displayMode) args.push('--display-mode', opts.displayMode);
  if (opts.vsync === false) args.push('--no-vsync');
  return args;
}

module.exports = {
  find, settingsFile, readSettings, hostsFromSettings, knownHosts,
  randomPin, pairArgs, streamArgs, BUNDLE_PLACES
};
