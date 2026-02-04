const axios = require("axios");
const orderEngine = require("../services/order.engine");

const API = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

module.exports = async function telegramRouter(update) {
  if (!update.message && !update.callback_query) return;

  // /start
  if (update.message?.text === "/start") {
    const chatId = update.message.chat.id;

    await axios.post(`${API}/sendMessage`, {
      chat_id: chatId,
      text: "🫐 Welcome to Blueberries Mini App\nChoose a category:",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍔 Food", callback_data: "CAT_food" }],
          [{ text: "🛒 Groceries", callback_data: "CAT_groceries" }],
          [{ text: "🏡 Airbnb", callback_data: "CAT_airbnb" }],
          [{ text: "🛠 Errands", callback_data: "CAT_errands" }]
        ]
      }
    });
  }

  // Category click
  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const data = update.callback_query.data;

    if (data.startsWith("CAT_")) {
      const category = data.split("_")[1];

      await axios.post(`${API}/sendMessage`, {
        chat_id: chatId,
        text: `📦 ${category.toUpperCase()} selected.\nOrder created.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Pay Now", callback_data: `PAY_${category}` }]
          ]
        }
      });
    }
  }
};
