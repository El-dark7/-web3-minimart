const socket = io({ reconnection: true, reconnectionAttempts: Infinity });
const root = document.getElementById("orders");
const riderSelect = document.getElementById("riderSelect");
const refreshBtn = document.getElementById("refreshBtn");
const lastSync = document.getElementById("lastSync");
const feedRoot = document.getElementById("feed");
const socketDot = document.getElementById("socketDot");
const socketState = document.getElementById("socketState");
const statActive = document.getElementById("statActive");
const statAssigned = document.getElementById("statAssigned");
const statTransit = document.getElementById("statTransit");
const statDelivered = document.getElementById("statDelivered");

let riders = [];
let activeRiderId = null;
let ordersCache = [];
let refreshInFlight = false;

const ACTIVE_STATUSES = new Set(["ASSIGNED", "PICKED_UP", "ON_THE_WAY", "DELIVERED"]);
const nextRiderStatus = {
  ASSIGNED: { label: "Picked Up", status: "PICKED_UP" },
  PICKED_UP: { label: "On The Way", status: "ON_THE_WAY" },
  ON_THE_WAY: { label: "Mark Delivered", status: "DELIVERED" }
};

function money(total) {
  return Number(total || 0).toLocaleString();
}

function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

function formatDate(dateLike) {
  if (!dateLike) return "-";
  return new Date(dateLike).toLocaleString();
}

function updateSyncStamp(prefix = "Last sync") {
  if (!lastSync) return;
  lastSync.textContent = `${prefix}: ${new Date().toLocaleTimeString()}`;
}

function setSocketOnline(isOnline) {
  socketDot.classList.toggle("online", isOnline);
  socketState.textContent = isOnline ? "Realtime Online" : "Realtime Offline";
}

function pushFeed(message) {
  const node = document.createElement("div");
  node.className = "feed-item";
  node.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  feedRoot.prepend(node);
  while (feedRoot.children.length > 30) feedRoot.removeChild(feedRoot.lastChild);
}

function statusClass(status) {
  return String(status || "").toLowerCase();
}

function updateStats(activeOrders) {
  const assigned = activeOrders.filter((o) => o.status === "ASSIGNED").length;
  const inTransit = activeOrders.filter((o) => ["PICKED_UP", "ON_THE_WAY"].includes(o.status)).length;
  const delivered = activeOrders.filter((o) => o.status === "DELIVERED").length;
  statActive.textContent = String(activeOrders.length);
  statAssigned.textContent = String(assigned);
  statTransit.textContent = String(inTransit);
  statDelivered.textContent = String(delivered);
}

function cardForOrder(order) {
  const transition = nextRiderStatus[order.status];
  const action = transition
    ? `<button class="action-btn" onclick="updateRiderStatus('${order.id}', '${transition.status}')">${transition.label}</button>`
    : "";

  const itemsCount = Array.isArray(order.items)
    ? order.items.reduce((sum, item) => sum + Number(item.qty || 1), 0)
    : 0;

  return `
    <article class="order-card">
      <div class="order-head">
        <div class="order-id">${order.id}</div>
        <span class="status ${statusClass(order.status)}">${order.status}</span>
      </div>
      <div class="order-grid">
        <div>Total:<strong>KES ${money(order.total)}</strong></div>
        <div>Items:<strong>${itemsCount}</strong></div>
        <div>Customer:<strong>${order.chatId || "-"}</strong></div>
        <div>Zone:<strong>${order.zone || "CBD"}</strong></div>
        <div>Source:<strong>${(order.source || "web").toUpperCase()}</strong></div>
        <div>Created:<strong>${formatDate(order.createdAt || order.created_at)}</strong></div>
        <div>Rider:<strong>${order.riderName || "-"}</strong></div>
        <div>Delivery Code:<strong>${order.deliveryCode || "-"}</strong></div>
      </div>
      <div class="actions">${action}</div>
    </article>
  `;
}

function renderOrdersFromCache() {
  const mine = ordersCache.filter((o) => o.riderId === activeRiderId);
  const active = mine.filter((o) => ACTIVE_STATUSES.has(o.status));
  updateStats(active);
  root.innerHTML = active.length
    ? active.map(cardForOrder).join("")
    : "<p class='empty'>No active deliveries for this rider.</p>";
}

async function loadRiders() {
  const res = await fetch("/api/riders");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load riders");
  riders = Array.isArray(data) ? data : [];

  const hasSelected = riders.some((r) => r.id === activeRiderId);
  if (!hasSelected) activeRiderId = riders[0]?.id || null;

  riderSelect.innerHTML = riders
    .map((r) => `<option value="${r.id}">${r.name} (${r.status}) load:${r.activeLoad ?? 0}</option>`)
    .join("");
  riderSelect.value = activeRiderId || "";
}

async function loadOrders() {
  const res = await fetch("/api/orders");
  const data = await parseJsonSafe(res);
  if (!res.ok) throw new Error(data.error || "Failed to load orders");
  ordersCache = Array.isArray(data) ? data : [];
  renderOrdersFromCache();
}

async function updateRiderStatus(orderId, status) {
  const res = await fetch(`/api/orders/${orderId}/rider-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ riderId: activeRiderId, status })
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    alert(data.error || "Update failed");
    return;
  }
  pushFeed(`Order ${orderId} -> ${status}`);
  await refreshData();
}

async function refreshData() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  refreshBtn.disabled = true;
  try {
    await Promise.all([loadRiders(), loadOrders()]);
    updateSyncStamp("Last sync");
  } catch (error) {
    alert(error.message);
  } finally {
    refreshBtn.disabled = false;
    refreshInFlight = false;
  }
}

riderSelect.addEventListener("change", (event) => {
  activeRiderId = event.target.value;
  renderOrdersFromCache();
  pushFeed(`Switched rider context to ${event.target.options[event.target.selectedIndex]?.text || activeRiderId}`);
});

refreshBtn.addEventListener("click", refreshData);

socket.on("connect", () => {
  setSocketOnline(true);
  pushFeed("Realtime connected");
});

socket.on("disconnect", () => {
  setSocketOnline(false);
  pushFeed("Realtime disconnected");
});

socket.on("new_order", (order) => {
  pushFeed(`New order received: ${order.id}`);
  refreshData();
});

socket.on("order_updated", (order) => {
  pushFeed(`Order updated: ${order.id} -> ${order.status}`);
  refreshData();
});

refreshData();
setInterval(refreshData, 8000);
