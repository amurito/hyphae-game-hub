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
let chartInstance = null;

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

loadAdminStats();
