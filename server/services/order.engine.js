const carts = {};
const orders = {};

const products = [
  { id: 1, name: "Burger Combo", price: 850, category: "food" },
  { id: 2, name: "Pizza", price: 1200, category: "food" },
  { id: 3, name: "Rice 5kg", price: 950, category: "groceries" },
  { id: 4, name: "Luxury Villa Night", price: 18000, category: "airbnb" },
  { id: 5, name: "Courier Delivery", price: 800, category: "errands" }
];

exports.getProductsByCategory = category =>
  products.filter(p => p.category === category);

exports.addToCart = (chatId, productId) => {
  if (!carts[chatId]) carts[chatId] = { items: [], total: 0 };
  const product = products.find(p => p.id === productId);
  carts[chatId].items.push(product);
  carts[chatId].total += product.price;
};

exports.getCart = chatId =>
  carts[chatId] || { items: [], total: 0 };

exports.createOrderFromCart = chatId => {
  const cart = carts[chatId];
  if (!cart || !cart.items.length) throw new Error("Empty cart");

  const id = "ORD-" + Date.now();
  orders[id] = { id, ...cart, status: "PLACED" };
  delete carts[chatId];
  return orders[id];
};
