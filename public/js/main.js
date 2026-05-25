const visitCount = document.querySelector("#visitCount");
const playCount = document.querySelector("#playCount");
const playButton = document.querySelector("#playButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const gameFrame = document.querySelector("#gameFrame");
const playerGate = document.querySelector("#playerGate");
const playerGateForm = document.querySelector("#playerGateForm");
const playerNameInput = document.querySelector("#playerNameInput");
const playerBadge = document.querySelector("#playerBadge");
const changePlayerButton = document.querySelector("#changePlayerButton");
const playerStorageKey = "hyphaePlayerProfile";

function formatNumber(value) {
  return new Intl.NumberFormat("es").format(Number(value || 0));
}

function getQueryPlayerName() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("player") || "").trim();
}

function getPlayerProfile() {
  try {
    const raw = localStorage.getItem(playerStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function generatePlayerId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function savePlayerProfile(name) {
  const profile = {
    id: getPlayerProfile()?.id || generatePlayerId(),
    name: name.trim()
  };
  localStorage.setItem(playerStorageKey, JSON.stringify(profile));
  return profile;
}

function ensurePlayerProfile() {
  const queryName = getQueryPlayerName();
  if (queryName) {
    return savePlayerProfile(queryName);
  }
  return getPlayerProfile();
}

function updatePlayerBadge() {
  const profile = ensurePlayerProfile();
  playerBadge.textContent = profile?.name || "Invitado";
}

function openPlayerGate(prefill = "") {
  playerGate.classList.add("is-open");
  playerGate.setAttribute("aria-hidden", "false");
  document.body.classList.add("gate-open");
  playerNameInput.value = prefill;
  playerNameInput.focus();
}

function closePlayerGate() {
  playerGate.classList.remove("is-open");
  playerGate.setAttribute("aria-hidden", "true");
  document.body.classList.remove("gate-open");
}

function getTrackingPayload() {
  const profile = ensurePlayerProfile();
  return {
    playerId: profile?.id || "",
    playerName: profile?.name || ""
  };
}

function updateStats(stats) {
  visitCount.textContent = formatNumber(stats.visits);
  playCount.textContent = formatNumber(stats.plays);
}

async function fetchStats() {
  const response = await fetch("/api/stats");
  const data = await response.json();
  updateStats(data.stats);
}

async function registerVisit() {
  if (sessionStorage.getItem("hyphaeVisitRegistered") === "1") {
    await fetchStats();
    return;
  }

  const response = await fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getTrackingPayload())
  });
  const data = await response.json();
  sessionStorage.setItem("hyphaeVisitRegistered", "1");
  updateStats(data.stats);
}

async function registerPlay() {
  const response = await fetch("/api/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getTrackingPayload())
  });
  const data = await response.json();
  updateStats(data.stats);
}

playButton.addEventListener("click", async () => {
  await registerPlay();
  gameFrame.focus();
});

fullscreenButton.addEventListener("click", async () => {
  if (gameFrame.requestFullscreen) {
    await gameFrame.requestFullscreen();
  }
});

window.addEventListener("message", async (event) => {
  if (event.data && (event.data.type === "HY_GAME_PLAY" || event.data.type === "game:play")) {
    await registerPlay();
  }
});

playerGateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = playerNameInput.value.trim().slice(0, 32);
  if (!name) {
    playerNameInput.focus();
    return;
  }

  savePlayerProfile(name);
  updatePlayerBadge();
  closePlayerGate();
  await registerVisit().catch(() => fetchStats());
});

changePlayerButton.addEventListener("click", () => {
  const currentName = getPlayerProfile()?.name || "";
  openPlayerGate(currentName);
});

const currentProfile = ensurePlayerProfile();
updatePlayerBadge();
if (!currentProfile?.name) {
  openPlayerGate();
} else {
  closePlayerGate();
  registerVisit().catch(() => fetchStats());
}
