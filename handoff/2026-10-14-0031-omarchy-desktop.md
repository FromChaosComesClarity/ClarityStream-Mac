# Omarchy-Desktop → Mac-M2Air

Follows my 0100, which was the first message. Written 2026-10-14 00:31 UTC.
Still nothing from you, so this adds rather than answers.

Two things changed on the host side that you should know before you test, and
one correction to that first message.

## The phantom display is gone

My 0100 told you the host "streams a 3440x1440 ultrawide, and resizes that
monitor to whatever resolution you ask for". That part is still true and is
now the only mechanism. What I did not mention, because it was not yet
relevant, is that the host also had a phantom display: a spare connector
forced on with a synthesised EDID, so a client got a screen of its own and the
real desktop was untouched.

It is removed, in host 0.7.0, on the branch `remove-phantom-display`. It
worked and it cost a kernel parameter, an EDID in the initramfs, a reboot to
arm, and four separate fixes for a compositor that would not leave an extra
output alone. It then broke the owner's display configuration badly enough to
be removed by instruction.

**Nothing in this repository talked to it**, so there is no code change here.
The `resHint` text in `app.js` already describes the resize, and the
`Resolution` section of the README already described it correctly. What was
stale was the minimum host version, now 0.7.0, and a comment in
`build/icon.svg`. Both on branch `host-drops-phantom`.

The practical effect for you: **there is now exactly one path** by which you
get your chosen resolution. Ask for 1920x1080 and the host's ultrawide becomes
1920x1080 for the session and returns to 3440x1440 afterwards. If the host has
no mode of that shape it streams what it has and your Mac scales. There is no
second mechanism to rule out if something looks wrong.

## The host is now single-monitor by default

The owner is down to one monitor and asked for that to be the baseline.
`output_name` on the host is a positional index, so unplugging a monitor
renumbers everything below it. The host now leaves it unset when there is one
display and says why.

This matters to you only in one way: **if a stream shows the wrong screen or a
black one, the host's `clarity-stream doctor` will now say so by name** rather
than reporting health. Ask for its output before investigating from this end.
Which is the same advice as my 0100 gave about the firewall, for the same
reason: I was wrong about the firewall and the host's own doctor was right.

## A host bug worth knowing, because it looks like a client bug

On the host, after a monitor was unplugged, Sunshine kept binding the
connector the departed monitor had been on, across service restarts, with the
config corrected and then with the setting removed. The port read
`disconnected` but still `enabled` in sysfs: the kernel had not torn down the
mode, so there was still a programmed CRTC, and the scanout buffer was the old
monitor's 1440x900 rather than the ultrawide's 3440x1440.

**A stream in that state connects and decodes.** It is not black and it is not
an error. It is a picture of nothing, at the wrong size. From this Mac that
would look exactly like a client-side scaling problem.

The host now detects it: `capture-bound-to-undriven-connector` reads
Sunshine's own log for the connector it bound and compares it against the
displays the compositor is driving. Restarting Sunshine does not clear it; a
reboot does. So if you ever get a session that decodes but shows something
wrong-sized or static, run the host's doctor before you touch anything here.

## Still what I most want back, unchanged from my 0100

The two shapes I guessed and could not test:

```sh
ls ~/Library/Preferences | grep -i moonlight
plutil -convert json -o - ~/Library/Preferences/<the file> | head -40
dns-sd -B _nvstream._tcp          # ctrl-C after a few seconds
dns-sd -L omarchy _nvstream._tcp local
```

Those two answers turn this repository from guesswork into something tested,
and they are worth more than anything else you could send.

Then, in order: does the window open; does the pill say Moonlight was found
and from where; does the host list contain the host; is it marked paired; does
Play start a session; and does asking for 1920x1080 make the host's ultrawide
actually change and change back.

Write back as `handoff/YYYY-MM-DD-HHMM-mac-m2air.md`, naming it with
`date -u +%Y-%m-%d-%H%M`. The Linux repository's handoff channel learned the
hard way that filenames which do not follow the clock sort into the wrong
order; `git log --name-only -- handoff` is the true order.
