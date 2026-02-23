require("dotenv").config();

const express = require("express");
const http = require("http");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const riderEngine = require("./services/rider.engine");

const PRODUCTS_MODULE_PATH = "./data/products";
const REAL_PHOTO_DIR = path.resolve(__dirname, "../public/assets/products/real");
const ALLOWED_PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
let products = require(PRODUCTS_MODULE_PATH);

const ORDER_STATUS = {
  CREATED: "CREATED",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  ASSIGNED: "ASSIGNED",
  PICKED_UP: "PICKED_UP",
  ON_THE_WAY: "ON_THE_WAY",
  DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED"
};

const ALLOWED_TRANSITIONS = {
  [ORDER_STATUS.CREATED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY_FOR_PICKUP]: [ORDER_STATUS.ASSIGNED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ASSIGNED]: [ORDER_STATUS.PICKED_UP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PICKED_UP]: [ORDER_STATUS.ON_THE_WAY, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.ON_THE_WAY]: [ORDER_STATUS.DELIVERED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.DELIVERED]: [ORDER_STATUS.COMPLETED]
};

const STATUS_MESSAGES = {
  [ORDER_STATUS.CREATED]: "Your order was created.",
  [ORDER_STATUS.CONFIRMED]: "Your order is confirmed.",
  [ORDER_STATUS.PREPARING]: "Your order is being prepared.",
  [ORDER_STATUS.READY_FOR_PICKUP]: "Your order is ready for pickup.",
  [ORDER_STATUS.ASSIGNED]: "A rider has been assigned to your order.",
  [ORDER_STATUS.PICKED_UP]: "Rider picked up your order.",
  [ORDER_STATUS.ON_THE_WAY]: "Your rider is on the way.",
  [ORDER_STATUS.DELIVERED]: "Your rider marked order delivered. Confirm in app with your code.",
  [ORDER_STATUS.COMPLETED]: "Order completed. Thank you for shopping with us.",
  [ORDER_STATUS.CANCELLED]: "Order was cancelled."
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));
app.use("/admin", express.static("admin"));
app.use("/rider", express.static("rider"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

let storageMode = process.env.NO_DB_MODE === "1" ? "memory" : "postgres";
const memoryOrders = new Map();
const DISPATCH_INTERVAL_MS = Number(process.env.DISPATCH_INTERVAL_MS || 15000);
const DISPATCH_BATCH_LIMIT = Number(process.env.DISPATCH_BATCH_LIMIT || 5);
const DISPATCH_AUTO_ENABLED = process.env.DISPATCH_AUTO_ENABLED !== "0";
const DISPATCH_ASSIGN_TIMEOUT_MS = Number(process.env.DISPATCH_ASSIGN_TIMEOUT_MS || 180000);
const ORDER_FLOW_AUTO_ENABLED = process.env.ORDER_FLOW_AUTO_ENABLED !== "0";
const ORDER_FLOW_INTERVAL_MS = Number(process.env.ORDER_FLOW_INTERVAL_MS || 10000);
const ORDER_FLOW_CONFIRM_DELAY_MS = Number(process.env.ORDER_FLOW_CONFIRM_DELAY_MS || 15000);
const ORDER_FLOW_PREPARING_DELAY_MS = Number(process.env.ORDER_FLOW_PREPARING_DELAY_MS || 45000);
const ORDER_FLOW_READY_DELAY_MS = Number(process.env.ORDER_FLOW_READY_DELAY_MS || 90000);
const SLA_CREATED_MS = Number(process.env.SLA_CREATED_MS || 900000);
const SLA_TRANSIT_MS = Number(process.env.SLA_TRANSIT_MS || 3600000);
let batchDispatchRunning = false;
let orderFlowSweepRunning = false;
let lastOrderFlowSweep = null;

const TELEGRAM_API = process.env.TELEGRAM_BOT_TOKEN
  ? `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
  : null;

function toClientOrder(row) {
  const priorityLevel = row.priority_level || "NORMAL";
  const dispatchAttempts = Number(row.dispatch_attempts || 0);
  const redispatchCount = Number(row.redispatch_count || 0);
  const slaBreached = isOrderSlaBreached(row);
  const priorityScore = computePriorityScore(row);

  return {
    id: row.id,
    chatId: row.chat_id,
    source: row.source || "web",
    items: row.items,
    total: row.total,
    status: row.status,
    riderId: row.rider_id,
    riderName: row.rider_name,
    zone: row.dropoff_zone || row.zone || "CBD",
    priorityLevel,
    dispatchAttempts,
    redispatchCount,
    priorityScore,
    slaBreached,
    assignedAt: row.assigned_at,
    deliveryCode: row.delivery_code,
    customerConfirmed: row.customer_confirmed,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
    completedAt: row.completed_at
  };
}

function randomDeliveryCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function canTransition(currentStatus, nextStatus) {
  const options = ALLOWED_TRANSITIONS[currentStatus] || [];
  return options.includes(nextStatus);
}

function getOrderFlowMilestones() {
  const confirmMs = Math.max(0, ORDER_FLOW_CONFIRM_DELAY_MS);
  const preparingMs = Math.max(confirmMs, ORDER_FLOW_PREPARING_DELAY_MS);
  const readyMs = Math.max(preparingMs, ORDER_FLOW_READY_DELAY_MS);
  return {
    [ORDER_STATUS.CREATED]: confirmMs,
    [ORDER_STATUS.CONFIRMED]: preparingMs,
    [ORDER_STATUS.PREPARING]: readyMs
  };
}

function getOrderAgeMs(row) {
  return Date.now() - new Date(row.created_at || Date.now()).getTime();
}

function getPriorityWeight(priorityLevel) {
  if (priorityLevel === "CRITICAL") return 1000;
  if (priorityLevel === "HIGH") return 600;
  if (priorityLevel === "NORMAL") return 300;
  return 100;
}

function resolvePriorityLevel(inputPriority, express) {
  if (express) return "HIGH";
  const p = String(inputPriority || "NORMAL").toUpperCase();
  if (["LOW", "NORMAL", "HIGH", "CRITICAL"].includes(p)) return p;
  return "NORMAL";
}

function computePriorityScore(row) {
  const createdAt = new Date(row.created_at || Date.now()).getTime();
  const ageMinutes = Math.floor((Date.now() - createdAt) / 60000);
  const base = getPriorityWeight(row.priority_level || "NORMAL");
  const redispatchBoost = Number(row.redispatch_count || 0) * 90;
  const breachBoost = isOrderSlaBreached(row) ? 180 : 0;
  return base + ageMinutes + redispatchBoost + breachBoost;
}

function isOrderSlaBreached(row) {
  const now = Date.now();
  const createdAt = new Date(row.created_at || Date.now()).getTime();
  const assignedAt = row.assigned_at ? new Date(row.assigned_at).getTime() : null;

  if ([ORDER_STATUS.COMPLETED, ORDER_STATUS.CANCELLED].includes(row.status)) return false;

  if ([ORDER_STATUS.CREATED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(row.status)) {
    return now - createdAt > SLA_CREATED_MS;
  }

  if ([ORDER_STATUS.ASSIGNED, ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY].includes(row.status)) {
    const from = assignedAt || createdAt;
    return now - from > SLA_TRANSIT_MS;
  }

  return false;
}

function toSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reloadProductsCatalog() {
  delete require.cache[require.resolve(PRODUCTS_MODULE_PATH)];
  products = require(PRODUCTS_MODULE_PATH);
  return products;
}

function ensurePhotoDir() {
  fs.mkdirSync(REAL_PHOTO_DIR, { recursive: true });
}

function decodeBase64Image(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

function getPhotoCoveragePayload() {
  const all = products;
  const withReal = all.filter((p) => p.hasRealPhoto);
  const missing = all.filter((p) => !p.hasRealPhoto).map((p) => ({
    slug: p.slug,
    name: p.name
  }));
  return {
    total: all.length,
    withRealPhotos: withReal.length,
    coveragePct: all.length ? Number(((withReal.length / all.length) * 100).toFixed(1)) : 0,
    missing
  };
}

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_API || !chatId) return;
  try {
    const normalized =
      /^-?\d+$/.test(String(chatId).trim())
        ? Number(chatId)
        : String(chatId).startsWith("@")
          ? String(chatId)
          : null;
    if (!normalized) return;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: normalized,
      text
    });
  } catch (error) {
    console.error("TELEGRAM SEND ERROR:", error.response?.data || error.message);
  }
}

function isTelegramOrder(order) {
  return String(order?.source || "").toLowerCase() === "telegram";
}

function buildTelegramStatusMessage(order, meta = {}) {
  const statusText = STATUS_MESSAGES[order.status] || `Status updated: ${order.status}`;
  const header = `Order ${order.id}`;
  const sourceLine = `Channel: Telegram`;
  const totalLine = `Total: KES ${order.total}`;
  const zoneLine = `Zone: ${order.zone || "CBD"}`;

  const details = [];
  if (order.riderName) details.push(`Rider: ${order.riderName}`);
  if (meta.etaMinutes) details.push(`ETA: ${meta.etaMinutes} min`);
  if (meta.distanceKm !== undefined && meta.distanceKm !== null) details.push(`Distance: ${meta.distanceKm} km`);
  if (order.status === ORDER_STATUS.DELIVERED || meta.includeCode) {
    details.push(`Delivery code: ${order.deliveryCode}`);
  }
  if (meta.extraLine) details.push(meta.extraLine);

  return [header, statusText, sourceLine, totalLine, zoneLine, ...details].filter(Boolean).join("\n");
}

async function notifyOrderStatus(order, meta = {}) {
  if (!isTelegramOrder(order)) return;
  const message = buildTelegramStatusMessage(order, meta);
  await sendTelegram(order.chatId, message);
}

async function initDB() {
  if (storageMode === "memory") {
    console.warn("NO_DB_MODE=1 -> running with in-memory storage");
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        source TEXT DEFAULT 'web',
        items JSONB,
        total INTEGER,
        status TEXT,
        rider_id TEXT,
        rider_name TEXT,
        dropoff_zone TEXT,
        priority_level TEXT DEFAULT 'NORMAL',
        dispatch_attempts INTEGER DEFAULT 0,
        redispatch_count INTEGER DEFAULT 0,
        assigned_at TIMESTAMP,
        excluded_rider_id TEXT,
        delivery_code TEXT,
        customer_confirmed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        delivered_at TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);

    await pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web',
        ADD COLUMN IF NOT EXISTS rider_id TEXT,
        ADD COLUMN IF NOT EXISTS rider_name TEXT,
        ADD COLUMN IF NOT EXISTS dropoff_zone TEXT,
        ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'NORMAL',
        ADD COLUMN IF NOT EXISTS dispatch_attempts INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS redispatch_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS excluded_rider_id TEXT,
        ADD COLUMN IF NOT EXISTS delivery_code TEXT,
        ADD COLUMN IF NOT EXISTS customer_confirmed BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    `);

    console.log("Database ready");
  } catch (err) {
    storageMode = "memory";
    console.error("DB unavailable, fallback to in-memory mode:", err.code || err.message);
  }
}

function insertMemoryOrder(order) {
  memoryOrders.set(order.id, order);
  return order;
}

function getMemoryOrder(orderId) {
  return memoryOrders.get(orderId) || null;
}

function listMemoryOrders() {
  return Array.from(memoryOrders.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function patchMemoryOrder(orderId, patch) {
  const current = getMemoryOrder(orderId);
  if (!current) return null;
  const updated = { ...current, ...patch };
  memoryOrders.set(orderId, updated);
  return updated;
}

async function fetchOrder(orderId) {
  if (storageMode === "memory") return getMemoryOrder(orderId);
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
  return result.rows[0] || null;
}

async function createOrderRecord(data) {
  if (storageMode === "memory") return insertMemoryOrder(data);
  const result = await pool.query(
    `INSERT INTO orders (id, chat_id, source, items, total, status, dropoff_zone, priority_level, dispatch_attempts, redispatch_count, assigned_at, excluded_rider_id, delivery_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.id,
      data.chat_id,
      data.source,
      JSON.stringify(data.items),
      data.total,
      data.status,
      data.dropoff_zone,
      data.priority_level,
      data.dispatch_attempts,
      data.redispatch_count,
      data.assigned_at,
      data.excluded_rider_id,
      data.delivery_code
    ]
  );
  return result.rows[0];
}

async function listOrdersRecords() {
  if (storageMode === "memory") return listMemoryOrders();
  const result = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
  return result.rows;
}

async function saveStatusTransition(orderId, nextStatus) {
  const current = await fetchOrder(orderId);
  if (!current) return null;

  const patch = { status: nextStatus };
  if (nextStatus === ORDER_STATUS.DELIVERED) patch.delivered_at = new Date().toISOString();
  if (nextStatus === ORDER_STATUS.COMPLETED) {
    patch.completed_at = new Date().toISOString();
    patch.customer_confirmed = true;
  }

  if (storageMode === "memory") return patchMemoryOrder(orderId, patch);

  const values = [nextStatus, orderId];
  let query = "UPDATE orders SET status = $1";
  if (nextStatus === ORDER_STATUS.DELIVERED) query += ", delivered_at = NOW()";
  if (nextStatus === ORDER_STATUS.COMPLETED) query += ", completed_at = NOW(), customer_confirmed = true";
  query += " WHERE id = $2 RETURNING *";
  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function saveRiderAssignment(orderId, rider) {
  if (storageMode === "memory") {
    const current = await fetchOrder(orderId);
    return patchMemoryOrder(orderId, {
      rider_id: rider.id,
      rider_name: rider.name,
      status: ORDER_STATUS.ASSIGNED,
      assigned_at: new Date().toISOString(),
      dispatch_attempts: Number(current?.dispatch_attempts || 0) + 1,
      excluded_rider_id: null
    });
  }

  const assigned = await pool.query(
    `UPDATE orders
     SET rider_id = $1,
         rider_name = $2,
         status = $3,
         assigned_at = NOW(),
         dispatch_attempts = COALESCE(dispatch_attempts, 0) + 1,
         excluded_rider_id = NULL
     WHERE id = $4
     RETURNING *`,
    [rider.id, rider.name, ORDER_STATUS.ASSIGNED, orderId]
  );
  return assigned.rows[0] || null;
}

async function savePriorityLevel(orderId, priorityLevel) {
  if (storageMode === "memory") {
    return patchMemoryOrder(orderId, { priority_level: priorityLevel });
  }
  const result = await pool.query(
    `UPDATE orders SET priority_level = $1 WHERE id = $2 RETURNING *`,
    [priorityLevel, orderId]
  );
  return result.rows[0] || null;
}

async function saveRedispatchReset(orderId) {
  const current = await fetchOrder(orderId);
  if (!current) return null;

  if (storageMode === "memory") {
    return patchMemoryOrder(orderId, {
      status: ORDER_STATUS.READY_FOR_PICKUP,
      rider_id: null,
      rider_name: null,
      assigned_at: null,
      redispatch_count: Number(current.redispatch_count || 0) + 1,
      excluded_rider_id: current.rider_id || null
    });
  }

  const result = await pool.query(
    `UPDATE orders
     SET status = $1,
         rider_id = NULL,
         rider_name = NULL,
         assigned_at = NULL,
         redispatch_count = COALESCE(redispatch_count, 0) + 1,
         excluded_rider_id = $2
     WHERE id = $3
     RETURNING *`,
    [ORDER_STATUS.READY_FOR_PICKUP, current.rider_id || null, orderId]
  );
  return result.rows[0] || null;
}

async function getActiveOrderCounts() {
  const rows = await listOrdersRecords();
  const active = new Set([
    ORDER_STATUS.ASSIGNED,
    ORDER_STATUS.PICKED_UP,
    ORDER_STATUS.ON_THE_WAY
  ]);

  const counts = {};
  for (const row of rows) {
    if (!row.rider_id || !active.has(row.status)) continue;
    counts[row.rider_id] = (counts[row.rider_id] || 0) + 1;
  }
  return counts;
}

async function syncRiderStatuses() {
  const counts = await getActiveOrderCounts();
  for (const rider of riderEngine.listRiders()) {
    const activeLoad = counts[rider.id] || 0;
    if (!riderEngine.isRiderOnShift(rider)) {
      rider.status = "OFF_SHIFT";
      continue;
    }
    if (activeLoad >= Math.max(rider.maxActiveOrders || 1, 1)) rider.status = "BUSY";
    else rider.status = "AVAILABLE";
  }
  return counts;
}

async function recommendRiderForOrder(order, opts = {}) {
  const loadByRider = await syncRiderStatuses();
  const riderStates = riderEngine.listRiders()
    .filter((rider) => !opts.excludeRiderId || rider.id !== opts.excludeRiderId)
    .map((rider) => ({
    rider,
    activeLoad: loadByRider[rider.id] || 0
  }));
  return riderEngine.pickBestRider(order, riderStates);
}

async function updateOrderStatus(orderId, nextStatus, options = {}) {
  const current = await fetchOrder(orderId);
  if (!current) {
    return { error: "Order not found", statusCode: 404 };
  }

  if (!canTransition(current.status, nextStatus)) {
    return {
      error: `Invalid transition ${current.status} -> ${nextStatus}`,
      statusCode: 400
    };
  }

  if (nextStatus === ORDER_STATUS.CANCELLED && current.rider_id) {
    const rider = riderEngine.getRiderById(current.rider_id);
    riderEngine.markAvailable(rider);
  }

  const saved = await saveStatusTransition(orderId, nextStatus);
  const order = toClientOrder(saved);
  io.emit("order_updated", order);
  const transitionLine = options.transitionLine || `Transition: ${current.status} -> ${nextStatus}`;
  await notifyOrderStatus(order, {
    extraLine: transitionLine
  });
  await syncRiderStatuses();
  return { order };
}

async function assignOrderToRider(order, requestedRiderId) {
  const loadByRider = await syncRiderStatuses();
  const requested = requestedRiderId ? riderEngine.getRiderById(requestedRiderId) : null;
  let rider = requested;
  let dispatchMeta = null;

  if (rider) {
    if (!riderEngine.isRiderOnShift(rider)) {
      return { error: "Selected rider is off shift", statusCode: 400 };
    }
    const activeLoad = loadByRider[rider.id] || 0;
    if (activeLoad >= Math.max(rider.maxActiveOrders || 1, 1)) {
      return { error: "Selected rider is at max active capacity", statusCode: 400 };
    }
    dispatchMeta = {
      mode: "manual",
      riderId: rider.id,
      riderName: rider.name,
      activeLoad,
      etaMinutes: riderEngine.estimateEtaMinutes(rider, order, activeLoad),
      distanceKm: Number(riderEngine.estimateDistanceKm(rider.baseZone, order.zone || order.dropoff_zone || "CBD").toFixed(2))
    };
  } else {
    const pick = await recommendRiderForOrder(order, { excludeRiderId: order.excluded_rider_id });
    if (!pick) return { error: "No available rider", statusCode: 400 };
    rider = pick.rider;
    dispatchMeta = {
      mode: "auto",
      riderId: pick.rider.id,
      riderName: pick.rider.name,
      etaMinutes: pick.etaMinutes,
      distanceKm: pick.distanceKm,
      score: pick.score,
      alternatives: pick.alternatives
    };
  }

  riderEngine.markBusy(rider);
  const saved = await saveRiderAssignment(order.id, rider);
  await syncRiderStatuses();
  const updatedOrder = toClientOrder(saved);
  io.emit("order_updated", updatedOrder);
  await notifyOrderStatus(updatedOrder, {
    etaMinutes: dispatchMeta.etaMinutes,
    distanceKm: dispatchMeta.distanceKm,
    extraLine: `Dispatch mode: ${dispatchMeta.mode}`
  });
  await sendTelegram(
    rider.telegramChatId,
    `New delivery assigned\nOrder ${updatedOrder.id}\nTotal KES ${updatedOrder.total}`
  );

  return { order: updatedOrder, dispatch: dispatchMeta };
}

async function buildEtaMatrix(order) {
  const loadByRider = await syncRiderStatuses();
  return riderEngine.listRiders().map((rider) => {
    const activeLoad = loadByRider[rider.id] || 0;
    const onShift = riderEngine.isRiderOnShift(rider);
    const distanceKm = riderEngine.estimateDistanceKm(rider.baseZone, order.zone || order.dropoff_zone || "CBD");
    return {
      riderId: rider.id,
      riderName: rider.name,
      status: rider.status,
      onShift,
      activeLoad,
      distanceKm: Number(distanceKm.toFixed(2)),
      etaMinutes: onShift ? riderEngine.estimateEtaMinutes(rider, order, activeLoad) : null
    };
  }).sort((a, b) => {
    const aEta = a.etaMinutes ?? 999999;
    const bEta = b.etaMinutes ?? 999999;
    return aEta - bEta;
  });
}

async function runBatchDispatch(limit = DISPATCH_BATCH_LIMIT) {
  if (batchDispatchRunning) {
    return { skipped: true, reason: "Batch dispatch already running", assigned: [] };
  }
  batchDispatchRunning = true;
  try {
    const rows = await listOrdersRecords();
    const ready = rows
      .filter((row) => row.status === ORDER_STATUS.READY_FOR_PICKUP && !row.rider_id)
      .sort((a, b) => {
        const scoreDiff = computePriorityScore(b) - computePriorityScore(a);
        if (scoreDiff !== 0) return scoreDiff;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      })
      .slice(0, limit);

    const assigned = [];
    for (const row of ready) {
      const result = await assignOrderToRider(row, null);
      if (result.error) {
        assigned.push({ orderId: row.id, ok: false, error: result.error });
        continue;
      }
      assigned.push({
        orderId: row.id,
        ok: true,
        riderId: result.dispatch.riderId,
        riderName: result.dispatch.riderName,
        etaMinutes: result.dispatch.etaMinutes,
        score: result.dispatch.score || null
      });
    }

    return { skipped: false, processed: ready.length, assigned };
  } finally {
    batchDispatchRunning = false;
  }
}

async function runRedispatchSweep() {
  const rows = await listOrdersRecords();
  const now = Date.now();
  const timedOut = rows.filter((row) => {
    if (row.status !== ORDER_STATUS.ASSIGNED) return false;
    if (!row.assigned_at) return false;
    return now - new Date(row.assigned_at).getTime() > DISPATCH_ASSIGN_TIMEOUT_MS;
  });

  const redispatched = [];
  for (const row of timedOut) {
    const previousRiderId = row.rider_id;
    if (previousRiderId) {
      const rider = riderEngine.getRiderById(previousRiderId);
      riderEngine.markAvailable(rider);
    }
    const resetRow = await saveRedispatchReset(row.id);
    if (!resetRow) continue;
    const order = toClientOrder(resetRow);
    io.emit("order_updated", order);
    await notifyOrderStatus(order, {
      extraLine: "Previous rider timeout detected. Re-dispatch in progress."
    });
    redispatched.push({
      orderId: row.id,
      previousRiderId,
      redispatchCount: order.redispatchCount
    });
  }
  return redispatched;
}

async function runAutoOrderFlow(opts = {}) {
  if (orderFlowSweepRunning && !opts.force) {
    return { skipped: true, reason: "Order flow sweep already running", moved: [] };
  }
  orderFlowSweepRunning = true;
  const startedAt = new Date().toISOString();

  try {
    const milestones = getOrderFlowMilestones();
    const rows = await listOrdersRecords();
    const candidates = rows
      .filter((row) => ![ORDER_STATUS.CANCELLED, ORDER_STATUS.COMPLETED].includes(row.status))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const moved = [];

    for (const row of candidates) {
      const ageMs = getOrderAgeMs(row);
      let targetStatus = null;

      if (row.status === ORDER_STATUS.CREATED && ageMs >= milestones[ORDER_STATUS.CREATED]) {
        targetStatus = ORDER_STATUS.CONFIRMED;
      } else if (row.status === ORDER_STATUS.CONFIRMED && ageMs >= milestones[ORDER_STATUS.CONFIRMED]) {
        targetStatus = ORDER_STATUS.PREPARING;
      } else if (row.status === ORDER_STATUS.PREPARING && ageMs >= milestones[ORDER_STATUS.PREPARING]) {
        targetStatus = ORDER_STATUS.READY_FOR_PICKUP;
      }

      if (!targetStatus) continue;

      const result = await updateOrderStatus(row.id, targetStatus, {
        transitionLine: `Auto flow transition: ${row.status} -> ${targetStatus}`
      });

      if (result.error) {
        moved.push({ orderId: row.id, ok: false, error: result.error });
      } else {
        moved.push({
          orderId: row.id,
          ok: true,
          from: row.status,
          to: targetStatus,
          ageSeconds: Math.floor(ageMs / 1000)
        });
      }
    }

    const finishedAt = new Date().toISOString();
    lastOrderFlowSweep = {
      startedAt,
      finishedAt,
      processed: candidates.length,
      moved: moved.filter((x) => x.ok).length
    };

    return {
      skipped: false,
      startedAt,
      finishedAt,
      processed: candidates.length,
      moved
    };
  } finally {
    orderFlowSweepRunning = false;
  }
}

async function buildDispatchQueue(limit = 20) {
  const rows = await listOrdersRecords();
  return rows
    .filter((row) => [ORDER_STATUS.CREATED, ORDER_STATUS.CONFIRMED, ORDER_STATUS.PREPARING, ORDER_STATUS.READY_FOR_PICKUP].includes(row.status))
    .map((row) => ({
      orderId: row.id,
      status: row.status,
      priorityLevel: row.priority_level || "NORMAL",
      priorityScore: computePriorityScore(row),
      zone: row.dropoff_zone || "CBD",
      createdAt: row.created_at,
      slaBreached: isOrderSlaBreached(row)
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

initDB();

app.get("/api/products", (req, res) => {
  reloadProductsCatalog();
  res.json(products);
});

app.get("/api/admin/photo-coverage", (req, res) => {
  try {
    reloadProductsCatalog();
    res.json(getPhotoCoveragePayload());
  } catch (err) {
    console.error("PHOTO COVERAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/upload-product-photo", (req, res) => {
  try {
    const { fileName, dataUrl } = req.body || {};
    if (!fileName || !dataUrl) {
      return res.status(400).json({ error: "fileName and dataUrl are required" });
    }

    const originalExt = path.extname(String(fileName)).toLowerCase();
    if (!ALLOWED_PHOTO_EXTENSIONS.has(originalExt)) {
      return res.status(400).json({ error: "Unsupported extension. Use jpg/jpeg/png/webp" });
    }

    const slug = toSlug(path.basename(String(fileName), originalExt));
    if (!slug) return res.status(400).json({ error: "Invalid file name slug" });
    if (!products.find((p) => p.slug === slug)) {
      return res.status(400).json({ error: `No product found for slug: ${slug}` });
    }

    const buffer = decodeBase64Image(dataUrl);
    if (!buffer) {
      return res.status(400).json({ error: "Invalid image dataUrl payload" });
    }
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: "Image too large. Max 10MB per file" });
    }

    ensurePhotoDir();

    for (const ext of ALLOWED_PHOTO_EXTENSIONS) {
      const oldPath = path.join(REAL_PHOTO_DIR, `${slug}${ext}`);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const targetName = `${slug}${originalExt}`;
    fs.writeFileSync(path.join(REAL_PHOTO_DIR, targetName), buffer);

    reloadProductsCatalog();
    const product = products.find((p) => p.slug === slug) || null;

    res.json({
      ok: true,
      slug,
      file: `/assets/products/real/${targetName}`,
      mappedProduct: product?.name || null,
      coverage: getPhotoCoveragePayload()
    });
  } catch (err) {
    console.error("UPLOAD PRODUCT PHOTO ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/riders", async (req, res) => {
  try {
    const loadByRider = await syncRiderStatuses();
    const order = req.query.orderId ? await fetchOrder(req.query.orderId) : null;
    const riders = riderEngine.listRiders().map((rider) => {
      const activeLoad = loadByRider[rider.id] || 0;
      const onShift = riderEngine.isRiderOnShift(rider);
      const etaMinutes = order ? riderEngine.estimateEtaMinutes(rider, order, activeLoad) : null;
      const distanceKm = order
        ? Number(riderEngine.estimateDistanceKm(rider.baseZone, order.zone || order.dropoff_zone || "CBD").toFixed(2))
        : null;
      return {
        ...rider,
        activeLoad,
        onShift,
        etaMinutes: onShift ? etaMinutes : null,
        distanceKm
      };
    });
    res.json(riders);
  } catch (err) {
    console.error("FETCH RIDERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dispatch/recommendation/:id", async (req, res) => {
  try {
    const order = await fetchOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const pick = await recommendRiderForOrder(order);
    if (!pick) return res.status(400).json({ error: "No available rider" });

    res.json({
      orderId: order.id,
      zone: order.dropoff_zone || "CBD",
      chosen: {
        riderId: pick.rider.id,
        riderName: pick.rider.name,
        etaMinutes: pick.etaMinutes,
        distanceKm: pick.distanceKm,
        score: pick.score
      },
      alternatives: pick.alternatives
    });
  } catch (err) {
    console.error("DISPATCH RECOMMEND ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dispatch/predict/:id", async (req, res) => {
  try {
    const order = await fetchOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const matrix = await buildEtaMatrix(order);
    res.json({
      orderId: order.id,
      zone: order.dropoff_zone || "CBD",
      matrix
    });
  } catch (err) {
    console.error("DISPATCH PREDICT ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/dispatch/run-batch", async (req, res) => {
  try {
    const limit = Number(req.body?.limit || DISPATCH_BATCH_LIMIT);
    const redispatched = await runRedispatchSweep();
    const result = await runBatchDispatch(limit);
    res.json({ ...result, redispatched });
  } catch (err) {
    console.error("BATCH DISPATCH ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/dispatch/queue", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    const queue = await buildDispatchQueue(limit);
    res.json(queue);
  } catch (err) {
    console.error("DISPATCH QUEUE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ops/automation-status", (req, res) => {
  const milestones = getOrderFlowMilestones();
  res.json({
    storageMode,
    orderFlow: {
      enabled: ORDER_FLOW_AUTO_ENABLED,
      running: orderFlowSweepRunning,
      intervalMs: ORDER_FLOW_INTERVAL_MS,
      milestonesMs: {
        createdToConfirmed: milestones[ORDER_STATUS.CREATED],
        confirmedToPreparing: milestones[ORDER_STATUS.CONFIRMED],
        preparingToReady: milestones[ORDER_STATUS.PREPARING]
      },
      lastSweep: lastOrderFlowSweep
    },
    dispatch: {
      enabled: DISPATCH_AUTO_ENABLED,
      intervalMs: DISPATCH_INTERVAL_MS,
      batchLimit: DISPATCH_BATCH_LIMIT,
      assignTimeoutMs: DISPATCH_ASSIGN_TIMEOUT_MS
    }
  });
});

app.post("/api/ops/flow-sweep", async (req, res) => {
  try {
    const result = await runAutoOrderFlow({ force: true });
    res.json(result);
  } catch (err) {
    console.error("ORDER FLOW SWEEP ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/storage-mode", (req, res) => {
  res.json({ mode: storageMode });
});

app.post("/api/orders", async (req, res) => {
  try {
    const { items, chatId, zone, priorityLevel, express, source } = req.body;
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Empty order" });
    }

    const id = `ORD-${Date.now()}`;
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const deliveryCode = randomDeliveryCode();
    const resolvedPriority = resolvePriorityLevel(priorityLevel, express);
    const row = await createOrderRecord({
      id,
      chat_id: String(chatId || "web-user"),
      source: String(source || "web"),
      items,
      total,
      status: ORDER_STATUS.CREATED,
      rider_id: null,
      rider_name: null,
      dropoff_zone: zone || "CBD",
      priority_level: resolvedPriority,
      dispatch_attempts: 0,
      redispatch_count: 0,
      assigned_at: null,
      excluded_rider_id: null,
      delivery_code: deliveryCode,
      customer_confirmed: false,
      created_at: new Date().toISOString(),
      delivered_at: null,
      completed_at: null
    });

    const order = toClientOrder(row);
    io.emit("new_order", order);
    await notifyOrderStatus(order, {
      includeCode: true,
      extraLine: "Order received successfully."
    });
    res.json(order);
  } catch (err) {
    console.error("CREATE ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const rows = await listOrdersRecords();
    const orders = rows.map(toClientOrder);
    res.json(orders);
  } catch (err) {
    console.error("FETCH ORDERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const row = await fetchOrder(req.params.id);
    if (!row) return res.status(404).json({ error: "Order not found" });
    res.json(toClientOrder(row));
  } catch (err) {
    console.error("GET ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Missing status" });

    const result = await updateOrderStatus(req.params.id, status);
    if (result.error) return res.status(result.statusCode).json({ error: result.error });
    res.json(result.order);
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/orders/:id/priority", async (req, res) => {
  try {
    const { priorityLevel } = req.body;
    const normalized = resolvePriorityLevel(priorityLevel, false);
    const row = await savePriorityLevel(req.params.id, normalized);
    if (!row) return res.status(404).json({ error: "Order not found" });
    const order = toClientOrder(row);
    io.emit("order_updated", order);
    res.json(order);
  } catch (err) {
    console.error("UPDATE PRIORITY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders/:id/assign", async (req, res) => {
  try {
    const order = await fetchOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== ORDER_STATUS.READY_FOR_PICKUP) {
      return res.status(400).json({ error: "Order is not ready for pickup" });
    }

    const result = await assignOrderToRider(order, req.body?.riderId || null);
    if (result.error) return res.status(result.statusCode).json({ error: result.error });
    res.json({ ...result.order, dispatch: result.dispatch });
  } catch (err) {
    console.error("ASSIGN RIDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/orders/:id/rider-status", async (req, res) => {
  try {
    const { status, riderId } = req.body;
    if (!status || !riderId) {
      return res.status(400).json({ error: "Missing status or riderId" });
    }

    const order = await fetchOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.rider_id !== riderId) return res.status(403).json({ error: "Rider not assigned to this order" });
    if (![ORDER_STATUS.PICKED_UP, ORDER_STATUS.ON_THE_WAY, ORDER_STATUS.DELIVERED].includes(status)) {
      return res.status(400).json({ error: "Invalid rider status" });
    }

    const result = await updateOrderStatus(req.params.id, status);
    if (result.error) return res.status(result.statusCode).json({ error: result.error });

    res.json(result.order);
  } catch (err) {
    console.error("RIDER STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders/:id/confirm-delivery", async (req, res) => {
  try {
    const { code, chatId } = req.body;
    const order = await fetchOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== ORDER_STATUS.DELIVERED) {
      return res.status(400).json({ error: "Order must be DELIVERED before confirmation" });
    }
    if (String(order.delivery_code) !== String(code)) {
      return res.status(400).json({ error: "Invalid delivery code" });
    }
    if (chatId && String(order.chat_id) !== String(chatId)) {
      return res.status(403).json({ error: "This order belongs to another customer" });
    }

    const result = await updateOrderStatus(req.params.id, ORDER_STATUS.COMPLETED);
    if (result.error) return res.status(result.statusCode).json({ error: result.error });

    if (order.rider_id) {
      const rider = riderEngine.getRiderById(order.rider_id);
      riderEngine.markAvailable(rider);
    }

    res.json(result.order);
  } catch (err) {
    console.error("CONFIRM DELIVERY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
  if (ORDER_FLOW_AUTO_ENABLED) {
    setInterval(async () => {
      try {
        const result = await runAutoOrderFlow();
        const movedCount = (result.moved || []).filter((x) => x.ok).length;
        if (!result.skipped && movedCount) {
          console.log(`Order flow automation moved ${movedCount} order(s)`);
        }
      } catch (error) {
        console.error("AUTO ORDER FLOW ERROR:", error.message);
      }
    }, ORDER_FLOW_INTERVAL_MS);
    console.log(`Order flow automation enabled every ${ORDER_FLOW_INTERVAL_MS}ms`);
  } else {
    console.log("Order flow automation disabled");
  }

  if (DISPATCH_AUTO_ENABLED) {
    setInterval(async () => {
      try {
        const redispatched = await runRedispatchSweep();
        if (redispatched.length) {
          console.log(`Redispatch sweep reset ${redispatched.length} timed-out assignment(s)`);
        }
        const result = await runBatchDispatch(DISPATCH_BATCH_LIMIT);
        if (!result.skipped && result.assigned.length) {
          console.log(`Batch dispatch assigned ${result.assigned.length} order(s)`);
        }
      } catch (error) {
        console.error("AUTO BATCH DISPATCH ERROR:", error.message);
      }
    }, DISPATCH_INTERVAL_MS);
    console.log(`Batch dispatch + redispatch enabled every ${DISPATCH_INTERVAL_MS}ms`);
  } else {
    console.log("Batch dispatch disabled");
  }
});
