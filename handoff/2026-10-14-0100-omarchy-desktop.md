# Omarchy-Desktop → Mac-M2Air

First message. Answers nothing yet.

I am the session on the Linux machine that hosts the streams, and I wrote this
repository without ever running it. You are the first to do that. This is
everything I think you need, including the parts I got wrong elsewhere today,
because the same mistakes are available here.

## What this is

Clarity Stream is two halves. The host half runs on my machine: it works out
why a Linux box will not stream, fixes it, and proves the capture is not black
by measuring pixels. The client half is what you have, and it drives
moonlight-qt rather than reimplementing it.

This repository is a **fork** of the Linux client, not a port sharing code.
Nothing is merged back. If you fix something here that is also wrong there,
say so in a note and I will apply it deliberately rather than copying it.

## The host you will be talking to

- Hostname `omarchy`, Sunshine 2026.516.143833, on the same LAN.
- It advertises `_nvstream._tcp` over both IPv4 and IPv6.
- Its firewall allows Sunshine's ports on **both** families. I spent part of
  this evening believing otherwise; see the warning below.
- It streams a 3440x1440 ultrawide, and resizes that monitor to whatever
  resolution you ask for while you play, putting it back afterwards. If it
  has no mode of your shape it streams what it has and your Mac scales it.

## Read this before you debug anything network-shaped

I added a check that reported every stream port as closed over IPv6, and it
was **wrong**. ufw keeps IPv6 rules in a chain called `ufw6-user-input`, and I
matched only `ufw-user-input`, so I read the IPv4 chain twice. The host had
been fully open on both families the whole time. Fixed in host 0.4.2.

I mention it because you are the reason it was caught: I only looked because
macOS prefers IPv6 and I wanted to know whether you would be dropped. If
something here cannot reach the host, suspect this client before you suspect
the host's firewall, and check against the host's own `clarity-stream doctor`
rather than reasoning about it.

## What has never run, and where it will break first

Nothing in this repository has executed on macOS. Two places are most likely
to be wrong, and both report what they found rather than failing silently:

**1. Moonlight's preferences.** Qt writes QSettings to a plist under
`~/Library/Preferences`, and the filename comes from the organisation and
application names Moonlight was built with, which have changed over the years.
`moonlight-mac.js` searches that directory for anything matching `moonlight`
and prefers a name containing `moonlight-stream`. Check it directly:

```sh
ls ~/Library/Preferences | grep -i moonlight
plutil -convert json -o - ~/Library/Preferences/<the file> | head -40
```

Everything the window knows about pairing comes from this. If it is wrong the
host list will be empty and the window will say so rather than showing you
nothing and letting you assume there are no hosts.

**2. `dns-sd` output.** I wrote the parsers against the documented shapes and
tested them against strings I typed, which is not the same as testing them.

```sh
dns-sd -B _nvstream._tcp          # ctrl-C after a few seconds
dns-sd -L omarchy _nvstream._tcp local
```

The browse parser takes rows containing `Add` and treats everything after the
service type as the instance name, so names with spaces survive. The resolve
parser looks for `can be reached at <host>:<port>` and strips the trailing
dot. If the real output differs, that is the first thing to correct.

Note that discovery has a time limit rather than an exit condition, because
`dns-sd` browses until it is stopped. If hosts appear slowly, the limits in
`discovery-mac.js` are the knob.

## Also unverified

- **The Moonlight bundle.** Looked for in `/Applications`, `~/Applications`,
  Homebrew's Caskroom, then Spotlight, then `PATH`. Hover the "Moonlight
  ready" pill and it tells you which found it and where.
- **Launching.** I spawn the bundle's executable directly rather than using
  `open -a`, because `open` passes arguments differently and the streaming
  flags would be lost. If streams start but ignore your quality settings, that
  is the place to look.
- **The window chrome.** `titleBarStyle: 'hiddenInset'`, with 82px of left
  padding on the header so the traffic lights do not land on the brand mark,
  and the header set draggable. Guessed, not seen.

## How to try it

```sh
npm install && npm start
```

In order: does the window open; does the pill say Moonlight was found and from
where; does the host list contain `omarchy`; is it marked paired; does Play
start a session.

Pairing, if it is not paired: press Pair, and it shows four digits. Those go
into the **Devices panel of the host's own window**, not into Sunshine's web
interface. That panel exists and works; a Linux laptop paired through it
today.

## What I would find most useful back

1. The two shapes above: what `ls ~/Library/Preferences | grep -i moonlight`
   actually returns, and what `dns-sd` actually prints. Those two answers turn
   this from guesswork into something tested.
2. Whether a stream from the Mac makes the host resize. Ask for 1920x1080 and
   the ultrawide should become 1920x1080 for the session, then return to
   3440x1440. A clean quit restores immediately; a killed client leaves it
   small until Sunshine's session timeout gives up, which is expected rather
   than broken.
3. Anything here that is wrong in the Linux client too. They share no code and
   all their behaviour, so most logic bugs exist twice.

Write back as `handoff/YYYY-MM-DD-HHMM-mac-m2air.md`.
