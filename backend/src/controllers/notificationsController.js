const { ok } = require("../helpers/response");
const {
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} = require("../helpers/notifications");

const list = async (req, res) => {
  const payload = await listNotifications(req.user.appId, req.query.limit);
  return ok(res, "Notifications loaded.", payload);
};

const markRead = async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  await markNotificationsRead(req.user.appId, ids);
  const payload = await listNotifications(req.user.appId, req.body.limit || 12);
  return ok(res, "Notifications updated.", payload);
};

const markAllRead = async (req, res) => {
  await markAllNotificationsRead(req.user.appId);
  const payload = await listNotifications(req.user.appId, req.body.limit || 12);
  return ok(res, "All notifications marked as read.", payload);
};

module.exports = {
  list,
  markRead,
  markAllRead,
};
