const riders = [
  {
    id: "r1",
    name: "Rider Alpha",
    status: "AVAILABLE",
    telegramChatId: process.env.RIDER_ALPHA_CHAT_ID || process.env.RIDER_CHAT_ID || null,
    baseZone: process.env.RIDER_ALPHA_ZONE || "CBD",
    shiftStartHour: Number(process.env.RIDER_ALPHA_SHIFT_START_HOUR || 6),
    shiftEndHour: Number(process.env.RIDER_ALPHA_SHIFT_END_HOUR || 22),
    speedKph: 32,
    maxActiveOrders: 2,
    acceptanceRate: 0.96
  },
  {
    id: "r2",
    name: "Rider Bravo",
    status: "AVAILABLE",
    telegramChatId: process.env.RIDER_BRAVO_CHAT_ID || null,
    baseZone: process.env.RIDER_BRAVO_ZONE || "NYALI",
    shiftStartHour: Number(process.env.RIDER_BRAVO_SHIFT_START_HOUR || 6),
    shiftEndHour: Number(process.env.RIDER_BRAVO_SHIFT_END_HOUR || 22),
    speedKph: 28,
    maxActiveOrders: 2,
    acceptanceRate: 0.92
  }
];

const ZONE_COORDS = {
  CBD: { lat: -4.0435, lng: 39.6682 },
  NYALI: { lat: -4.0336, lng: 39.7192 },
  BAMBURI: { lat: -3.9808, lng: 39.7268 },
  KISAUNI: { lat: -4.0137, lng: 39.6527 }
};

function listRiders() {
  return riders;
}

function getRiderById(riderId) {
  return riders.find((r) => r.id === riderId);
}

function findAvailableRider() {
  return riders.find((r) => r.status === "AVAILABLE" && isRiderOnShift(r));
}

function normalizeZone(zone) {
  return String(zone || "CBD").toUpperCase();
}

function zoneCoords(zone) {
  return ZONE_COORDS[normalizeZone(zone)] || ZONE_COORDS.CBD;
}

function isRiderOnShift(rider, now = new Date()) {
  const hour = now.getHours();
  const start = Number(rider.shiftStartHour ?? 0);
  const end = Number(rider.shiftEndHour ?? 24);
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function haversineKm(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return 6371 * c;
}

function estimateDistanceKm(fromZone, toZone) {
  return haversineKm(zoneCoords(fromZone), zoneCoords(toZone));
}

function getCategoryMix(order) {
  const mix = {};
  for (const item of order.items || []) {
    const key = item.category || "general";
    mix[key] = (mix[key] || 0) + Number(item.qty || 1);
  }
  return mix;
}

function baseServiceMinutes(order) {
  const mix = getCategoryMix(order);
  if (mix.airbnb) return 35;
  if (mix.errands) return 18;
  if (mix.food) return 14;
  if (mix.groceries) return 16;
  return 15;
}

function estimateEtaMinutes(rider, order, activeLoad) {
  const service = baseServiceMinutes(order);
  const distanceKm = estimateDistanceKm(rider.baseZone, order.zone || "CBD");
  const travelMinutes = (distanceKm / Math.max(rider.speedKph || 25, 8)) * 60;
  const loadPenalty = activeLoad * 10;
  return Math.max(5, Math.round(service + travelMinutes + loadPenalty));
}

function scoreRider(rider, order, activeLoad) {
  const eta = estimateEtaMinutes(rider, order, activeLoad);
  const distanceKm = estimateDistanceKm(rider.baseZone, order.zone || "CBD");
  const utilization = activeLoad / Math.max(rider.maxActiveOrders || 1, 1);
  const reliabilityBoost = (rider.acceptanceRate || 0.8) * 12;
  const shiftBoost = isRiderOnShift(rider) ? 8 : -200;
  const score = 130 - eta - distanceKm * 2 - utilization * 25 + reliabilityBoost + shiftBoost;

  return {
    riderId: rider.id,
    riderName: rider.name,
    etaMinutes: eta,
    distanceKm: Number(distanceKm.toFixed(2)),
    activeLoad,
    score: Number(score.toFixed(2))
  };
}

function pickBestRider(order, riderStates) {
  const available = riderStates.filter((rs) => {
    const rider = rs.rider;
    if (!rider || rider.status !== "AVAILABLE") return false;
    if (!isRiderOnShift(rider)) return false;
    return rs.activeLoad < Math.max(rider.maxActiveOrders || 1, 1);
  });

  if (!available.length) return null;

  const ranked = available
    .map((state) => scoreRider(state.rider, order, state.activeLoad))
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  return {
    rider: getRiderById(winner.riderId),
    etaMinutes: winner.etaMinutes,
    distanceKm: winner.distanceKm,
    score: winner.score,
    alternatives: ranked.slice(1, 3)
  };
}

function markBusy(rider) {
  if (rider) rider.status = "BUSY";
}

function markAvailable(rider) {
  if (rider) rider.status = "AVAILABLE";
}

module.exports = {
  listRiders,
  getRiderById,
  findAvailableRider,
  isRiderOnShift,
  estimateDistanceKm,
  estimateEtaMinutes,
  pickBestRider,
  markBusy,
  markAvailable,
  riders
};
