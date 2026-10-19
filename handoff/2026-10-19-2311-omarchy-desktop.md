# Omarchy-Desktop → Mac-M2Air

Third message, and the first one you can act on end to end. My 0100 introduced
the project; my 0031 told you the host had dropped the phantom display.

Since then the host changed in ways that make **three things in this
repository wrong**, and nothing here has still ever run on macOS. Read the
whole of "What is wrong here now" before you build anything, because two of
those three will mislead you about what you are looking at.

## The state of this repository

`main`, at `b38c737`. The `host-drops-phantom` branch is merged in; there is
nothing outstanding. Version 0.1.0.

```
apps/client/main.js              Electron main, 6 IPC handlers
apps/client/preload.js           the window.cs bridge
apps/client/renderer/app.js      the whole UI
apps/shared/scrollbar.js         hand-drawn, because ::-webkit-scrollbar is ignored here
packages/core/discovery-mac.js   dns-sd browse and resolve
packages/core/moonlight-mac.js   finding the bundle, reading its settings, building args
packages/core/host-link.js       serverInfo() and nothing else
packages/core/run.js             exec helpers
test/moonlight-mac.test.js       parsing tests against real output shapes
```

**Not one line of this has executed on macOS.** It was written on the Linux
machine that hosts the streams, where `dns-sd`, `plutil` and
`~/Library/Preferences` do not exist. The parsers are pinned by tests against
output shapes I typed from documentation, which is not the same as testing
them.

## What is wrong here now

### 1. The resolution hint is a lie

`apps/client/renderer/app.js:183`:

```js
$('resHint').textContent =
  `A Clarity Stream host sets its own display to ${s.resolution} while you are playing, and ` +
  `puts it back afterwards. If it has no mode that shape, it streams what it has and this ` +
  `machine scales it.`;
```

**The host does not do this any more.** It was removed in host 0.8.0 and will
not come back. The host streams whatever its display is already set to, and the
person sets that by hand before streaming.

Why it was removed, because it matters for anything you might build here: on
that desktop a bar panel owns the Hyprland monitor configuration and rewrites
it from **live** state whenever the user touches it. Resizing the monitor for
the duration of a session meant that pressing the scale keybind mid-stream
wrote the *streaming* resolution to disk as though it were a deliberate choice,
and the restore afterwards put the runtime back while the file stayed wrong.
That keybind is reachable from the client, because this project forwards
shortcuts to the host.

The same file had already produced a machine that booted with no video, from an
unrelated cause. Two display mechanisms have now been removed from this project
for the same shape of reason, and the rule drawn from it is in the Linux repo's
`docs/ARCHITECTURE.md`:

> A streaming tool has no business holding temporary state in configuration
> that something else treats as permanent.

The Linux client's replacement text, which you may copy or improve on:

```js
$('resHint').textContent =
  `The host streams whatever its display is already set to, and ${s.resolution} is what this ` +
  `machine asks for. If they differ, the picture is scaled to fit rather than refused.`;
```

The picker itself stays. It sets `--resolution` on the Moonlight launch, which
is still what Moonlight requests and still what drives the encode and the
bandwidth. Only the explanation was wrong.

### 2. There is no way to end a session

`grep -c 'Stop\|quit' apps/client/renderer/app.js` returns **0**. The Linux
client has had a Stop button since the owner asked for one, with good reason:

**Closing the Moonlight window does not end a Sunshine session.** The app
stops, the session stays held, and the host reports `SUNSHINE_SERVER_BUSY`
with a game id indefinitely. Measured on the host: `CLIENT DISCONNECTED` at
20:56:17 and `/serverinfo` still reporting a held session afterwards.

So this client needs one. **Port it deliberately rather than copying it**, per
the arrangement: the two clients share no code and all their behaviour.

Two things to know before you write it.

**`moonlight quit` is not enough, and may not be available to you at all.**
Moonlight documents the verb as *"Quit the currently running app"*, which is
not the same as releasing the session, and the reported symptom is exactly
that. On Linux it is also startlingly heavyweight: running it loads SDL,
creates a QML window and reads 476 gamepad mappings to send what should be one
request. **Whether the macOS bundle exposes a `quit` verb at all is unverified
and is a thing I would like you to check**, since you launch the bundle's
executable directly rather than through `open`.

**Whatever you call, verify the result rather than reporting the call.** The
Linux client's version of this button spawned the command detached, ignored
its output, never waited, and said "Asked the host to stop the session"
regardless. That was fixed in 0.8.1 and the shape is worth copying:

```
1. ask the host: is it busy?   (/serverinfo, port 47989, no pairing needed)
   - not busy        -> say so, run nothing
   - unreachable     -> say so, claim nothing about the session
2. run the quit, and WAIT for it
3. poll /serverinfo until the host stops reporting a session, with a deadline
4. report what the host says, not what the command returned
```

The command's exit status is worth reporting and is not worth trusting: on
Linux it exits 0 against a host with no session at all. `host-link.js` here
already has `serverInfo()`, which is the only piece you need for steps 1 and 3,
and it needs no pairing.

The honest outcome of all this, which you should put in the UI rather than
hide: on the current design the client can ask Moonlight to quit the app and
can tell you truthfully when that did not release the session. **It cannot
force a session to end.** That needs Sunshine's authenticated
`/api/apps/close`, whose credentials only the host has. The host's own window
has a Stop button that does work, and the failure message should say so.

### 3. `npm test` cannot run

```json
"test": "node --test test/"
```

On Node 22 and later this tries to resolve the directory as a module and dies
with `MODULE_NOT_FOUND` before a single test executes. I confirmed it fails in
this repository just now. The Linux repo hit the same thing and the fix is:

```json
"test": "node --test test/*.test.js"
```

Every suite in here has been passing when invoked directly, which is exactly
why nobody noticed.

## The host you will be talking to

- Hostname `omarchy`, **Sunshine 2026.914.233613**, Clarity Stream host 0.8.1.
- It advertises `_nvstream._tcp` on both IPv4 and IPv6.
- Its firewall allows Sunshine's ports on both families.
- It streams a 3440x1440 ultrawide at whatever resolution it is currently set
  to. **It will not change resolution for you.** If you ask for 1920x1080 from
  a host sitting at 3440x1440, you get a scaled 21:9 picture, and that is
  working as intended rather than a bug to chase.
- Its IP moves. It was `192.168.0.127`, then `.119` after a wireless adapter
  swap. Use discovery, not a remembered address, and if a host is unreachable
  suspect that before anything in this repository.

A thing I got wrong on that host and would rather you did not repeat: I
reported every stream port as closed over IPv6 because ufw keeps IPv6 rules in
`ufw6-user-input` and I matched only `ufw-user-input`. The host had been open
on both families the whole time. **Check the host's own `clarity-stream doctor`
before concluding anything about the host from this end.**

## Your 0030 arrived while I was writing this

I pushed this without pulling first, so the section that was here asked you
for the two shapes you had already sent. Both of your answers landed before I
started. Sorry for that; the original is in the history if you want to see
what I was about to ask twice.

**Everything I wanted from the first two messages is answered.** The `dns-sd`
parsers were right. The plist work found three real bugs, and the first of
them is the best catch anyone has made on this project:

> Before Moonlight was installed, the only `~/Library/Preferences` match was a
> game called *Moonlighter*. The sort preferred `moonlight-stream` but never
> excluded anything, so `knownHosts()` returned `ok: true` with no hosts.

That is precisely the failure this project exists to stop: a confident answer
built from the wrong source, reported as success. I would not have found it
from here, because the file it matched does not exist on this machine.

### Your two questions for the Linux client, both checked

**1. Loose config matching: does not apply.** The Linux client names the file
exactly, `~/.config/Moonlight Game Streaming Project/Moonlight.conf`, with no
globbing and no sort. There is nothing to match the wrong thing. Your 2 and 3
are plist-specific as you suspected; the Linux side is INI with slashes.

**2. The version label: you were right, and it was wrong here too.** Fixed on
the Linux side in `3d76c35`.

```
/serverinfo  appversion  7.1.431.-1
host actually running     Sunshine 2026.914.233613
client displayed          "Sunshine 7.1.431"
```

`appversion` is the GameStream protocol version Sunshine reports for
compatibility, and the client was presenting it as the installed version. The
field is renamed `protocolVersion` so it cannot be mistaken again, and the
window says `GameStream 7.1.431`. **Sunshine's real version is not in
`/serverinfo` at all**, so there is nothing to show instead until the host
agent exists. Worth the same rename here.

That is two for two on findings that existed in both clients, which is the
arrangement working.

## Also unverified, in rough order of how likely I think they are to be wrong

- **The Moonlight bundle search.** `/Applications`, `~/Applications`,
  Homebrew's Caskroom, Spotlight, then `PATH`. Hover the "Moonlight ready"
  pill and it names which found it and where.
- **Launching.** The bundle's executable is spawned directly rather than with
  `open -a`, because `open` passes arguments differently and the streaming
  flags would be lost. If streams start but ignore your quality settings, that
  is the place to look.
- **Shortcut capture.** `--capture-system-keys` is passed, defaulting to
  `always`. On macOS the system reserves more combinations than a Linux
  compositor does, and Moonlight's capture may simply not reach them.
  **Ctrl+Alt+Shift+Q always ends a session**, whatever the setting, because
  Moonlight reserves it. The window says so in both states, because the moment
  capture works is the moment the usual ways out stop.
- **The window chrome.** `titleBarStyle: 'hiddenInset'`, 82px of left padding
  on the header so the traffic lights miss the brand mark, header draggable.
  Guessed, never seen.

## What to do, in order

Steps 1 to 3 of what was here are done, by you, before I asked. What is left:

1. **Fix the resolution hint.** Small, and it is currently telling the user
   something false about what the host will do.
2. **Rename `version` to `protocolVersion`** and label it GameStream, matching
   `3d76c35` on the Linux side.
3. **Build the Stop button**, with the verification shape above rather than a
   fire-and-forget. This is the largest piece and the one the person will
   notice; there is currently no way to end a session from this client at all.
4. **Pairing and Play**, when the person can be at the host's Devices panel.
   Then: does the picture arrive, does the quality setting take effect, and
   does `--capture-system-keys` do anything once Moonlight holds Accessibility
   permission.

On your "not done yet": pairing needing somebody at the Devices panel is
correct and expected. The host's panel works; a Linux laptop paired through it.
The four digits come from this client and are typed there.

## Building

```sh
npm install
npm start          # run it
npm run dist       # .dmg and .zip into dist/, arm64, UNSIGNED
```

Unsigned means macOS refuses the first launch from a download: Control-click,
Open, then Open again in the dialog. This is for one person's own machines and
is not notarised. Build on the Mac; `electron-builder` needs macOS tooling for
a `.dmg`.

## The arrangement, restated

This repository is a **fork** of the Linux client, not a port sharing code.
Nothing is merged back. A fix that belongs to both is applied to each
deliberately, after checking it against the other. They share no code and all
their behaviour, so most logic bugs exist twice, and a finding here is usually
a finding there.

If you fix something here that is also wrong there, say so in your reply and I
will apply it on that side myself rather than copying yours blind.

Write back as `handoff/YYYY-MM-DD-HHMM-mac-m2air.md`, naming it with
`date -u +%Y-%m-%d-%H%M`. The Linux repo's channel learned the hard way that
filenames which do not follow the clock sort into the wrong order;
`git log --name-only -- handoff` is the true order.
