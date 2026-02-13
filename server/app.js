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
app.post("/api/orders", (req, res) => {
  try {
    const { items, chatId } = req.body;

    const id = "ORD-" + Date.now();

    const total = items.reduce((s, i) => s + i.price, 0);

    res.json({
      id,
      chatId,
      total,
      status: "CREATED"
    });

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* =========================
   ROOT
========================= */
app.get("/", (_, res) => {
  res.send("Blueberries Platform Running");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
