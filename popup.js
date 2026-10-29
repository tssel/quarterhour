const form = document.querySelector("#settings-form");
const sitesInput = document.querySelector("#sites");
const enabledInput = document.querySelector("#enabled");
const saveButton = document.querySelector("#save-button");
const unlockButton = document.querySelector("#unlock-button");
const lockPanel = document.querySelector("#lock-panel");
const unlockMessage = document.querySelector("#unlock-message");
const countdown = document.querySelector("#countdown");
const usageList = document.querySelector("#usage-list");
const error = document.querySelector("#error");
let currentState;
let timer;

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (response?.error) throw new Error(response.error);
  return response;
}

async function refresh() {
  currentState = await send("get-state");
  sitesInput.value = currentState.sites.join("\n");
  enabledInput.checked = currentState.protectionEnabled;
  const locked = currentState.protectionEnabled && !isUnlocked();
  sitesInput.disabled = locked;
  enabledInput.disabled = locked;
  saveButton.disabled = locked;
  unlockButton.hidden = !locked;
  document.querySelector("#status-label").textContent =
    currentState.protectionEnabled ? "Protection is active" : "Protection is off";
  document.querySelector("#status-dot").classList.toggle("on", currentState.protectionEnabled);
  lockPanel.hidden = !locked;
  renderUsage();
  if (locked) startCountdown();
}

function isUnlocked() {
  return currentState.unlockAvailableAt && Date.now() >= currentState.unlockAvailableAt;
}

function startCountdown() {
  clearInterval(timer);
  const update = () => {
    const remaining = Math.max(0, currentState.unlockAvailableAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    countdown.textContent = remaining ? `Ready in ${minutes}:${String(seconds).padStart(2, "0")}` : "Settings unlocked";
    if (!remaining) refresh().catch(showError);
  };
  update();
  timer = setInterval(update, 1000);
}

function renderUsage() {
  usageList.innerHTML = "";
  if (!currentState.sites.length) {
    usageList.innerHTML = '<div class="usage-row"><span>No sites added yet</span></div>';
    return;
  }
  for (const site of currentState.sites) {
    const used = Math.min(15, Math.floor((currentState.usageMs[site] || 0) / 60000));
    const row = document.createElement("div");
    row.className = "usage-row";
    row.innerHTML = `<span>${site}</span><span class="usage-time">${used} / 15 min</span>`;
    usageList.appendChild(row);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await send("save-settings", {
      sites: sitesInput.value.split("\n"),
      protectionEnabled: enabledInput.checked
    });
    await refresh();
    error.textContent = "";
  } catch (caught) {
    showError(caught);
  }
});

unlockButton.addEventListener("click", async () => {
  try {
    const response = await send("request-unlock");
    currentState.unlockAvailableAt = response.unlockAvailableAt;
    lockPanel.hidden = false;
    unlockButton.hidden = true;
    unlockMessage.textContent = "The countdown has started. You can keep using your protected sites while you wait.";
    startCountdown();
    error.textContent = "";
  } catch (caught) {
    showError(caught);
  }
});

document.querySelector("#reset-button").addEventListener("click", async () => {
  try {
    await send("reset-usage");
    await refresh();
    error.textContent = "";
  } catch (caught) {
    showError(caught);
  }
});

function showError(caught) {
  error.textContent = caught.message || "Something went wrong.";
}

refresh().catch(showError);
