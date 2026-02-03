
require("dotenv").config();
const express = require("express");
const telegramRouter = require("./telegram/router");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static("web"));

app.post("/webhook/telegram", async (req, res) => {
  console.log("📩 Telegram update received");
  await telegramRouter(req.body);
  res.sendStatus(200);
});

app.get("/health", (req, res) => {
  res.json({ status: "OK" });
});

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
