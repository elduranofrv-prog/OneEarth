# Frequency

Anonymous, global, random 1:1 chat. No accounts, no login, no stored identity —
you get a random goofy handle, pick a flag, hit "Scan for a stranger," and the
tower pairs you with someone else on the line (prioritizing a different
country when possible, so you land on someone new rather than a neighbor).

## Stack (100% free-tier friendly)

- **Backend:** Node.js + Express (serves the static frontend) + `ws`
  (WebSocket signaling/matchmaking). Single process, in-memory state —
  no database, no paid APIs, no message persistence.
- **Frontend:** plain HTML/CSS/JS, no build step, no framework — loads
  instantly on any device.
- **Hosting:** runs anywhere Node runs. Free tiers that work out of the box:
  Render, Fly.io, Railway, Cyclic, or a $0 Oracle/GCP always-free VM.

## Running it locally

```bash
npm install
npm start
# open http://localhost:8080
```

Open it in two browser tabs (or two devices) to match yourself.

## How matching works

1. Client connects over `/signal` and gets a random handle (e.g.
   `FeralPenguin42`) — never a login, never tied to any account.
2. Client picks a flag (self-declared, cosmetic — never used to infer
   real location).
3. On "Scan," the server puts the socket in a queue and pairs it with
   someone else, preferring a different country code first (that's the
   "compounding different countries" behavior), then falling back to
   anyone waiting.
4. Messages relay directly between the two sockets. Nothing is written
   to disk. Closing the tab or hitting "Go offline" ends the pairing
   instantly for both sides.

## What's already built in

- Rate limiting per socket (20 msgs / 10s) to blunt spam/flood abuse.
- A basic profanity mask (swap in a real maintained wordlist before
  going live — the shipped list is a placeholder).
- A `report` action that logs the incident server-side and immediately
  ends the pairing for the reporter.
- No PII collected anywhere: no email, no phone, no persistent ID beyond
  a per-connection UUID that dies when the socket closes.

## What you still need before real users hit this

Be upfront with yourself about these — they're what separates a demo
from something you can put your name on with real traffic:

- **A real moderation pipeline.** The `report` handler currently just
  `console.warn`s. At any real scale you need a queue a human reviews,
  and a way to shadow-ban/block abusive sockets by IP or fingerprint.
- **Abuse/CSAM legal obligations.** Anonymous 1:1 text chat between
  strangers globally puts you under child-safety reporting obligations
  in most jurisdictions (e.g. NCMEC reporting in the US) the moment you
  have real users. Talk to a lawyer before launch — this isn't optional.
- **Horizontal scaling.** In-memory `Map`/array state means this only
  works on a single process/node. To run more than one instance, move
  matchmaking state into Redis (or similar) and use Redis pub/sub or a
  proper signaling relay across instances.
- **Abuse-resistant rate limiting.** Per-socket limiting is easy to
  evade by reconnecting. Add IP-based limits and reconnect throttling
  at the reverse proxy (e.g. Nginx, Cloudflare) layer.
- **TLS.** Always deploy behind `https`/`wss` — most of the free hosts
  above provide this automatically.
- **Content length + link/image safety.** Current build is text-only by
  design; if you add media, you'll need scanning before relay.

## File map

```
ndeta-frequency/
├── server.js        WebSocket matchmaking + relay + moderation hooks
├── package.json
└── public/
    ├── index.html   Chat UI shell
    ├── style.css    "Radio receiver" design system
    └── app.js       Client-side state machine & rendering
```
