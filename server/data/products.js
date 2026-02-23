const fs = require("fs");
const path = require("path");

const CATEGORY_IMAGE = {
  food: "/assets/products/food.svg",
  groceries: "/assets/products/groceries.svg",
  airbnb: "/assets/products/airbnb.svg",
  errands: "/assets/products/errands.svg"
};

const REAL_PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const REAL_PHOTO_DIR = path.resolve(__dirname, "../../public/assets/products/real");

const rawProducts = [
  // FOOD
  ["Smoky Beef Burger", 890, "food"],
  ["Chicken Shawarma Wrap", 760, "food"],
  ["BBQ Chicken Pizza", 1380, "food"],
  ["Pepper Steak Sandwich", 980, "food"],
  ["Loaded Fries", 640, "food"],
  ["Nyali Fish Fillet", 1450, "food"],
  ["Beef Biryani Bowl", 1190, "food"],
  ["Chicken Tikka Bowl", 1140, "food"],
  ["Paneer Masala Plate", 1020, "food"],
  ["Veggie Pasta", 920, "food"],
  ["Seafood Pasta", 1560, "food"],
  ["Mushroom Soup", 580, "food"],
  ["Chicken Noodle Soup", 620, "food"],
  ["Classic Caesar Salad", 770, "food"],
  ["Avocado Chicken Salad", 910, "food"],
  ["Pilau + Kebab Combo", 990, "food"],
  ["Crispy Wings Bucket", 1290, "food"],
  ["Mexican Tacos Trio", 840, "food"],
  ["Double Burger Combo", 1310, "food"],
  ["Fresh Juice Pack", 540, "food"],

  // GROCERIES
  ["Rice 5kg", 980, "groceries"],
  ["Rice 10kg", 1890, "groceries"],
  ["Maize Flour 2kg", 220, "groceries"],
  ["Wheat Flour 2kg", 255, "groceries"],
  ["Cooking Oil 1L", 340, "groceries"],
  ["Cooking Oil 3L", 980, "groceries"],
  ["Milk 500ml", 75, "groceries"],
  ["Milk 1L", 140, "groceries"],
  ["Eggs Tray", 490, "groceries"],
  ["Brown Bread", 95, "groceries"],
  ["White Bread", 90, "groceries"],
  ["Sugar 2kg", 380, "groceries"],
  ["Tea Leaves 500g", 320, "groceries"],
  ["Detergent 1kg", 430, "groceries"],
  ["Toilet Paper 10 Pack", 460, "groceries"],
  ["Tomato Ketchup 700g", 260, "groceries"],
  ["Peanut Butter 500g", 410, "groceries"],
  ["Mineral Water 6 Pack", 360, "groceries"],
  ["Chicken Sausages 500g", 420, "groceries"],
  ["Frozen Chips 1kg", 390, "groceries"],

  // AIRBNB
  ["Studio Night - CBD", 4200, "airbnb"],
  ["Studio Night - Nyali", 5200, "airbnb"],
  ["1BR Apartment Night", 6800, "airbnb"],
  ["2BR Apartment Night", 9800, "airbnb"],
  ["Beach View Suite", 12400, "airbnb"],
  ["Family Villa Night", 18800, "airbnb"],
  ["Luxury Penthouse Night", 25600, "airbnb"],
  ["Weekend Getaway Package", 22600, "airbnb"],
  ["Business Stay Package", 17100, "airbnb"],
  ["Poolside Apartment Night", 10900, "airbnb"],
  ["Oceanfront Condo Night", 14700, "airbnb"],
  ["Budget Room Night", 3100, "airbnb"],
  ["Airport Transit Stay", 4500, "airbnb"],
  ["Monthly Studio Package", 96000, "airbnb"],
  ["Monthly 1BR Package", 132000, "airbnb"],
  ["Monthly 2BR Package", 184000, "airbnb"],
  ["Honeymoon Suite Night", 21200, "airbnb"],
  ["Pet-Friendly Apartment", 8900, "airbnb"],
  ["Serviced Loft Night", 11900, "airbnb"],
  ["Executive Residence Night", 23800, "airbnb"],

  // ERRANDS
  ["Courier Delivery - Small", 650, "errands"],
  ["Courier Delivery - Medium", 920, "errands"],
  ["Courier Delivery - Large", 1290, "errands"],
  ["Document Pickup", 580, "errands"],
  ["Parcel Pickup", 760, "errands"],
  ["Pharmacy Run", 670, "errands"],
  ["Grocery Restock Run", 880, "errands"],
  ["Bank Queue Service", 990, "errands"],
  ["Office Dropoff", 710, "errands"],
  ["School Pickup Service", 1120, "errands"],
  ["Custom Shopping Task", 1240, "errands"],
  ["Laundry Pickup + Drop", 870, "errands"],
  ["Gift Purchase + Delivery", 980, "errands"],
  ["Hardware Store Run", 1020, "errands"],
  ["Same-Day Dispatch", 1380, "errands"],
  ["Express Bike Dispatch", 1580, "errands"],
  ["Night Dispatch Service", 1760, "errands"],
  ["Queue + Bill Payment", 930, "errands"],
  ["Mobile Phone Topup Run", 620, "errands"],
  ["Personal Assistant Hour", 1450, "errands"]
];

function toSlug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveLocalPhoto(slug) {
  for (const ext of REAL_PHOTO_EXTENSIONS) {
    const absolute = path.join(REAL_PHOTO_DIR, `${slug}${ext}`);
    if (fs.existsSync(absolute)) {
      return `/assets/products/real/${slug}${ext}`;
    }
  }
  return null;
}

function buildDescription(name, category, idx) {
  const foodLines = [
    `${name} is chef-prepared with fresh ingredients, balanced seasoning, and hygienic packaging for fast doorstep delivery.`,
    `${name} is made to order with quality produce, rich flavor layering, and consistent portions for everyday value.`,
    `${name} combines premium ingredients, clean preparation standards, and satisfying taste that travels well.`
  ];

  const groceryLines = [
    `${name} is sourced from trusted suppliers, packed for freshness, and priced competitively for weekly restocking.`,
    `${name} offers reliable quality for home and business use, with clean packaging and dependable stock turnover.`,
    `${name} is a high-demand household essential with stable value pricing and quick same-day fulfillment.`
  ];

  const airbnbLines = [
    `${name} includes professional housekeeping, secure check-in support, and reliable amenities for business or leisure stays.`,
    `${name} is curated for comfort with clean linen, strong Wi-Fi, and responsive host assistance throughout your booking.`,
    `${name} delivers a premium stay experience with convenient location access, privacy, and flexible reservation support.`
  ];

  const errandsLines = [
    `${name} is handled by verified dispatch riders with real-time progress updates and accountable service execution.`,
    `${name} provides dependable same-day task completion with clear communication, safe handling, and efficient routing.`,
    `${name} is optimized for speed and reliability, with professional handoff standards from pickup to final delivery.`
  ];

  const lineIndex = idx % 3;
  if (category === "food") return foodLines[lineIndex];
  if (category === "groceries") return groceryLines[lineIndex];
  if (category === "airbnb") return airbnbLines[lineIndex];
  return errandsLines[lineIndex];
}

const products = rawProducts.map((p, idx) => {
  const slug = toSlug(p[0]);
  const localPhoto = resolveLocalPhoto(slug);
  const rating = Number((4.1 + ((idx % 9) * 0.1)).toFixed(1));
  const reviews = 24 + idx * 7;
  const etaMinutes = p[2] === "airbnb" ? null : 25 + (idx % 5) * 5;

  return {
    id: idx + 1,
    sku: `SKU-${String(idx + 1).padStart(4, "0")}`,
    slug,
    name: p[0],
    price: p[1],
    category: p[2],
    description: buildDescription(p[0], p[2], idx),
    rating,
    reviews,
    etaMinutes,
    image: localPhoto || CATEGORY_IMAGE[p[2]],
    hasRealPhoto: Boolean(localPhoto)
  };
});

module.exports = products;
