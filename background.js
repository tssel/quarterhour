const HOUR_MS = 60 * 60 * 1000;
const LIMIT_MS = 15 * 60 * 1000;
const TICK_MS = 15 * 1000;

const DEFAULT_STATE = {
  sites: [],
  usage: {},
  protectionEnabled: false,
  unlockRequestedAt: null
};

let state = { ...DEFAULT_STATE };
let activeTab = null;
let lastTick = Date.now();

chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  await chrome.alarms.create("usage-tick", { periodInMinutes: 0.25 });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  await chrome.alarms.create("usage-tick", { periodInMinutes: 0.25 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "usage-tick") return;
  await recordActiveTime();
  await enforceActiveTab();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await recordActiveTime();
  activeTab = await getTab(tabId);
  lastTick = Date.now();
  await enforceActiveTab();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (activeTab?.id === tabId) {
    await recordActiveTime();
    activeTab = null;
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (activeTab?.id === tabId && changeInfo.url) {
    await recordActiveTime();
    activeTab = tab;
    lastTick = Date.now();
  }
  if (changeInfo.status === "complete") {
    await enforceTab(tab);
  }
});

chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0) return;
  const tab = await getTab(tabId);
  if (tab) await enforceTab(tab);
});

async function loadState() {
  const saved = await chrome.storage.local.get(DEFAULT_STATE);
  state = {
    ...DEFAULT_STATE,
    ...saved,
    sites: Array.isArray(saved.sites) ? saved.sites : [],
    usage: saved.usage && typeof saved.usage === "object" ? saved.usage : {}
  };
}

async function saveState() {
  await chrome.storage.local.set(state);
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function matchingSite(url) {
  const hostname = hostnameFor(url);
  return state.sites.find(
    (site) => hostname === site || hostname.endsWith(`.${site}`)
  );
}

function pruneUsage(site) {
  const cutoff = Date.now() - HOUR_MS;
  state.usage[site] = (state.usage[site] || []).filter(
    (entry) => entry.timestamp > cutoff
  );
}

function usedMs(site) {
  pruneUsage(site);
  return (state.usage[site] || []).reduce((total, entry) => total + entry.duration, 0);
}

async function recordActiveTime() {
  const now = Date.now();
  const elapsed = Math.min(now - lastTick, TICK_MS * 2);
  lastTick = now;
  if (!activeTab?.url || elapsed <= 0 || !state.protectionEnabled) return;

  const site = matchingSite(activeTab.url);
  if (!site) return;
  const remaining = Math.max(0, LIMIT_MS - usedMs(site));
  const duration = Math.min(elapsed, remaining);
  if (duration <= 0) return;

  state.usage[site] ??= [];
  state.usage[site].push({ timestamp: now, duration });
  await saveState();
}

async function enforceActiveTab() {
  if (!activeTab) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTab = tab;
  }
  if (activeTab) await enforceTab(activeTab);
}

async function enforceTab(tab) {
  if (!state.protectionEnabled || !tab?.url || tab.url.startsWith(chrome.runtime.getURL(""))) {
    return;
  }
  const site = matchingSite(tab.url);
  if (!site || usedMs(site) < LIMIT_MS) return;

  const blockedUrl = chrome.runtime.getURL(
    `blocked.html?site=${encodeURIComponent(site)}`
  );
  if (tab.url !== blockedUrl) {
    await chrome.tabs.update(tab.id, { url: blockedUrl });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error.message }));
  return true;
});

async function handleMessage(message) {
  await loadState();
  if (message.type === "get-state") {
    return {
      ...state,
      usageMs: Object.fromEntries(
        state.sites.map((site) => [site, usedMs(site)])
      ),
      unlockAvailableAt: state.unlockRequestedAt
        ? state.unlockRequestedAt + 5 * 60 * 1000
        : null
    };
  }

  if (message.type === "request-unlock") {
    if (!state.protectionEnabled) return { ok: true, unlocked: true };
    if (!state.unlockRequestedAt) {
      state.unlockRequestedAt = Date.now();
      await saveState();
    }
    return { ok: true, unlocked: false, unlockAvailableAt: state.unlockRequestedAt + 5 * 60 * 1000 };
  }

  if (message.type === "save-settings") {
    if (state.protectionEnabled && !isUnlockAvailable()) {
      throw new Error("Settings are locked. Start the five-minute unlock timer first.");
    }
    state.sites = normalizeSites(message.sites);
    state.protectionEnabled = Boolean(message.protectionEnabled);
    state.unlockRequestedAt = null;
    await saveState();
    await enforceActiveTab();
    return { ok: true };
  }

  if (message.type === "reset-usage") {
    if (state.protectionEnabled && !isUnlockAvailable()) {
      throw new Error("Settings are locked. Start the five-minute unlock timer first.");
    }
    state.usage = {};
    await saveState();
    return { ok: true };
  }

  throw new Error("Unknown message.");
}

function isUnlockAvailable() {
  return state.unlockRequestedAt !== null &&
    Date.now() >= state.unlockRequestedAt + 5 * 60 * 1000;
}

function normalizeSites(sites) {
  return [...new Set(
    (Array.isArray(sites) ? sites : [])
      .map((site) => site.trim().toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0])
      .filter((site) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(site))
  )];
}

loadState();
