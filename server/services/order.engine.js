const carts = {};
const orders = {};

const products = [
  // FOOD
  { id: 1, name: "Burger Combo", price: 850, category: "food" },
  { id: 2, name: "Pepperoni Pizza", price: 1200, category: "food" },
  { id: 3, name: "Chicken Wings", price: 950, category: "food" },
  { id: 4, name: "Beef Tacos", price: 780, category: "food" },
  { id: 5, name: "Pasta Alfredo", price: 1100, category: "food" },

  // GROCERIES
  { id: 6, name: "Rice 5kg", price: 950, category: "groceries" },
  { id: 7, name: "Maize Flour 2kg", price: 210, category: "groceries" },
  { id: 8, name: "Cooking Oil 1L", price: 320, category: "groceries" },
  { id: 9, name: "Milk 500ml", price: 65, category: "groceries" },
  { id: 10, name: "Eggs Tray", price: 450, category: "groceries" },

  // AIRBNB
  { id: 11, name: "Luxury Villa Night", price: 15000, category: "airbnb" },
  { id: 12, name: "City Apartment Night", price: 8500, category: "airbnb" },
  { id: 13, name: "BEACH STUDIO APARTMENTS", price: 3000, category: "airbnb" },

  // ERRANDS
  { id: 14, name: "Courier Delivery", price: 300, category: "errands" },
  { id: 15, name: "Package Pickup", price: 300, category: "errands" },
  { id: 16, name: "Personal Shopper", price: 300, category: "errands" }
];

function getAllProducts() {
  return products;
}

function getProductsByCategory(category) {
  return products.filter(p => p.category === category);
}

function addToCart(chatId, productId) {
  if (!carts[chatId]) carts[chatId] = { items: [], total: 0 };

  const product = products.find(p => p.id === productId);
  if (!product) throw new Error("Invalid product");

  carts[chatId].items.push(product);
  carts[chatId].total += product.price;
}

function getCart(chatId) {
  return carts[chatId] || { items: [], total: 0 };
}

function createOrderFromCart(chatId) {
  const cart = carts[chatId];
  if (!cart || !cart.items.length) throw new Error("Empty cart");

  const id = "ORD-" + Date.now();

  orders[id] = {
    id,
    chatId,
    items: cart.items,
    total: cart.total,
    status: "CREATED",
    rider: null,
    createdAt: new Date()
  };

  delete carts[chatId];
  return orders[id];
}

function getOrder(orderId) {
  return orders[orderId];
}

function updateOrderStatus(orderId, status) {
  if (!orders[orderId]) throw new Error("Order not found");
  orders[orderId].status = status;
  return orders[orderId];
}

module.exports = {
  getAllProducts,
  getProductsByCategory,
  addToCart,
  getCart,
  createOrderFromCart,
  getOrder,
  updateOrderStatus
};
