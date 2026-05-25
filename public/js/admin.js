const visitCount = document.querySelector("#adminVisitCount");
const playCount = document.querySelector("#adminPlayCount");
const logsTable = document.querySelector("#logsTable");
const visitsChart = document.querySelector("#visitsChart");
const uploadForm = document.querySelector("#uploadForm");
const uploadMessage = document.querySelector("#uploadMessage");
const resetButton = document.querySelector("#resetButton");
const refreshButton = document.querySelector("#refreshButton");
const logoutButton = document.querySelector("#logoutButton");
const logTypeFilter = document.querySelector("#logTypeFilter");
const deployTimestamp = document.querySelector("#deployTimestamp");
const deployFiles = document.querySelector("#deployFiles");
let latestAdminData = null;

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
  const ratio = window.devicePixelRatio || 1;
  const width = visitsChart.clientWidth || 720;
  const height = 320;
  visitsChart.width = width * ratio;
  visitsChart.height = height * ratio;
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);

  const padding = 38;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;
  const maxVisits = Math.max(1, ...days.map((day) => day.visits));

  ctx.strokeStyle = "#343c4b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  if (days.length === 0) {
    ctx.fillStyle = "#a9b1c1";
    ctx.font = "15px system-ui";
    ctx.fillText("Sin datos todavia", padding, height / 2);
    return;
  }

  const barGap = 8;
  const barWidth = Math.max(12, (chartWidth - barGap * (days.length - 1)) / days.length);

  days.forEach((day, index) => {
    const barHeight = Math.max(2, (day.visits / maxVisits) * chartHeight);
    const x = padding + index * (barWidth + barGap);
    const y = height - padding - barHeight;

    ctx.fillStyle = "#ff5c57";
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#a9b1c1";
    ctx.font = "11px system-ui";
    const label = day.day.slice(5);
    ctx.save();
    ctx.translate(x + barWidth / 2, height - 14);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = "right";
    ctx.fillText(label, 0, 0);
    ctx.restore();
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

  const response = await fetch("/api/admin/reset", { method: "POST" });
  if (response.ok) {
    await loadAdminStats();
  }
});

refreshButton.addEventListener("click", loadAdminStats);
logTypeFilter.addEventListener("change", () => {
  if (latestAdminData) {
    renderLogs(latestAdminData.logs);
  }
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/";
});

window.addEventListener("resize", () => loadAdminStats());
loadAdminStats();
