'use strict';
// Clarity Stream client, macOS.
//
// A face over Moonlight rather than a reimplementation of it, the same as the
// Linux client. What differs is underneath: there is no avahi, Moonlight is an
// application bundle rather than a binary on PATH, and its settings are a
// plist rather than an INI.
//
// Everything about the host is read from Moonlight's own configuration, so
// the two never disagree about what is paired.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const discovery = require('../../packages/core/discovery-mac');
const moonlight = require('../../packages/core/moonlight-mac');
const hostLink = require('../../packages/core/host-link');

const DEV = process.argv.includes('--dev');
let win = null;

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  resolution: '1920x1080',
  fps: 60,
  bitrate: 20000,
  displayMode: 'fullscreen',
  vsync: true,
  preferredApp: 'Clarity Couch Mode'
};

function readSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 540,
    backgroundColor: '#11131a',
    title: 'Clarity Stream Client',
    // The traffic lights sit inside the window's own chrome, which looks
    // native without the app having to draw a title bar it does not want.
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

// Moonlight is launched by its executable rather than through `open`, so that
// arguments arrive as arguments. `open -a` hands them over differently and
// the stream flags are lost.
function launchMoonlight(args) {
  const found = moonlight.find();
  if (!found.found) return { ok: false, reason: 'Moonlight is not installed, or not anywhere I looked.' };
  const child = spawn(found.exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { ok: true, command: [found.exe, ...args].join(' ') };
}

// What the network advertises, merged with what Moonlight already knows. A
// host can be in either, both or neither, and each combination means
// something different to the person looking at the list.
async function hosts() {
  const known = moonlight.knownHosts();
  const byName = new Map();

  for (const k of known.hosts) {
    byName.set(k.hostname.toLowerCase(), {
      name: k.hostname,
      address: k.address,
      port: k.port ?? 47989,
      paired: k.paired,
      apps: k.apps,
      known: true,
      discovered: false
    });
  }

  const found = await discovery.discover();
  for (const d of found.hosts) {
    const key = d.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.discovered = true;
      // A discovered address beats a stored one, which is often a stale
      // address or a "localhost" left over from a test.
      if (d.resolved) { existing.address = d.address; existing.port = d.port; }
    } else {
      byName.set(key, {
        name: d.name, address: d.address, port: d.port,
        paired: false, apps: [], known: false, discovered: true
      });
    }
  }

  // Asked in parallel: one unreachable host should not hold up the rest.
  return Promise.all([...byName.values()].map(async (h) => {
    const info = hostLink.serverInfo(h.address, h.port, { timeout: 2500 });
    return {
      ...h,
      reachable: info.reachable,
      busy: Boolean(info.busy),
      state: info.state ?? null,
      version: info.version ?? null,
      currentGameId: info.currentGameId ?? null
    };
  }));
}

ipcMain.handle('hosts', async () => {
  const found = moonlight.find();
  const known = moonlight.knownHosts();
  return {
    hosts: await hosts(),
    moonlight: found.found,
    moonlightPath: found.exe,
    moonlightVia: found.via ?? null,
    settingsFile: known.file ?? null,
    settingsProblem: known.ok ? null : known.reason,
    settings: readSettings()
  };
});

ipcMain.handle('settings:set', (_e, patch) => writeSettings(patch ?? {}));

ipcMain.handle('pair:start', (_e, { address }) => {
  const pin = moonlight.randomPin();
  const r = launchMoonlight(moonlight.pairArgs(address, pin));
  return { ...r, pin, address };
});

ipcMain.handle('launch', (_e, { address, appName, settings }) => {
  const s = { ...readSettings(), ...(settings ?? {}) };
  return launchMoonlight(moonlight.streamArgs(address, appName, {
    resolution: s.resolution, fps: s.fps, bitrate: s.bitrate,
    displayMode: s.displayMode, vsync: s.vsync
  }));
});

ipcMain.handle('open:moonlight', () => launchMoonlight([]));

ipcMain.handle('open:external', (_e, url) => {
  if (!/^https?:\/\//i.test(String(url))) return false;
  shell.openExternal(url);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// On macOS an application normally stays running with no windows. This one has
// nothing to do without its window, so it goes.
app.on('window-all-closed', () => app.quit());
