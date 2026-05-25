const visitCount = document.querySelector("#visitCount");
const playCount = document.querySelector("#playCount");
const playButton = document.querySelector("#playButton");
const fullscreenButton = document.querySelector("#fullscreenButton");
const gameFrame = document.querySelector("#gameFrame");

function formatNumber(value) {
  return new Intl.NumberFormat("es").format(Number(value || 0));
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

  const response = await fetch("/api/visit", { method: "POST" });
  const data = await response.json();
  sessionStorage.setItem("hyphaeVisitRegistered", "1");
  updateStats(data.stats);
}

async function registerPlay() {
  const response = await fetch("/api/play", { method: "POST" });
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

registerVisit().catch(() => fetchStats());
