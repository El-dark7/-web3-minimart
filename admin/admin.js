const socket = io({ reconnection: true, reconnectionAttempts: Infinity });

const root = document.getElementById("orders");
const riderSelect = document.getElementById("riderSelect");
const statusFilter = document.getElementById("statusFilter");
const searchInput = document.getElementById("searchInput");
const socketDot = document.getElementById("socketDot");
const socketState = document.getElementById("socketState");
const liveFeed = document.getElementById("liveFeed");
const dispatchQueue = document.getElementById("dispatchQueue");
const errorBanner = document.getElementById("errorBanner");
const photoInput = document.getElementById("photoInput");
const photoStatus = document.getElementById("photoStatus");
const flowStatus = document.getElementById("flowStatus");

const statTotal = document.getElementById("statTotal");
const statActive = document.getElementById("statActive");
const statReady = document.getElementById("statReady");
const statSla = document.getElementById("statSla");
const statDone = document.getElementById("statDone");

let riders = [];
let orders = [];
const orderMap = {};
let pollTimer = null;

const ACTIVE_STATUSES = new Set([
  "CREATED",
  "CONFIRMED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "ASSIGNED",
  "PICKED_UP",
  "ON_THE_WAY",
  "DELIVERED"
]);

const nextStatusAction = {
  CREATED: { label: "Confirm Order", status: "CONFIRMED" },
  CONFIRMED: { label: "Start Preparing", status: "PREPARING" },
  PREPARING: { label: "Ready For Pickup", status: "READY_FOR_PICKUP" }
};

function showError(message) {
  errorBanner.style.display = "block";
  errorBanner.textContent = message;
}

function clearError() {
  errorBanner.style.display = "none";
  errorBanner.textContent = "";
}

function pushFeed(message) {
  const node = document.createElement("div");
  node.className = "feed-item";
  node.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  liveFeed.prepend(node);
  while (liveFeed.children.length > 30) liveFeed.removeChild(liveFeed.lastChild);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString();
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!ms) return "0s";
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function isToday(dateLike) {
  const d = new Date(dateLike);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function updateStats() {
  statTotal.textContent = String(orders.length);
  statActive.textContent = String(orders.filter((o) => ACTIVE_STATUSES.has(o.status)).length);
  statReady.textContent = String(orders.filter((o) => o.status === "READY_FOR_PICKUP").length);
  statSla.textContent = String(orders.filter((o) => o.slaBreached).length);
  statDone.textContent = String(
    orders.filter((o) => o.status === "COMPLETED" && isToday(o.completedAt || o.completed_at || o.createdAt)).length
  );
}

function matchesFilters(order) {
  const status = statusFilter.value;
  const q = (searchInput.value || "").trim().toLowerCase();
  if (status !== "ALL" && order.status !== status) return false;
  if (!q) return true;
  const txt = `${order.id} ${order.chatId || ""} ${order.riderName || ""}`.toLowerCase();
  return txt.includes(q);
}

function actionsForOrder(order) {
  const actions = [];
  const transition = nextStatusAction[order.status];
  if (transition) {
    actions.push(
      `<button onclick="updateStatus('${order.id}', '${transition.status}')">${transition.label}</button>`
    );
  }

  if (order.status === "READY_FOR_PICKUP") {
    actions.push(`<button onclick="assignRider('${order.id}')">Assign Rider</button>`);
    actions.push(`<button onclick="autoAssignRider('${order.id}')">Auto Dispatch</button>`);
    actions.push(`<button onclick="predictDispatch('${order.id}')">Predict ETA</button>`);
  }

  if (!["COMPLETED", "CANCELLED"].includes(order.status)) {
    actions.push(`<button onclick="updatePriority('${order.id}', 'HIGH')">Escalate</button>`);
  }
  if (order.priorityLevel && order.priorityLevel !== "NORMAL") {
    actions.push(`<button onclick="updatePriority('${order.id}', 'NORMAL')">Set Normal</button>`);
  }

  if (!["COMPLETED", "CANCELLED"].includes(order.status)) {
    actions.push(`<button onclick="updateStatus('${order.id}', 'CANCELLED')">Cancel</button>`);
  }

  return actions.join("");
}

function renderOrder(order) {
  if (!matchesFilters(order)) return;

  let card = orderMap[order.id];
  const createdAt = order.createdAt || order.created_at || new Date().toISOString();

  if (!card) {
    card = document.createElement("div");
    card.className = "order";
    root.prepend(card);
    orderMap[order.id] = card;
  }

  card.innerHTML = `
    <div><strong>${order.id}</strong> <span class="pill">${order.status}</span></div>
    <div class="meta">Customer: ${order.chatId || "N/A"} | Source: ${(order.source || "web").toUpperCase()} | Rider: ${order.riderName || "Unassigned"} | Zone: ${order.zone || "CBD"}</div>
    <div class="meta">Created: ${new Date(createdAt).toLocaleString()}</div>
    <div class="meta">Total: KES ${formatMoney(order.total)} | Priority: ${order.priorityLevel || "NORMAL"} | SLA: ${order.slaBreached ? "BREACHED" : "OK"}</div>
    <div class="meta">Dispatch Attempts: ${order.dispatchAttempts || 0} | Redispatches: ${order.redispatchCount || 0} | Delivery Code: ${order.deliveryCode || "-"}</div>
    <div class="actions">${actionsForOrder(order)}</div>
  `;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed reading ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderOrders() {
  root.innerHTML = "";
  Object.keys(orderMap).forEach((id) => delete orderMap[id]);
  orders.forEach(renderOrder);
}

function upsertOrder(order) {
  const idx = orders.findIndex((o) => o.id === order.id);
  if (idx === -1) orders.unshift(order);
  else orders[idx] = { ...orders[idx], ...order };
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

async function loadRiders() {
  const res = await fetch("/api/riders");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load riders");
  riders = data;
  riderSelect.innerHTML = riders
    .map((r) => `<option value="${r.id}">${r.name} (${r.status}) load:${r.activeLoad ?? 0}</option>`)
    .join("");
}

async function loadOrders() {
  const res = await fetch("/api/orders");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load orders");
  orders = data;
  updateStats();
  renderOrders();
}

async function loadDispatchQueue() {
  const res = await fetch("/api/dispatch/queue?limit=10");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load dispatch queue");
  dispatchQueue.innerHTML = (data || []).map((q) => `
    <div class="feed-item">
      ${q.orderId} | ${q.priorityLevel} | score ${q.priorityScore} | ${q.status} | ${q.slaBreached ? "SLA BREACH" : "SLA OK"}
    </div>
  `).join("") || "<div class='feed-item'>Queue empty</div>";
}

async function loadAutomationStatus() {
  const res = await fetch("/api/ops/automation-status");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load automation status");

  const flow = data.orderFlow || {};
  const milestones = flow.milestonesMs || {};
  const last = flow.lastSweep;
  const lastText = last?.finishedAt
    ? `${new Date(last.finishedAt).toLocaleTimeString()} | moved ${last.moved}/${last.processed}`
    : "never";

  flowStatus.textContent =
    `Flow ${flow.enabled ? "ON" : "OFF"} | C->CF ${formatDurationMs(milestones.createdToConfirmed)} | ` +
    `CF->PR ${formatDurationMs(milestones.confirmedToPreparing)} | PR->RFP ${formatDurationMs(milestones.preparingToReady)} | ` +
    `Last ${lastText}`;
}

async function updateStatus(id, status) {
  const res = await fetch(`/api/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Failed to update status");
    return;
  }
  upsertOrder(data);
  updateStats();
  renderOrders();
  pushFeed(`Order ${id} -> ${status}`);
}

async function updatePriority(id, priorityLevel) {
  const res = await fetch(`/api/orders/${id}/priority`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ priorityLevel })
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Failed to update priority");
    return;
  }
  upsertOrder(data);
  updateStats();
  renderOrders();
  pushFeed(`Priority update ${id} -> ${priorityLevel}`);
  await loadDispatchQueue();
}

async function assignRider(id) {
  const riderId = riderSelect.value;
  const res = await fetch(`/api/orders/${id}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riderId })
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Failed to assign rider");
    return;
  }
  upsertOrder(data);
  updateStats();
  renderOrders();
  pushFeed(`Manual dispatch ${id} -> ${data.dispatch?.riderName || "rider"}`);
  await loadRiders();
}

async function autoAssignRider(id) {
  const res = await fetch(`/api/orders/${id}/assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Auto dispatch failed");
    return;
  }
  upsertOrder(data);
  updateStats();
  renderOrders();
  pushFeed(`Auto dispatch ${id} -> ${data.dispatch?.riderName || "rider"} ETA ${data.dispatch?.etaMinutes || "-"}`);
  await loadRiders();
}

async function runBatchDispatch() {
  const res = await fetch("/api/dispatch/run-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Batch dispatch failed");
    return;
  }
  const assignedCount = (data.assigned || []).filter((x) => x.ok).length;
  const redispatchedCount = (data.redispatched || []).length;
  pushFeed(`Batch dispatch processed ${data.processed || 0}, assigned ${assignedCount}, redispatched ${redispatchedCount}`);
  await refreshData();
}

async function runFlowSweep() {
  const res = await fetch("/api/ops/flow-sweep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Auto flow sweep failed");
    return;
  }
  const movedCount = (data.moved || []).filter((x) => x.ok).length;
  pushFeed(`Auto flow sweep processed ${data.processed || 0}, moved ${movedCount}`);
  await refreshData();
}

async function loadPhotoCoverage() {
  const res = await fetch("/api/admin/photo-coverage");
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    photoStatus.textContent = data.error || "Photo coverage fetch failed";
    return;
  }
  photoStatus.textContent = `Coverage ${data.withRealPhotos}/${data.total} (${data.coveragePct}%)`;
}

async function uploadProductPhotos() {
  const files = Array.from(photoInput.files || []);
  if (!files.length) {
    alert("Select at least one image file");
    return;
  }

  let success = 0;
  let failed = 0;
  photoStatus.textContent = `Uploading ${files.length} file(s)...`;

  for (const file of files) {
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await fetch("/api/admin/upload-product-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, dataUrl })
      });
      const data = await parseJsonSafe(res);
      if (!res.ok) {
        failed += 1;
        pushFeed(`Photo upload failed (${file.name}): ${data.error || "unknown error"}`);
        continue;
      }
      success += 1;
      pushFeed(`Photo uploaded for ${data.mappedProduct || data.slug}`);
    } catch (error) {
      failed += 1;
      pushFeed(`Photo upload failed (${file.name}): ${error.message}`);
    }
  }

  photoInput.value = "";
  await loadPhotoCoverage();
  photoStatus.textContent = `Uploaded ${success}, failed ${failed}`;
}

async function predictDispatch(id) {
  const res = await fetch(`/api/dispatch/predict/${id}`);
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Prediction failed");
    return;
  }
  const top = (data.matrix || [])
    .slice(0, 3)
    .map((m) => `${m.riderName} | ${m.onShift ? "on-shift" : "off-shift"} | ETA ${m.etaMinutes ?? "-"} min | ${m.distanceKm} km`)
    .join("\n");
  alert(`Dispatch ETA Matrix for ${id}\n${top || "No riders"}`);
}

async function refreshData() {
  try {
    clearError();
    await loadOrders();
    await loadDispatchQueue();
    await loadAutomationStatus();
    await loadPhotoCoverage();
  } catch (error) {
    showError(`Orders/queue sync error: ${error.message}`);
  }

  try {
    await loadRiders();
  } catch (error) {
    showError(`Riders sync error: ${error.message}`);
  }
}

function setSocketOnline(isOnline) {
  socketDot.classList.toggle("online", isOnline);
  socketState.textContent = isOnline ? "Socket Online" : "Socket Offline";
}

socket.on("connect", () => {
  setSocketOnline(true);
  pushFeed("Realtime connected");
});

socket.on("disconnect", () => {
  setSocketOnline(false);
  pushFeed("Realtime disconnected");
});

socket.on("new_order", (order) => {
  upsertOrder(order);
  updateStats();
  renderOrders();
  pushFeed(`New order from customer: ${order.id}`);
});

socket.on("order_updated", (order) => {
  upsertOrder(order);
  updateStats();
  renderOrders();
  pushFeed(`Order updated: ${order.id} -> ${order.status}`);
});

statusFilter.addEventListener("change", renderOrders);
searchInput.addEventListener("input", renderOrders);

if (pollTimer) clearInterval(pollTimer);
pollTimer = setInterval(refreshData, 5000);

refreshData();
