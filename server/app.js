app.use("/admin", express.static("admin"));
const express = require("express");
const dotenv = require("dotenv");
const orderEngine = require("./services/order.engine");

dotenv.config();
const app = express();
app.use(express.json());

/* =========================
   PRODUCTS API
========================= */
app.get("/api/products", (req, res) => {
  res.json(orderEngine.getAllProducts());
});

/* =========================
   CREATE ORDER (WEB)
========================= */
const orders = {};

app.post("/api/orders", (req, res) => {
  try {
    const { items, chatId } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: "Empty order" });
    }

    const id = "ORD-" + Date.now();
    const total = items.reduce((s, i) => s + i.price, 0);

    orders[id] = {
      id,
      chatId,
      items,
      total,
      status: "CREATED",
      rider: null,
      createdAt: new Date()
    };

    res.json(orders[id]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* =========================
   ROOT
========================= */
app.get("/api/orders", (req, res) => {
  res.json(Object.values(orders));
});

app.patch("/api/orders/:id/status", (req, res) => {
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({ error: "Not found" });

  order.status = req.body.status;
  res.json(order);
});

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("Admin connected:", socket.id);
});

/* =========================
   MODIFY ORDER CREATE
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
      rider: null,
      createdAt: new Date()
    };

    orders[id] = order;

    // 🔥 BROADCAST NEW ORDER
    io.emit("new_order", order);

    res.json(order);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   STATUS UPDATE
========================= */

app.patch("/api/orders/:id/status", (req, res) => {
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({ error: "Not found" });

  order.status = req.body.status;

  // 🔥 BROADCAST STATUS UPDATE
  io.emit("order_updated", order);

  res.json(order);
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});

