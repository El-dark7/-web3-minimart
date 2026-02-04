require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const orderEngine = require("./services/order.engine");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("BOT TOKEN MISSING");

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 Main bot polling started");

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
          [{ text: "🛠 Errands", callback_data: "CAT_errands" }]
        ]
      }
    }
  );
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
    cart.items.forEach(i => text += `• ${i.name} – KES ${i.price}\n`);
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
    const order = orderEngine.createOrderFromCart(chatId);
    bot.sendMessage(chatId, `✅ Order ${order.id} placed\nTotal: KES ${order.total}`);
  }

  /* HOME */
  if (data === "HOME") {
    bot.sendMessage(chatId, "🏠 Main Menu", {
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
});
