require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

/* =========================
   APP + SERVER SETUP
========================= */

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());
app.use("/admin", express.static("admin"));

/* =========================
   DATABASE SETUP
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      items JSONB,
      total INTEGER,
      status TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  console.log("✅ Database ready");
}

initDB().catch(err => {
  console.error("DB INIT ERROR:", err);
});

/* =========================
   STATIC PRODUCTS
========================= */

const products = [
  { id: 1, name: "Burger Combo", price: 850, category: "food" },
  { id: 2, name: "Pepperoni Pizza", price: 1200, category: "food" },
  { id: 3, name: "Chicken Wings", price: 950, category: "food" },
  { id: 4, name: "Beef Tacos", price: 780, category: "food" },
  { id: 5, name: "Pasta Alfredo", price: 1100, category: "food" },

  { id: 6, name: "Rice 5kg", price: 950, category: "groceries" },
  { id: 7, name: "Maize Flour 2kg", price: 210, category: "groceries" },
  { id: 8, name: "Cooking Oil 1L", price: 320, category: "groceries" },
  { id: 9, name: "Milk 500ml", price: 65, category: "groceries" },
  { id: 10, name: "Eggs Tray", price: 450, category: "groceries" },

  { id: 11, name: "Luxury Villa Night", price: 18000, category: "airbnb" },
  { id: 12, name: "City Apartment Night", price: 8500, category: "airbnb" },
  { id: 13, name: "Beach House Night", price: 22000, category: "airbnb" },

  { id: 14, name: "Courier Delivery", price: 800, category: "errands" },
  { id: 15, name: "Package Pickup", price: 600, category: "errands" },
  { id: 16, name: "Personal Shopper", price: 1200, category: "errands" }
];

/* =========================
   PRODUCTS API
========================= */

app.get("/api/products", (req, res) => {
  res.json(products);
});

/* =========================
   CREATE ORDER (DB)
========================= */

app.post("/api/orders", async (req, res) => {
  try {
    const { items, chatId } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "Empty order" });
    }

    const id = "ORD-" + Date.now();
    const total = items.reduce((sum, item) => sum + item.price, 0);

    await pool.query(
      `INSERT INTO orders (id, chat_id, items, total, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, chatId, JSON.stringify(items), total, "CREATED"]
    );

    const order = {
      id,
      chatId,
      items,
      total,
      status: "CREATED"
    };

    io.emit("new_order", order);

    res.json(order);

  } catch (err) {
    console.error("CREATE ORDER ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   GET ALL ORDERS
========================= */

app.get("/api/orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC"
    );

    res.json(result.rows);

  } catch (err) {
    console.error("FETCH ORDERS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   UPDATE ORDER STATUS
========================= */

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    io.emit("order_updated", result.rows[0]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  console.log("Admin connected:", socket.id);
});

/* =========================
   ROOT
========================= */

app.get("/", (_, res) => {
  res.send("🫐 Blueberries Platform Running");
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
