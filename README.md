# Clarity Stream Client, for macOS

Play games streaming from a Linux host, from a Mac.

Forked from the Linux client in
[ClarityStream](https://github.com/FromChaosComesClarity/ClarityStream) and
continuing independently, the same arrangement as Clarity-Mac. Nothing is
merged back; a fix that belongs to both is applied to each deliberately, after
checking it against the other.

This is the **client only**. The host stays on Linux.

## Status, plainly

**Not one line of this has run on macOS.** It was written on the Linux machine
that hosts the streams, where the parts that matter cannot be exercised: there
is no `dns-sd`, no `plutil`, and no `~/Library/Preferences`. What has been done
instead:

- The parsing is pinned by tests against the real output shapes: a QSettings
  plist after `plutil` has flattened it, and `dns-sd`'s browse and resolve
  output.
- The whole application was launched on Linux to prove it degrades honestly
  rather than crashing when none of those exist. It says what it looked for.

So expect to find things. The places it is most likely to be wrong are the
Moonlight preferences domain and the exact shape of `dns-sd` output, and both
report what they found rather than failing silently.

## What it needs

- An Apple Silicon Mac. The build targets arm64 only.
- [Moonlight](https://moonlight-stream.org) installed, normally in
  `/Applications`.
- A Clarity Stream host on the network, version 0.4.1 or later.

## Running it

```sh
git clone https://github.com/FromChaosComesClarity/ClarityStream-Mac
cd ClarityStream-Mac
npm install
npm start
```

## Building an app

```sh
npm run dist
```

That writes a `.dmg` and a `.zip` to `dist/`, arm64, **unsigned**. macOS will
refuse to open an unsigned application downloaded from anywhere, so the first
launch needs Control-click, Open, and then Open again in the dialog. This is
built for one person's own machines and is not notarised.

Build it on the Mac. `electron-builder` needs macOS tooling to make a `.dmg`.

## What it does

It finds hosts on the network, shows which are reachable, busy or unpaired,
and starts a session in one click with Couch Mode first.

**Pairing.** Press Pair and it shows four digits. Type those into the host's
Devices panel. You never open Sunshine's web interface.

**Resolution.** What you choose under Quality is sent to the host, which sets
its own display to match for as long as you are playing and puts it back
afterwards. If the host has no mode that shape, it streams what it has and
this machine scales it.

## How it differs from the Linux client

Three things, and all three are found at runtime rather than assumed, because
assuming a path is what has cost this project the most time:

| | Linux | macOS |
| --- | --- | --- |
| finding hosts | `avahi-browse`, which answers and exits | `dns-sd`, which browses until it is stopped, so each step is given a time limit |
| Moonlight's settings | an INI under `~/.config` | a plist under `~/Library/Preferences`, read through `plutil` |
| Moonlight itself | a binary on `PATH` | an application bundle, looked for in `/Applications`, `~/Applications`, Homebrew's Caskroom, Spotlight, and finally `PATH` |

Pairing state comes from Moonlight's own stored certificate in both. Asking
the host does not work: `/serverinfo` over plain HTTP reports `PairStatus 0`
even for a client that is paired, because pairing is proven with a client
certificate over HTTPS on another port.

## Licence

MIT.
