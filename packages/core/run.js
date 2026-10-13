'use strict';
const { execFile, execFileSync, spawn } = require('node:child_process');

// Every probe reads something real. When a command is missing or fails we
// record that it failed rather than substituting a plausible default: a
// guessed fact is worse than a missing one.
function tryExec(cmd, args = [], opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout ?? 5000,
      maxBuffer: 16 * 1024 * 1024
    });
    return { ok: true, stdout, cmd: [cmd, ...args].join(' ') };
  } catch (err) {
    return {
      ok: false,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : String(err.message),
      code: err.status ?? null,
      cmd: [cmd, ...args].join(' ')
    };
  }
}

// macOS has no coreutils `timeout`, and `dns-sd` browses until it is stopped.
// So anything that never exits on its own is run for a fixed time and then
// killed, keeping whatever it printed.
function runFor(cmd, args, ms) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, stdout: '', reason: err.message });
      return;
    }
    const done = (ok, reason) => {
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      resolve({ ok, stdout: out, reason });
    };
    const timer = setTimeout(() => done(true, 'time limit reached'), ms);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => done(false, err.message));
    child.on('close', () => done(true, 'exited'));
  });
}

function which(bin) {
  const r = tryExec('/bin/sh', ['-c', `command -v ${bin}`]);
  return r.ok ? r.stdout.trim() : null;
}

module.exports = { tryExec, runFor, which, execFile, spawn };
