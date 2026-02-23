const carts = {};
const orders = {};
const products = require("../data/products");

function getAllProducts() {
  return products;
}

function getProductsByCategory(category) {
  return products.filter((p) => p.category === category);
}

function addToCart(chatId, productId) {
  if (!carts[chatId]) carts[chatId] = { itemsById: {}, total: 0 };

  const product = products.find((p) => p.id === productId);
  if (!product) throw new Error("Invalid product");

  if (!carts[chatId].itemsById[productId]) {
    carts[chatId].itemsById[productId] = { ...product, qty: 1 };
  } else {
    carts[chatId].itemsById[productId].qty += 1;
  }

  carts[chatId].total += product.price;
}

function getCart(chatId) {
  const cart = carts[chatId];
  if (!cart) return { items: [], total: 0 };

  return {
    items: Object.values(cart.itemsById),
    total: cart.total
  };
}

function clearCart(chatId) {
  delete carts[chatId];
}

function createOrderFromCart(chatId) {
  const cart = getCart(chatId);
  if (!cart.items.length) throw new Error("Empty cart");

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

  clearCart(chatId);
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
  clearCart,
  createOrderFromCart,
  getOrder,
  updateOrderStatus
};
