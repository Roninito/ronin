const params = new URLSearchParams(window.location.search);
const targetUrl = params.get("targetUrl") || "http://127.0.0.1:3000/";
const initialState = params.get("state") || "checking";

const sidebarEl = document.getElementById("sidebar");
const frameEl = document.getElementById("frame");
const panelEl = document.getElementById("panel");
const panelTitleEl = document.getElementById("panelTitle");
const panelMessageEl = document.getElementById("panelMessage");
const connectionDotEl = document.getElementById("connectionDot");
const reasonEl = document.getElementById("reason");
const sidebarButtons = Array.from(document.querySelectorAll(".sidebar-btn"));
let currentRoute = "home";
let isConnected = false;

const routeConfig = {
  home: { path: "/" },
  chat: { path: "/chat" },
  analytics: { path: "/analytics" },
  config: { path: "/config" },
};

function buildRouteUrl(routeKey) {
  const config = routeConfig[routeKey] || routeConfig.home;
  try {
    return new URL(config.path, targetUrl).toString();
  } catch {
    return targetUrl;
  }
}

function setRoute(routeKey) {
  currentRoute = routeConfig[routeKey] ? routeKey : "home";
  sidebarButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.route === currentRoute);
  });
  const routeUrl = buildRouteUrl(currentRoute);
  if (isConnected) {
    frameEl.src = routeUrl;
  }
}

function setStatusState(state, isBad = false) {
  sidebarEl.classList.remove("state-ready", "state-starting", "state-disconnected", "state-reconnecting", "state-error", "state-tray", "state-checking", "state-unavailable");
  sidebarEl.classList.add(`state-${state}`);
  sidebarEl.classList.toggle("bad", isBad);
  if (connectionDotEl) {
    connectionDotEl.dataset.state = state;
  }
}

function showPanel(title, message, reason = "") {
  panelTitleEl.textContent = title;
  panelMessageEl.textContent = message;
  reasonEl.textContent = reason;
  panelEl.style.display = "block";
}

function setReady(url = targetUrl) {
  isConnected = true;
  setStatusState("ready", false);
  panelEl.style.display = "none";
  const routeUrl = buildRouteUrl(currentRoute);
  if (frameEl.src !== routeUrl) {
    frameEl.src = routeUrl;
  }
}

function setError(reason) {
  isConnected = false;
  setStatusState("error", true);
  showPanel("Ronin server is not reachable", "Start Ronin with `ronin start`, then retry.", reason);
}

function setStarting(message) {
  setStatusState("starting", false);
  showPanel("Starting Ronin", message);
}

function setDisconnected(reason) {
  setStatusState("disconnected", true);
  showPanel("Connection lost", "Ronin connection dropped. Attempting automatic recovery...", reason || "");
}

function setReconnecting(message) {
  setStatusState("reconnecting", false);
  showPanel("Reconnecting to Ronin", message || "Attempting reconnect...");
}

function setTray(message) {
  setStatusState("tray", false);
  showPanel("Client minimized", message || "Ronin client is running in tray.");
}

if (initialState === "checking") {
  setStatusState("checking", false);
  showPanel("Checking Ronin", "Looking for an active Ronin instance...");
}
setRoute("home");

if (window.roninClient?.onStatus) {
  window.roninClient.onStatus((payload) => {
    if (!payload || typeof payload !== "object") return;

    if (payload.state === "ready") {
      setReady(payload.url);
      return;
    }

    if (payload.state === "starting") {
      setStarting(payload.message || "Starting Ronin...");
      return;
    }

    if (payload.state === "disconnected") {
      setDisconnected(payload.reason);
      return;
    }

    if (payload.state === "reconnecting") {
      setReconnecting(payload.message);
      return;
    }

    if (payload.state === "error") {
      setError(payload.reason || "Unknown startup error");
      return;
    }

    if (payload.state === "tray") {
      setTray(payload.message);
    }
  });
} else {
  setStatusState("unavailable", true);
  showPanel("Client bridge unavailable", "Renderer could not connect to Electron preload.");
}

sidebarButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setRoute(button.dataset.route || "home");
  });
});

window.addEventListener("message", (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== "object") return;
  if (payload.type === "ronin:navigate") {
    setRoute(payload.route || "home");
  }
});
