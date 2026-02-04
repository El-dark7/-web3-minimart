require("dotenv").config();
const express = require("express");

const telegramRouter = require("./telegram/router");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

/* =========================
   TELEGRAM WEBHOOK
========================= */
app.post("/webhook/telegram", async (req, res) => {
  try {
    await telegramRouter(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram router error:", err.message);
    res.sendStatus(500);
  }
});

/* =========================
   HEALTH
========================= */
app.get("/", (_, res) => {
  res.send("🫐 Blueberries server running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
