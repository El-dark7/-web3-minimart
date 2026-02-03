
const axios = require("axios");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;

module.exports = async (update) => {
  if (!TOKEN) return console.error("BOT TOKEN MISSING");

  if (update.message && update.message.text?.startsWith("/start")) {
    const chatId = update.message.chat.id;
    await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text: "🫐 Blueberries Mini App is LIVE",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍔 Food", callback_data: "FOOD" }],
          [{ text: "🛒 Groceries", callback_data: "GROCERY" }],
          [{ text: "🏡 Airbnb", callback_data: "AIRBNB" }],
          [{ text: "🛠 Errands", callback_data: "ERRANDS" }]
        ]
      }
    });
  }

  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text: `Selected: ${update.callback_query.data}`
    });
  }
};
