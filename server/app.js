require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.json());

// Serve admin panel AFTER app is defined
app.use("/admin", express.static("admin"));

// In-memory storage (temporary until we add PostgreSQL)
const orders = {};

/* =========================
   PRODUCTS API
========================= */

app.get("/api/products", (req, res) => {
  res.json([
    { id: 1, name: "Burger Combo", price: 850, category: "food" },
    { id: 2, name: "Pizza", price: 1200, category: "food" },
    { id: 3, name: "Rice 5kg", price: 950, category: "groceries" },
    { id: 4, name: "Luxury Villa Night", price: 18000, category: "airbnb" },
    { id: 5, name: "Courier Delivery", price: 800, category: "errands" }
  ]);
});

/* =========================
   CREATE ORDER
========================= */

app.post("/api/orders", (req, res) => {
  try {
    const { items, chatId } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "Empty order" });
    }

    const id = "ORD-" + Date.now();
    const total = items.reduce((s, i) => s + i.price, 0);

    const order = {
      id,
      chatId,
      items,
      total,
      status: "CREATED",
      createdAt: new Date()
    };

    orders[id] = order;

    io.emit("new_order", order);

    res.json(order);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   UPDATE STATUS
========================= */

app.patch("/api/orders/:id/status", (req, res) => {
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({ error: "Not found" });

  order.status = req.body.status;

  io.emit("order_updated", order);

  res.json(order);
});

/* =========================
   GET ALL ORDERS
========================= */

app.get("/api/orders", (req, res) => {
  res.json(Object.values(orders));
});

/* =========================
   SOCKET CONNECTION
========================= */

io.on("connection", (socket) => {
  console.log("Admin connected:", socket.id);
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
