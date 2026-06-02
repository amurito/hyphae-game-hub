const inviteNameInput = document.querySelector("#inviteNameInput");
const generateInviteButton = document.querySelector("#generateInviteButton");
const inviteResult = document.querySelector("#inviteResult");
const inviteLinkOutput = document.querySelector("#inviteLinkOutput");
const copyInviteButton = document.querySelector("#copyInviteButton");
const visitCount = document.querySelector("#adminVisitCount");
const playCount = document.querySelector("#adminPlayCount");
const logsTable = document.querySelector("#logsTable");
const playersTable = document.querySelector("#playersTable");
const playerCount = document.querySelector("#playerCount");
const visitsChart = document.querySelector("#visitsChart");
const uploadForm = document.querySelector("#uploadForm");
const uploadMessage = document.querySelector("#uploadMessage");
const resetButton = document.querySelector("#resetButton");
const refreshButton = document.querySelector("#refreshButton");
const exportCsvButton = document.querySelector("#exportCsvButton");
const logoutButton = document.querySelector("#logoutButton");
const logTypeFilter = document.querySelector("#logTypeFilter");
const deployTimestamp = document.querySelector("#deployTimestamp");
const deployFiles = document.querySelector("#deployFiles");
let latestAdminData = null;
let chartInstance = null;
let telRoutesChartInstance = null;
let telPlatformChartInstance = null;

function formatNumber(value) {
  return new Intl.NumberFormat("es").format(Number(value || 0));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function drawChart(days) {
  const ctx = visitsChart.getContext("2d");
  if (chartInstance) {
    chartInstance.destroy();
  }
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: days.map((d) => d.day.slice(5)),
      datasets: [
        {
          label: "Visitas",
          data: days.map((d) => d.visits),
          backgroundColor: "#ff5c57",
          borderRadius: 4,
          borderSkipped: false
        },
        {
          label: "Partidas",
          data: days.map((d) => d.plays),
          backgroundColor: "#75b7ff",
          borderRadius: 4,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#a9b1c1",
            font: { family: "Inter, system-ui", size: 12 },
            boxWidth: 12,
            boxHeight: 12
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#a9b1c1", font: { size: 11 } },
          grid: { color: "rgba(52,60,75,0.5)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#a9b1c1", precision: 0 },
          grid: { color: "rgba(52,60,75,0.5)" }
        }
      }
    }
  });
}

function renderLogs(logs) {
  logsTable.innerHTML = "";
  const filter = logTypeFilter.value;
  const filteredLogs = filter === "all" ? logs : logs.filter((log) => log.type === filter);

  if (filteredLogs.length === 0) {
    logsTable.innerHTML = `<tr><td colspan="5">No hay logs registrados.</td></tr>`;
    return;
  }

  for (const log of filteredLogs) {
    const row = document.createElement("tr");
    const playerLabel = log.meta.playerName || (log.meta.playerId ? `ID ${log.meta.playerId.slice(0, 8)}` : "-");
    row.innerHTML = `
      <td>${formatDate(log.created_at)}</td>
      <td>${log.type === "visit" ? "Visita" : "Partida"}</td>
      <td>${playerLabel}</td>
      <td>${log.meta.ip || "-"}</td>
      <td>${log.meta.userAgent || "-"}</td>
    `;
    logsTable.appendChild(row);
  }
}

function renderPlayers(logs) {
  const players = new Map();

  for (const log of logs) {
    const key = log.meta.playerId || log.meta.playerName || "Anonimo";
    const name = log.meta.playerName || "Anonimo";
    if (!players.has(key)) {
      players.set(key, { name, visits: 0, plays: 0, lastSeen: log.created_at });
    }
    const p = players.get(key);
    if (log.type === "visit") p.visits++;
    else if (log.type === "play") p.plays++;
    if (log.created_at > p.lastSeen) p.lastSeen = log.created_at;
  }

  const sorted = [...players.values()].sort((a, b) => (b.visits + b.plays) - (a.visits + a.plays));
  playerCount.textContent = `${sorted.length} jugador${sorted.length !== 1 ? "es" : ""}`;
  playersTable.innerHTML = "";

  if (sorted.length === 0) {
    playersTable.innerHTML = `<tr><td colspan="4">Sin jugadores registrados.</td></tr>`;
    return;
  }

  for (const p of sorted) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><strong>${p.name}</strong></td>
      <td>${p.visits}</td>
      <td>${p.plays}</td>
      <td>${formatDate(p.lastSeen)}</td>
    `;
    playersTable.appendChild(row);
  }
}

function exportCsv(logs) {
  const filter = logTypeFilter.value;
  const rows = filter === "all" ? logs : logs.filter((l) => l.type === filter);
  const header = ["Fecha", "Tipo", "Jugador", "PlayerID", "IP", "Navegador"];
  const lines = [header.join(",")];

  for (const log of rows) {
    const cols = [
      `"${log.created_at}"`,
      log.type === "visit" ? "Visita" : "Partida",
      `"${(log.meta.playerName || "").replace(/"/g, '""')}"`,
      `"${(log.meta.playerId || "").replace(/"/g, '""')}"`,
      `"${(log.meta.ip || "").replace(/"/g, '""')}"`,
      `"${(log.meta.userAgent || "").replace(/"/g, '""')}"`
    ];
    lines.push(cols.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hyphae-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderDeployment(deployment) {
  if (!deployment) {
    deployTimestamp.textContent = "Sin datos";
    deployFiles.textContent = "0";
    return;
  }

  deployTimestamp.textContent = formatDate(deployment.deployedAt);
  deployFiles.textContent = formatNumber(deployment.fileCount);
}

async function loadAdminStats() {
  const response = await fetch("/api/admin/stats");
  if (response.status === 401) {
    window.location.href = "/admin/login";
    return;
  }

  const data = await response.json();
  latestAdminData = data;
  visitCount.textContent = formatNumber(data.stats.visits);
  playCount.textContent = formatNumber(data.stats.plays);
  drawChart(data.days);
  renderDeployment(data.deployment);
  renderPlayers(data.logs);
  renderLogs(data.logs);
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadMessage.classList.remove("error");
  uploadMessage.textContent = "Subiendo...";

  const formData = new FormData(uploadForm);
  const response = await fetch("/api/admin/upload", {
    method: "POST",
    body: formData
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    uploadMessage.classList.add("error");
    uploadMessage.textContent = data.error || "No se pudo subir el juego.";
    return;
  }

  uploadMessage.textContent = data.message || "Juego actualizado.";
  await loadAdminStats();
});

resetButton.addEventListener("click", async () => {
  if (!confirm("Esto borra contadores y logs. Continuar?")) {
    return;
  }

  resetButton.disabled = true;
  resetButton.textContent = "Reseteando...";

  try {
    const response = await fetch("/api/admin/reset", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(`Error al resetear: ${data.error || response.statusText}`);
      return;
    }
    await loadAdminStats();
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Resetear contadores";
  }
});

generateInviteButton.addEventListener("click", () => {
  const name = inviteNameInput.value.trim();
  if (!name) { inviteNameInput.focus(); return; }
  const url = `${location.origin}/?player=${encodeURIComponent(name)}`;
  inviteLinkOutput.value = url;
  inviteResult.hidden = false;
  inviteLinkOutput.select();
});

copyInviteButton.addEventListener("click", async () => {
  if (!inviteLinkOutput.value) return;
  await navigator.clipboard.writeText(inviteLinkOutput.value).catch(() => {});
  copyInviteButton.textContent = "Copiado!";
  setTimeout(() => { copyInviteButton.textContent = "Copiar"; }, 2000);
});

inviteNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") generateInviteButton.click();
});

refreshButton.addEventListener("click", loadAdminStats);
exportCsvButton.addEventListener("click", () => {
  if (latestAdminData) exportCsv(latestAdminData.logs);
});
logTypeFilter.addEventListener("change", () => {
  if (latestAdminData) {
    renderLogs(latestAdminData.logs);
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/";
});

function drawPieChart(canvasId, instanceRef, labels, data, colors) {
  const ctx = document.querySelector("#" + canvasId).getContext("2d");
  if (instanceRef.value) instanceRef.value.destroy();
  instanceRef.value = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: "#202530" }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#a9b1c1", font: { size: 12 }, boxWidth: 12, padding: 14 } }
      }
    }
  });
}

const ROUTE_COLORS = {
  "HOMEOSTASIS": "#26a269", "ALLOSTASIS": "#1c71d8", "HOMEORHESIS": "#9141ac",
  "ESPORULACIÓN": "#e5a50a", "ESPORULACION": "#e5a50a", "SIMBIOSIS": "#33dd88",
  "PARASITISMO": "#c01c28", "HIPERASIMILACIÓN": "#ff7800", "HIPERASIMILACION": "#ff7800",
  "DEPREDADOR DE REALIDADES": "#cc3322", "METABOLISMO OSCURO": "#8844aa",
  "COLAPSO DEPREDATORIO": "#ff2244", "SINGULARIDAD": "#44ddff",
  "DOMADOR DEL CAOS": "#ff9900", "POLIMORFÍA TOTAL": "#aa44ff",
  "MENTE COLMENA DISTRIBUIDA": "#44ffaa", "PANSPERMIA NEGRA": "#888888",
  "ASCESIS_PROFUNDA": "#cc88ff", "COLAPSO CONTROLADO": "#ffcc44",
};
const FALLBACK_COLORS = ["#75b7ff","#ff5c57","#5ee6a8","#ffcc44","#ff7800","#9141ac","#1c71d8"];

async function loadTelemetryStats() {
  const telSection = document.querySelector("#telemetrySection");
  if (!telSection) return;
  try {
    const resp = await fetch("/api/admin/telemetry");
    if (!resp.ok) return;
    const data = await resp.json();

    document.querySelector("#telTotalRuns").textContent = formatNumber(data.total_runs);
    document.querySelector("#telDistinctSessions").textContent = formatNumber(data.distinct_sessions);
    document.querySelector("#telLastReceived").textContent = data.last_received ? formatDate(data.last_received) : "—";
    document.querySelector("#telemetryRunCount").textContent = `${formatNumber(data.total_runs)} run${data.total_runs !== 1 ? "s" : ""}`;

    const routesRef = { value: telRoutesChartInstance };
    const routeLabels = data.by_route.map(r => r.final_route || "?");
    const routeData = data.by_route.map(r => r.count);
    const routeColors = routeLabels.map((l, i) => ROUTE_COLORS[l] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]);
    drawPieChart("telRoutesChart", routesRef, routeLabels, routeData, routeColors);
    telRoutesChartInstance = routesRef.value;

    const platRef = { value: telPlatformChartInstance };
    const platLabels = data.by_platform.map(p => p.platform || "?");
    const platData = data.by_platform.map(p => p.count);
    const platColors = ["#75b7ff","#5ee6a8","#ffcc44","#ff5c57"].slice(0, platLabels.length);
    drawPieChart("telPlatformChart", platRef, platLabels, platData, platColors);
    telPlatformChartInstance = platRef.value;
  } catch (e) {
    // silencioso — la sección queda con "—"
  }
}

loadAdminStats();
loadTelemetryStats();
