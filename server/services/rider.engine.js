const riders = [
  { id: "r1", name: "Rider Alpha", status: "AVAILABLE", telegramChatId: process.env.RIDER_CHAT_ID }
];

function findAvailableRider() {
  return riders.find(r => r.status === "AVAILABLE");
}

function markBusy(rider) {
  rider.status = "BUSY";
}

function markAvailable(rider) {
  rider.status = "AVAILABLE";
}

module.exports = {
  findAvailableRider,
  markBusy,
  markAvailable,
  riders
};
