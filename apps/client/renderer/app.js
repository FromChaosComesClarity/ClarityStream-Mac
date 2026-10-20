'use strict';
// Client renderer. Same rules as the host: textContent everywhere, because
// host names and addresses come off the network and building markup out of
// those buys nothing.

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

let data = null;
let selected = null;

function toast(message, bad = false) {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast${bad ? ' bad' : ''}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 4200);
}

/* ------------------------------------------------------------------ draw */

function drawHosts() {
  const list = $('hosts');
  list.replaceChildren();
  const hosts = data.hosts;
  $('hostCount').textContent = hosts.length
    ? `${hosts.length} found` : '';

  if (!data.moonlight) {
    list.append(el('li', 'pad muted',
      'Moonlight is not installed, or not where I looked: /Applications, ~/Applications, ' +
      'Spotlight and your PATH. Install it from ' +
      'moonlight-stream.org and press Look again.'));
    return;
  }
  if (data.settingsProblem) {
    // Everything known about pairing comes from Moonlight's own preferences,
    // so if those cannot be read, say so rather than showing an empty list
    // that looks like "no hosts".
    list.append(el('li', 'pad muted',
      `Moonlight\u2019s settings could not be read, so nothing is known about which hosts are ` +
      `paired: ${data.settingsProblem} Open Moonlight once and pair a host there, then come back.`));
  }
  if (!hosts.length) {
    list.append(el('li', 'pad muted',
      'No host found. Clarity Stream hosts announce themselves on the network; ' +
      'if yours is on another subnet, pair with it once from Moonlight by address.'));
    return;
  }

  for (const h of hosts) {
    const li = el('li');
    li.className = (h.reachable ? '' : 'unreachable ') + (selected === h.name ? 'selected' : '');

    const beacon = el('span', 'beacon');
    beacon.classList.add(!h.reachable ? 'off' : (h.busy ? 'busy' : 'on'));
    li.append(beacon);

    const main = el('div', 'host-main');
    main.append(el('div', 'host-name', h.name));
    const bits = [h.address];
    // The protocol version Sunshine reports for compatibility, not Sunshine's
    // own, which /serverinfo does not carry.
    if (h.protocolVersion) bits.push(`GameStream ${h.protocolVersion.split('.').slice(0, 3).join('.')}`);
    // A host that announces itself but cannot be connected to, refused at
    // once with EHOSTUNREACH, is nearly always macOS keeping this application
    // off the local network. It asks once; a "Don't Allow" sticks, and from
    // then on every host just looks dead.
    if (!h.reachable && h.discovered && /EHOSTUNREACH/.test(h.unreachableReason ?? '')) {
      bits.push('on the network, but macOS is not letting this app reach it. Allow Clarity Stream ' +
        'Client in System Settings \u2192 Privacy & Security \u2192 Local Network');
    } else if (!h.reachable) bits.push('not answering, so it cannot be paired or played');
    else if (h.busy) bits.push('a session is already running');
    main.append(el('div', 'host-sub', bits.join(' · ')));
    li.append(main);

    if (!h.paired) li.append(el('span', 'tag absent', 'not paired'));
    if (h.discovered) li.append(el('span', 'tag', 'on the network'));

    const action = el('button', h.paired ? 'secondary' : 'primary', h.paired ? 'Choose' : 'Pair');
    // Pairing an unreachable host cannot work: the request never arrives, the
    // PIN never reaches it, and the failure reads as a pairing problem when
    // it is a reachability one. Usually a firewall on the host.
    if (!h.reachable) {
      action.disabled = true;
      action.title = 'This host is not answering, so pairing cannot reach it.';
    }
    action.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (h.paired) { select(h.name); return; }
      const r = await window.cs.startPairing({ address: h.address });
      $('pairHost').textContent = h.name;
      $('pairPin').textContent = r.pin;
      $('pairDialog').showModal();
      $('pairDialog').dataset.address = h.address;
    });
    li.append(action);

    li.addEventListener('click', () => { if (h.paired) select(h.name); });
    list.append(li);
  }
}

function select(name) {
  selected = name;
  drawHosts();
  drawApps();
}

function drawApps() {
  const card = $('playCard');
  const host = data.hosts.find((h) => h.name === selected);
  if (!host) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  $('playHost').textContent = `${host.name} · ${host.address}`;
  drawStop(host);

  const list = $('apps');
  list.replaceChildren();

  if (!host.apps.length) {
    list.append(el('li', 'muted',
      'No apps known for this host yet. Open Moonlight once so it fetches the list.'));
    return;
  }

  // Couch Mode first: it is the one entry a Clarity Stream host publishes on
  // purpose, and the reason the rest of the grid can stay out of the way.
  const preferred = data.settings.preferredApp;
  const ordered = [...host.apps].sort((a, b) =>
    (b.name === preferred ? 1 : 0) - (a.name === preferred ? 1 : 0));

  for (const a of ordered) {
    const li = el('li', a.name === preferred ? 'featured' : '');
    const title = el('div', 'app-title', a.name);
    li.append(title);
    if (a.name === preferred) li.append(el('span', 'app-note', 'pick games here, on the TV'));

    const play = el('button', a.name === preferred ? 'primary' : 'secondary', 'Play');
    play.disabled = !host.reachable;
    play.addEventListener('click', async () => {
      if (host.busy) {
        toast('That host already has a session running. It will take over.', true);
      }
      const r = await window.cs.launch({ address: host.address, appName: a.name });
      const combo = data.escapeCombo ?? 'Ctrl+Alt+Shift+Q';
      toast(data.settings.captureSystemKeys === 'never'
        ? `Starting ${a.name}…`
        : `Starting ${a.name}. Press ${combo} to come back.`);
      console.info('launch:', r.command);
    });
    li.append(play);
    list.append(li);
  }
}

// Closing Moonlight's window does not end a session: the host stays busy and
// refuses the next connection until its own timeout gives up. So a running
// session gets a way to end it, and the answer shown is the host's state
// afterwards, never just that a command was sent.
function drawStop(host) {
  const row = $('stopRow');
  row.replaceChildren();
  row.classList.toggle('hidden', !host.busy);
  if (!host.busy) return;

  row.append(el('span', 'muted',
    'A session is running on this host. Closing Moonlight\u2019s window does not end it.'));
  const stop = el('button', 'danger', 'Stop the session');
  stop.addEventListener('click', async () => {
    stop.disabled = true;
    stop.textContent = 'Stopping…';
    try {
      const r = await window.cs.quit({ name: host.name, address: host.address, port: host.port });
      if (r.alreadyFree) toast('No session was running.');
      else if (r.ended) toast(`The host reports the session ended, after ${Math.round((r.waitedMs ?? 0) / 1000)}s.`);
      else toast(r.reason ?? 'The session did not end.', true);
    } catch (err) {
      toast(`Could not ask the host: ${err.message}`, true);
    } finally {
      refresh().catch(() => {});
    }
  });
  row.append(stop);
}

function drawSettings() {
  const s = data.settings;
  $('resolution').value = s.resolution;
  $('fps').value = String(s.fps);
  $('bitrate').value = String(s.bitrate);
  $('displayMode').value = s.displayMode;
  $('vsync').checked = Boolean(s.vsync);
  $('captureSystemKeys').value = s.captureSystemKeys ?? 'always';

  // The point of capturing shortcuts is that the local ones stop working, so
  // the way out is said plainly. The permission is said too, because without
  // it macOS accepts the setting and quietly ignores it.
  const combo = data.escapeCombo ?? 'Ctrl+Alt+Shift+Q';
  $('keysHint').textContent = s.captureSystemKeys === 'never'
    ? `Your own shortcuts keep working here, so Command-Tab and the rest never reach the host. ` +
      `${combo} always ends a session.`
    : `While streaming, your shortcuts go to the host instead of this Mac. This needs Moonlight ` +
      `to have Accessibility permission, in System Settings under Privacy & Security; without it ` +
      `macOS ignores the setting. ${combo} always ends the session.`;

  const pill = $('moonlightPill');
  pill.textContent = data.moonlight ? 'Moonlight ready' : 'Moonlight missing';
  pill.className = `pill ${data.moonlight ? 'on' : 'off'}`;
  // Where things were found matters on a Mac, where an application can live
  // in several places and its settings are not where a Linux port expects.
  pill.title = data.moonlight
    ? `${data.moonlightPath}\nfound via ${data.moonlightVia}`
    : 'Looked in /Applications, ~/Applications, Spotlight and PATH.';

  // Said because it is easy to assume the host will match it. It will not:
  // since host 0.8.0 nothing on the host changes resolution for a session.
  $('resHint').textContent =
    `The host streams whatever its display is already set to; ${s.resolution} is what this Mac ` +
    `asks for. If the two differ, the picture is scaled to fit rather than refused.`;
}

/* --------------------------------------------------------------- actions */

async function refresh() {
  data = await window.cs.hosts();
  if (selected && !data.hosts.some((h) => h.name === selected)) selected = null;
  // Nothing chosen yet: land on the first paired, reachable host, which is
  // almost always the only one anybody wants.
  if (!selected) {
    const best = data.hosts.find((h) => h.paired && h.reachable);
    if (best) selected = best.name;
  }
  drawSettings();
  drawHosts();
  drawApps();
}

for (const [id, key, read] of [
  ['captureSystemKeys', 'captureSystemKeys', (e) => e.value],
  ['resolution', 'resolution', (e) => e.value],
  ['fps', 'fps', (e) => Number(e.value)],
  ['bitrate', 'bitrate', (e) => Number(e.value) || 20000],
  ['displayMode', 'displayMode', (e) => e.value],
  ['vsync', 'vsync', (e) => e.checked]
]) {
  $(id).addEventListener('change', async (e) => {
    data.settings = await window.cs.setSettings({ [key]: read(e.target) });
    drawSettings();
  });
}

$('refresh').addEventListener('click', () => refresh().catch((e) => toast(e.message, true)));
$('pairDone').addEventListener('click', async () => {
  $('pairDialog').close();
  // Pairing finishes on the host's side, so the list is re-read rather than
  // assumed to have changed.
  await refresh();
});
$('pairWeb').addEventListener('click', () => {
  const address = $('pairDialog').dataset.address;
  window.cs.openExternal(`https://${address}:47990`);
});

refresh().catch((err) => toast(`Could not look for hosts: ${err.message}`, true));
