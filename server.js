// FREQUENCY — anonymous global 1:1 chat
// Node + Express (static hosting) + ws (realtime). Zero paid services required.
// Deploy free on Render / Fly.io / Railway / a VPS — one process, in-memory state.

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const path = require("path");

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/signal" });

// ---------------------------------------------------------------------------
// Anonymous identity generation — no accounts, no PII, ever.
// ---------------------------------------------------------------------------
const ADJECTIVES = [
  "Wobbly", "Feral", "Suspicious", "Nocturnal", "Caffeinated", "Confused",
  "Majestic", "Rogue", "Damp", "Sleepy", "Chaotic", "Undercover", "Lukewarm",
  "Cursed", "Glorious", "Sneaky", "Overcooked", "Static-y", "Homesick",
  "Jetlagged", "Unlicensed", "Feisty", "Melancholy", "Buttery", "Haunted",
  "Vintage", "Discount", "Existential", "Off-brand", "Slightly-Illegal",
];
const NOUNS = [
  "Penguin", "Diplomat", "Raccoon", "Astronaut", "Potato", "Wizard",
  "Pigeon", "Cactus", "Goblin", "Accordion", "Walrus", "Lighthouse",
  "Pretzel", "Yeti", "Barnacle", "Tumbleweed", "Sardine", "Gargoyle",
  "Croissant", "Mosquito", "Alpaca", "Toaster", "Hedgehog", "Blimp",
  "Meerkat", "Kazoo", "Otter", "Gremlin", "Noodle", "Platypus",
];

function generateHandle() {
  const a = ADJECTIVES[crypto.randomInt(ADJECTIVES.length)];
  const n = NOUNS[crypto.randomInt(NOUNS.length)];
  const num = crypto.randomInt(10, 99);
  return `${a}${n}${num}`;
}

// ---------------------------------------------------------------------------
// Country / flag registry — self-declared, cosmetic only, never used to
// identify or locate anyone. Kept short here; extend freely.
// ---------------------------------------------------------------------------
const COUNTRIES = [
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  { code: "GH", name: "Ghana", flag: "🇬🇭" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "BR", name: "Brazil", flag: "🇧🇷" },
  { code: "IN", name: "India", flag: "🇮🇳" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "JP", name: "Japan", flag: "🇯🇵" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "MX", name: "Mexico", flag: "🇲🇽" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "JM", name: "Jamaica", flag: "🇯🇲" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "KR", name: "South Korea", flag: "🇰🇷" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "ES", name: "Spain", flag: "🇪🇸" },
];
const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

// ---------------------------------------------------------------------------
// Lightweight moderation: profanity mask + basic abuse-pattern throttle.
// This is a first line of defense, not a legal compliance system — see
// README for what a real deployment still needs (CSAM/report pipeline, etc).
// ---------------------------------------------------------------------------
const BLOCK_WORDS = [
  // Deliberately minimal placeholder list — swap in a maintained wordlist
  // (e.g. an open-source profanity corpus) before going to production.
  "badword1", "badword2",
];
function sanitizeMessage(text) {
  let clean = text;
  for (const w of BLOCK_WORDS) {
    const re = new RegExp(w, "gi");
    clean = clean.replace(re, "*".repeat(w.length));
  }
  return clean;
}

// ---------------------------------------------------------------------------
// Connection + matchmaking state (in-memory; swap for Redis to scale >1 node)
// ---------------------------------------------------------------------------
const clients = new Map(); // ws -> { id, handle, country, partner, state, msgTimestamps }
const waitingQueue = []; // ws refs waiting for a match

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MSGS = 20;

function send(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function removeFromQueue(ws) {
  const idx = waitingQueue.indexOf(ws);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function breakPartnership(ws, notifyPartner = true) {
  const meta = clients.get(ws);
  if (!meta) return;
  const partner = meta.partner;
  meta.partner = null;
  meta.state = "idle";
  if (partner && clients.has(partner)) {
    const pMeta = clients.get(partner);
    pMeta.partner = null;
    pMeta.state = "idle";
    if (notifyPartner) send(partner, "partner_left", {});
  }
}

function tryMatch(ws) {
  const meta = clients.get(ws);
  if (!meta || meta.state !== "searching") return;

  // Prefer pairing with someone from a *different* country first — the
  // whole point is cross-border harmony — then fall back to anyone waiting.
  let candidateIdx = waitingQueue.findIndex((other) => {
    const otherMeta = clients.get(other);
    return otherMeta && otherMeta.country.code !== meta.country.code;
  });
  if (candidateIdx === -1 && waitingQueue.length > 0) candidateIdx = 0;
  if (candidateIdx === -1) {
    waitingQueue.push(ws);
    meta.state = "searching";
    send(ws, "searching", {});
    return;
  }

  const partnerWs = waitingQueue.splice(candidateIdx, 1)[0];
  const partnerMeta = clients.get(partnerWs);
  if (!partnerMeta) {
    // stale entry, retry
    tryMatch(ws);
    return;
  }

  meta.partner = partnerWs;
  meta.state = "connected";
  partnerMeta.partner = ws;
  partnerMeta.state = "connected";

  send(ws, "matched", {
    peer: { handle: partnerMeta.handle, country: partnerMeta.country },
  });
  send(partnerWs, "matched", {
    peer: { handle: meta.handle, country: meta.country },
  });
}

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  const handle = generateHandle();
  clients.set(ws, {
    id,
    handle,
    country: COUNTRIES[0],
    partner: null,
    state: "idle",
    msgTimestamps: [],
  });

  send(ws, "welcome", { handle, countries: COUNTRIES });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames
    }
    const meta = clients.get(ws);
    if (!meta) return;

    switch (msg.type) {
      case "set_country": {
        const c = COUNTRY_BY_CODE[msg.code];
        if (c) meta.country = c;
        break;
      }

      case "find": {
        if (meta.state === "connected") breakPartnership(ws);
        removeFromQueue(ws);
        meta.state = "searching";
        tryMatch(ws);
        break;
      }

      case "chat": {
        if (meta.state !== "connected" || !meta.partner) return;

        // rate limit
        const now = Date.now();
        meta.msgTimestamps = meta.msgTimestamps.filter(
          (t) => now - t < RATE_LIMIT_WINDOW_MS
        );
        if (meta.msgTimestamps.length >= RATE_LIMIT_MAX_MSGS) {
          send(ws, "rate_limited", {});
          return;
        }
        meta.msgTimestamps.push(now);

        const text = String(msg.text || "").slice(0, 1000);
        if (!text.trim()) return;
        const clean = sanitizeMessage(text);
        send(meta.partner, "chat", { text: clean, from: "peer" });
        send(ws, "chat", { text: clean, from: "self" });
        break;
      }

      case "typing": {
        if (meta.state === "connected" && meta.partner) {
          send(meta.partner, "typing", { active: !!msg.active });
        }
        break;
      }

      case "skip": {
        breakPartnership(ws);
        removeFromQueue(ws);
        meta.state = "searching";
        tryMatch(ws);
        break;
      }

      case "leave": {
        breakPartnership(ws);
        removeFromQueue(ws);
        meta.state = "idle";
        break;
      }

      case "report": {
        // Minimal placeholder: logs server-side for a human to review.
        // A production deployment needs a real moderation queue + storage.
        console.warn(
          `[REPORT] ${meta.handle} reported partner at ${new Date().toISOString()}: ${String(
            msg.reason || ""
          ).slice(0, 200)}`
        );
        breakPartnership(ws);
        removeFromQueue(ws);
        meta.state = "idle";
        send(ws, "reported_ack", {});
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    breakPartnership(ws);
    removeFromQueue(ws);
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`FREQUENCY signal tower live on :${PORT}`);
});
