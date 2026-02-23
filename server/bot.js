require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");

const orderEngine = require("./services/order.engine");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("BOT TOKEN MISSING");
const APP_API_BASE = process.env.APP_API_BASE || `http://127.0.0.1:${process.env.PORT || 10000}`;
const TELEGRAM_DEFAULT_ZONE = process.env.TELEGRAM_DEFAULT_ZONE || "CBD";

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Main bot polling started");

async function fetchMyOrders(chatId) {
  const response = await axios.get(`${APP_API_BASE}/api/orders`);
  const orders = Array.isArray(response.data) ? response.data : [];
  return orders
    .filter((o) => String(o.chatId) === String(chatId) && String(o.source || "").toLowerCase() === "telegram")
    .slice(0, 8);
}

async function sendMyOrders(chatId) {
  try {
    const orders = await fetchMyOrders(chatId);
    if (!orders.length) {
      await bot.sendMessage(chatId, "You have no orders yet. Place one from the menu.");
      return;
    }

    const lines = orders.map((o) =>
      `• ${o.id} | ${o.status} | KES ${o.total} | Zone ${o.zone || "CBD"}`
    );
    await bot.sendMessage(chatId, `📦 Your recent orders\n\n${lines.join("\n")}`);
  } catch (error) {
    const reason = error.response?.data?.error || error.message;
    await bot.sendMessage(chatId, `❌ Could not fetch orders: ${reason}`);
  }
}

/* =========================
   /START
========================= */
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🫐 Welcome to Blueberries Mini App\n\nChoose a category:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍔 Food", callback_data: "CAT_food" }],
          [{ text: "🛒 Groceries", callback_data: "CAT_groceries" }],
          [{ text: "🏡 Airbnb", callback_data: "CAT_airbnb" }],
          [{ text: "🛠 Errands", callback_data: "CAT_errands" }],
          [{ text: "📦 My Orders", callback_data: "MY_ORDERS" }]
        ]
      }
    }
  );
});

bot.onText(/\/orders/, async (msg) => {
  await sendMyOrders(msg.chat.id);
});

bot.onText(/\/track\s+(.+)/i, async (msg, match) => {
  const orderId = String(match[1] || "").trim();
  if (!orderId) {
    await bot.sendMessage(msg.chat.id, "Usage: /track ORD-123456789");
    return;
  }
  try {
    const response = await axios.get(`${APP_API_BASE}/api/orders/${encodeURIComponent(orderId)}`);
    const order = response.data;
    if (String(order.chatId) !== String(msg.chat.id) || String(order.source || "").toLowerCase() !== "telegram") {
      await bot.sendMessage(msg.chat.id, "Order not found for your account.");
      return;
    }
    await bot.sendMessage(
      msg.chat.id,
      `📍 ${order.id}\nStatus: ${order.status}\nTotal: KES ${order.total}\nZone: ${order.zone || "CBD"}\nDelivery code: ${order.deliveryCode}`
    );
  } catch (error) {
    const reason = error.response?.data?.error || error.message;
    await bot.sendMessage(msg.chat.id, `❌ Track failed: ${reason}`);
  }
});

/* =========================
   CALLBACK HANDLER
========================= */
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  /* CATEGORY */
  if (data.startsWith("CAT_")) {
    const category = data.replace("CAT_", "");
    const products = orderEngine.getProductsByCategory(category);

    const keyboard = products.map(p => [
      { text: `${p.name} – KES ${p.price}`, callback_data: `ADD_${p.id}` }
    ]);

    keyboard.push([{ text: "⬅ Back", callback_data: "HOME" }]);

    bot.sendMessage(chatId, "📦 Select item:", {
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  /* ADD TO CART */
  if (data.startsWith("ADD_")) {
    const productId = Number(data.replace("ADD_", ""));
    orderEngine.addToCart(chatId, productId);

    bot.sendMessage(chatId, "✅ Added to cart", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧾 View Cart", callback_data: "CART" }],
          [{ text: "➕ Continue", callback_data: "HOME" }]
        ]
      }
    });
  }

  /* CART */
  if (data === "CART") {
    const cart = orderEngine.getCart(chatId);

    let text = "🧾 Your Cart\n\n";
    cart.items.forEach((i) => {
      text += `• ${i.name} x${i.qty} – KES ${i.price * i.qty}\n`;
    });
    text += `\nTotal: KES ${cart.total}`;

    bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Checkout", callback_data: "CHECKOUT" }]
        ]
      }
    });
  }

  /* CHECKOUT */
  if (data === "CHECKOUT") {
    try {
      const cart = orderEngine.getCart(chatId);
      if (!cart.items.length) {
        bot.sendMessage(chatId, "Cart is empty. Add items before checkout.");
        return;
      }

      const response = await axios.post(`${APP_API_BASE}/api/orders`, {
        items: cart.items.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          image: item.image,
          qty: item.qty
        })),
        chatId: String(chatId),
        zone: TELEGRAM_DEFAULT_ZONE,
        source: "telegram"
      });

      orderEngine.clearCart(chatId);
      const order = response.data;
      bot.sendMessage(
        chatId,
        `✅ Order ${order.id} placed\nTotal: KES ${order.total}\nZone: ${order.zone}\nDelivery code: ${order.deliveryCode}\n\nYou can now track updates. Admin will dispatch a rider.`
      );
    } catch (error) {
      const reason = error.response?.data?.error || error.message;
      bot.sendMessage(chatId, `❌ Checkout failed: ${reason}`);
    }
  }

  /* HOME */
  if (data === "HOME") {
    bot.sendMessage(chatId, "🏠 Main Menu", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🍔 Food", callback_data: "CAT_food" }],
          [{ text: "🛒 Groceries", callback_data: "CAT_groceries" }],
          [{ text: "🏡 Airbnb", callback_data: "CAT_airbnb" }],
          [{ text: "🛠 Errands", callback_data: "CAT_errands" }],
          [{ text: "📦 My Orders", callback_data: "MY_ORDERS" }]
        ]
      }
    });
  }

  if (data === "MY_ORDERS") {
    await sendMyOrders(chatId);
  }
});
