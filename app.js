// FREQUENCY — client
(() => {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/signal`);

  const el = (id) => document.getElementById(id);
  const dialStatus = el("dial-status");
  const dialFlags = el("dial-flags");
  const signalBars = el("signal-bars");
  const handleBadge = el("handle-badge");

  const tuningPanel = el("tuning-panel");
  const countryGrid = el("country-grid");
  const findBtn = el("find-btn");

  const chatView = el("chat-view");
  const log = el("transmission-log");
  const typingIndicator = el("typing-indicator");
  const composer = el("composer");
  const sendBtn = el("send-btn");
  const skipBtn = el("skip-btn");
  const reportBtn = el("report-btn");
  const leaveBtn = el("leave-btn");

  let myHandle = "";
  let myCountry = null;
  let peer = null;
  let typingTimeout = null;

  function setStatus(text, searching = false) {
    dialStatus.textContent = text;
    signalBars.classList.toggle("active", searching);
  }

  function addBubble(text, kind) {
    const b = document.createElement("div");
    b.className = `bubble ${kind}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
  }

  function resetToTuning() {
    chatView.classList.add("hidden");
    tuningPanel.classList.remove("hidden");
    log.innerHTML = "";
    peer = null;
    dialFlags.textContent = myCountry ? myCountry.flag : "📻";
    setStatus("STANDBY");
  }

  ws.addEventListener("open", () => {
    setStatus("LINKING TOWER…");
  });

  ws.addEventListener("close", () => {
    setStatus("SIGNAL LOST — REFRESH");
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);

    switch (msg.type) {
      case "welcome": {
        myHandle = msg.handle;
        handleBadge.textContent = myHandle;
        renderCountryGrid(msg.countries);
        setStatus("STANDBY");
        break;
      }

      case "searching": {
        setStatus("SCANNING FREQUENCIES…", true);
        break;
      }

      case "matched": {
        peer = msg.peer;
        tuningPanel.classList.add("hidden");
        chatView.classList.remove("hidden");
        dialFlags.textContent = `${myCountry.flag} ⇄ ${peer.country.flag}`;
        setStatus(`LIVE — ${peer.handle}`, false);
        log.innerHTML = "";
        addBubble(
          `Frequency locked. You're through to ${peer.handle} (${peer.country.flag} ${peer.country.name}). Be kind, be curious.`,
          "system"
        );
        composer.disabled = false;
        composer.focus();
        break;
      }

      case "chat": {
        addBubble(msg.text, msg.from === "self" ? "self" : "peer");
        break;
      }

      case "typing": {
        typingIndicator.classList.toggle("active", msg.active);
        break;
      }

      case "partner_left": {
        addBubble("The other station went dark. Tune again when ready.", "system");
        composer.disabled = true;
        setStatus("STANDBY");
        dialFlags.textContent = myCountry ? myCountry.flag : "📻";
        break;
      }

      case "rate_limited": {
        addBubble("Sending too fast — the tower needs a beat to catch up.", "system");
        break;
      }

      case "reported_ack": {
        resetToTuning();
        break;
      }

      default:
        break;
    }
  });

  function renderCountryGrid(countries) {
    countryGrid.innerHTML = "";
    countries.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "flag-btn";
      btn.textContent = c.flag;
      btn.title = c.name;
      btn.setAttribute("aria-label", c.name);
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".flag-btn.selected")
          .forEach((n) => n.classList.remove("selected"));
        btn.classList.add("selected");
        myCountry = c;
        dialFlags.textContent = c.flag;
        findBtn.disabled = false;
        ws.send(JSON.stringify({ type: "set_country", code: c.code }));
      });
      countryGrid.appendChild(btn);
    });
  }

  findBtn.addEventListener("click", () => {
    if (!myCountry) return;
    ws.send(JSON.stringify({ type: "find" }));
  });

  skipBtn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "skip" }));
    composer.disabled = true;
    log.innerHTML = "";
    setStatus("SCANNING FREQUENCIES…", true);
  });

  leaveBtn.addEventListener("click", () => {
    ws.send(JSON.stringify({ type: "leave" }));
    resetToTuning();
  });

  reportBtn.addEventListener("click", () => {
    if (!peer) return;
    const reason = prompt("What happened? (sent to moderators, no reply expected)") || "unspecified";
    ws.send(JSON.stringify({ type: "report", reason }));
  });

  function sendMessage() {
    const text = composer.value.trim();
    if (!text) return;
    ws.send(JSON.stringify({ type: "chat", text }));
    composer.value = "";
    ws.send(JSON.stringify({ type: "typing", active: false }));
  }

  sendBtn.addEventListener("click", sendMessage);
  composer.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    } else {
      ws.send(JSON.stringify({ type: "typing", active: true }));
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        ws.send(JSON.stringify({ type: "typing", active: false }));
      }, 1200);
    }
  });
})();
