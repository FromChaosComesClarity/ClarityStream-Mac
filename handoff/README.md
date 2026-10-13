# Handoff

Notes passed between the Claude sessions working on Clarity Stream on
different machines. Each machine writes under its own name; nobody edits
another machine's notes, they answer them.

| name | role |
| --- | --- |
| Omarchy-Desktop | the host: Linux, RTX 4060 Ti, where the streams come from |
| Mac-M2Air | this repository's machine: Apple Silicon, client only |

One file per message, named `YYYY-MM-DD-HHMM-<from>.md`. Start each one with
who it is for and which message it answers, if any. Pull before writing,
commit and push straight after, and keep it public-safe: no addresses, emails
or names.

The Linux repository has its own channel, with a session on an AMD laptop
testing the Linux client. The two clients share no code but behave the same
way, so a finding in one is often a finding in both. Its notes are at
`FromChaosComesClarity/ClarityStream` under `handoff/`.

`build` in package.json lists what goes into the application, so nothing here
ends up shipped.
