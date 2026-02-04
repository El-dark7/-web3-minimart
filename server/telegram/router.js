const axios = require("axios");
const orderEngine = require("../services/order.engine");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId, text, keyboard = null) {
  const payload = {
    chat_id: chatId,
    text
  };

  if (keyboard) {
    payload.reply_markup = {
      inline_keyboard: keyboard
    };
  }

  await axios.post(`${API}/sendMessage`, payload);
}

module.exports = async function telegramRouter(update) {
  const message = update.message;
  const callback = update.callback_query;

  /* =========================
     /START COMMAND
  ========================= */
  if (message && message.text === "/start") {
    const chatId = message.chat.id;

    await sendMessage(
      chatId,
      "🫐 *Welcome to Blueberries Mini App*\n\nWhat do you want today?",
      [
        [{ text: "🍔 Food", callback_data: "CAT_FOOD" }],
        [{ text: "🛒 Groceries", callback_data: "CAT_GROCERIES" }],
        [{ text: "🏡 Airbnb", callback_data: "CAT_AIRBNB" }],
        [{ text: "🛠 Errands", callback_data: "CAT_ERRANDS" }]
      ]
    );

    return;
  }

  /* =========================
     INLINE BUTTON HANDLER
  ========================= */
  if (callback) {
    const chatId = callback.message.chat.id;
    const data = callback.data;

    // Always acknowledge callback (Telegram requirement)
    await axios.post(`${API}/answerCallbackQuery`, {
      callback_query_id: callback.id
    });

    /* =========================
       CATEGORY SELECTION
    ========================= */
    if (data.startsWith("CAT_")) {
      const category = data.replace("CAT_", "").toLowerCase();

      const products = orderEngine.getProductsByCategory(category);

      if (!products.length) {
        await sendMessage(chatId, "❌ No items available.");
        return;
      }

      const keyboard = products.map(p => [
        {
          text: `${p.name} – KES ${p.price}`,
          callback_data: `ADD_${p.id}`
        }
      ]);

      keyboard.push([{ text: "⬅️ Back", callback_data: "BACK_HOME" }]);

      await sendMessage(
        chatId,
        `📦 *${category.toUpperCase()} MENU*`,
        keyboard
      );

      return;
    }

    /* =========================
       ADD PRODUCT TO CART
    ========================= */
    if (data.startsWith("ADD_")) {
      const productId = parseInt(data.replace("ADD_", ""));

      orderEngine.addToCart(chatId, productId);

      await sendMessage(
        chatId,
        "✅ Item added to cart",
        [
          [{ text: "🧾 View Cart", callback_data: "VIEW_CART" }],
          [{ text: "➕ Add More", callback_data: "BACK_HOME" }]
        ]
      );

      return;
    }

    /* =========================
       VIEW CART
    ========================= */
    if (data === "VIEW_CART") {
      const cart = orderEngine.getCart(chatId);

      if (!cart.items.length) {
        await sendMessage(chatId, "🛒 Your cart is empty.");
        return;
      }

      let text = "🧾 *Your Cart*\n\n";
      cart.items.forEach(i => {
        text += `• ${i.name} – KES ${i.price}\n`;
      });
      text += `\nTotal: KES ${cart.total}`;

      await sendMessage(
        chatId,
        text,
        [
          [{ text: "💳 Checkout", callback_data: "CHECKOUT" }],
          [{ text: "⬅️ Back", callback_data: "BACK_HOME" }]
        ]
      );

      return;
    }

    /* =========================
       CHECKOUT
    ========================= */
    if (data === "CHECKOUT") {
      const order = orderEngine.createOrderFromCart(chatId);

      await sendMessage(
        chatId,
        `✅ Order *${order.id}* created\n\nAmount: KES ${order.total}\n\nProceed to payment.`
      );

      return;
    }

    /* =========================
       BACK TO HOME
    ========================= */
    if (data === "BACK_HOME") {
      await sendMessage(
        chatId,
        "🏠 Main Menu",
        [
          [{ text: "🍔 Food", callback_data: "CAT_FOOD" }],
          [{ text: "🛒 Groceries", callback_data: "CAT_GROCERIES" }],
          [{ text: "🏡 Airbnb", callback_data: "CAT_AIRBNB" }],
          [{ text: "🛠 Errands", callback_data: "CAT_ERRANDS" }]
        ]
      );

      return;
    }
  }
};
