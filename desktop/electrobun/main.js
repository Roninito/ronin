const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require("electron");
const { spawn } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");
const { homedir } = require("os");

const DEFAULT_PORT = Number(process.env.RONIN_CLIENT_PORT || "3000");
const DEFAULT_URL = process.env.RONIN_CLIENT_URL || `http://127.0.0.1:${DEFAULT_PORT}/`;
const SKIP_HEALTH_CHECK = process.env.RONIN_CLIENT_SKIP_HEALTH_CHECK === "1";
const PROJECT_ROOT = process.env.RONIN_PROJECT_ROOT || path.join(__dirname, "..", "..");
const MONITOR_INTERVAL_MS = Number(process.env.RONIN_CLIENT_MONITOR_MS || "5000");
const MAX_RECOVERY_ATTEMPTS = Number(process.env.RONIN_CLIENT_MAX_RECOVERY_ATTEMPTS || "5");
const RONIN_HOME = path.join(homedir(), ".ronin");

let mainWindow = null;
let tray = null;
let isQuitting = false;

function buildHealthUrl(targetUrl) {
  try {
    return new URL("/api/health", targetUrl).toString();
  } catch {
    return "";
  }
}

async function checkHealth(targetUrl) {
  if (SKIP_HEALTH_CHECK) {
    return { healthy: true, reason: "" };
  }

  const healthUrl = buildHealthUrl(targetUrl);
  if (!healthUrl) {
    return { healthy: false, reason: "Invalid target URL" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) {
      return { healthy: false, reason: `Health check failed (${response.status})` };
    }
    return { healthy: true, reason: "" };
  } catch {
    return { healthy: false, reason: `Cannot reach ${healthUrl}` };
  } finally {
    clearTimeout(timeout);
  }
}

function sendStatus(win, payload) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("ronin-client-status", payload);
}

function startRonin() {
  try {
    const bunBin = process.platform === "win32" ? "bun.exe" : "bun";
    const child = spawn(bunBin, ["run", "ronin", "start"], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function restartRonin() {
  try {
    const bunBin = process.platform === "win32" ? "bun.exe" : "bun";
    const child = spawn(bunBin, ["run", "ronin", "restart"], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function resolveLogPath() {
  const candidates = [
    path.join(RONIN_HOME, "daemon.log"),
    path.join(RONIN_HOME, "ninja.log"),
    path.join(RONIN_HOME, "ronin.log"),
  ];
  return candidates.find((p) => existsSync(p));
}

function openRoninLogs() {
  const logPath = resolveLogPath();
  if (!logPath) return false;
  void shell.openPath(logPath);
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryRecoverRonin(win, failureReason) {
  sendStatus(win, { state: "disconnected", reason: failureReason });

  for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt++) {
    sendStatus(win, {
      state: "reconnecting",
      message: `Reconnecting to Ronin (attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS})...`,
    });

    startRonin();
    const backoffMs = Math.min(1500 * 2 ** (attempt - 1), 15000);
    const deadline = Date.now() + backoffMs;
    while (Date.now() < deadline) {
      await delay(1000);
      const health = await checkHealth(DEFAULT_URL);
      if (health.healthy) {
        sendStatus(win, { state: "ready", url: DEFAULT_URL });
        return true;
      }
    }
  }

  sendStatus(win, {
    state: "error",
    reason: "Lost connection to Ronin and auto-recovery failed. Start Ronin manually with `ronin start`.",
  });
  return false;
}

function startHealthMonitor(win) {
  if (SKIP_HEALTH_CHECK) return;

  let recovering = false;
  const timer = setInterval(async () => {
    if (recovering || win.isDestroyed() || win.webContents.isDestroyed()) return;

    const health = await checkHealth(DEFAULT_URL);
    if (health.healthy) return;

    recovering = true;
    try {
      await tryRecoverRonin(win, health.reason);
    } finally {
      recovering = false;
    }
  }, MONITOR_INTERVAL_MS);

  win.on("closed", () => clearInterval(timer));
}

async function bootRonin(win) {
  if (SKIP_HEALTH_CHECK) {
    sendStatus(win, { state: "ready", url: DEFAULT_URL });
    return true;
  }

  const initial = await checkHealth(DEFAULT_URL);
  if (initial.healthy) {
    sendStatus(win, { state: "ready", url: DEFAULT_URL });
    return true;
  }

  sendStatus(win, { state: "starting", message: "Starting Ronin..." });
  if (!startRonin()) {
    sendStatus(win, {
      state: "error",
      reason: "Could not start Ronin automatically. Run `ronin start` and reopen the client.",
    });
    return false;
  }

  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await delay(1000);
    const health = await checkHealth(DEFAULT_URL);
    if (health.healthy) {
      sendStatus(win, { state: "ready", url: DEFAULT_URL });
      return true;
    }
  }

  sendStatus(win, {
    state: "error",
    reason: "Ronin did not become healthy in time. Check logs and run `ronin start` manually.",
  });
  return false;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    title: "Ronin Desktop Client",
    autoHideMenuBar: true,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await win.loadFile(path.join(__dirname, "renderer", "index.html"), {
    query: {
      targetUrl: DEFAULT_URL,
      state: "checking",
    },
  });

  const ready = await bootRonin(win);
  if (ready) {
    startHealthMonitor(win);
  }

  win.on("close", (event) => {
    if (isQuitting || process.platform === "darwin" && !tray) return;
    event.preventDefault();
    win.hide();
    sendStatus(win, { state: "tray", message: "Ronin client minimized to tray." });
  });

  return win;
}

function createTray() {
  if (tray) return;

  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP+6dY4WQAAAABJRU5ErkJggg=="
  );
  tray = new Tray(icon);
  tray.setToolTip("Ronin Desktop Client");

  const rebuildMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: "Show Ronin Client", click: () => mainWindow && mainWindow.show() },
      { type: "separator" },
      {
        label: "Restart Ronin",
        click: () => {
          const ok = restartRonin();
          if (mainWindow) {
            sendStatus(mainWindow, ok
              ? { state: "starting", message: "Restarting Ronin..." }
              : { state: "error", reason: "Failed to trigger Ronin restart." });
          }
        },
      },
      {
        label: "Open Ronin Logs",
        click: () => {
          const ok = openRoninLogs();
          if (mainWindow && !ok) {
            sendStatus(mainWindow, { state: "error", reason: "No Ronin log file found in ~/.ronin." });
          }
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  rebuildMenu();
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });
}

function registerIpc() {
  ipcMain.handle("ronin-client-action", async (_event, action) => {
    if (action === "restart") {
      const ok = restartRonin();
      if (mainWindow) {
        sendStatus(mainWindow, ok
          ? { state: "starting", message: "Restarting Ronin..." }
          : { state: "error", reason: "Failed to trigger Ronin restart." });
      }
      return { ok };
    }

    if (action === "logs") {
      return { ok: openRoninLogs() };
    }

    if (action === "show") {
      if (mainWindow) mainWindow.show();
      return { ok: true };
    }

    return { ok: false };
  });
}

app.whenReady().then(async () => {
  registerIpc();
  mainWindow = await createWindow();
  createTray();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createWindow();
      createTray();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) {
    app.quit();
  }
});
