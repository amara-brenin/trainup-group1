const Notification = require("../models/Notification");
const User = require("../models/User");

const createNotificationId = () => `notification-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const sanitizeNotification = (record) => ({
  id: record.appId,
  title: record.title,
  message: record.message,
  category: record.category || "system",
  severity: record.severity || "info",
  link: record.link || "",
  createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : new Date().toISOString(),
  readAt: record.readAt || "",
  actorName: record.actorName || "",
  isRead: Boolean(record.readAt),
});

const pushNotifications = async (users, payload) => {
  const recipients = (Array.isArray(users) ? users : []).filter(Boolean);

  if (!recipients.length) {
    return [];
  }

  const createdAt = new Date().toISOString();
  const documents = recipients.map((user) => ({
    appId: createNotificationId(),
    userId: user.appId,
    clientId: user.clientId || payload.clientId || "",
    title: String(payload.title || "").trim(),
    message: String(payload.message || "").trim(),
    category: String(payload.category || "system").trim(),
    severity: String(payload.severity || "info").trim(),
    link: String(payload.link || "").trim(),
    readAt: "",
    actorName: String(payload.actorName || "").trim(),
    metadata: payload.metadata || {},
    createdAt,
    updatedAt: createdAt,
  }));

  if (!documents[0].title || !documents[0].message) {
    return [];
  }

  await Notification.insertMany(documents);
  await User.updateMany(
    { appId: { $in: recipients.map((user) => user.appId) } },
    {
      $set: {
        isUnreadNotifications: true,
      },
    },
  );

  return documents;
};

const notifyUserIds = async (userIds, payload, options = {}) => {
  const uniqueUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean))];

  if (!uniqueUserIds.length) {
    return [];
  }

  const users = await User.find({
    appId: { $in: uniqueUserIds },
    ...(options.clientId ? { clientId: options.clientId } : {}),
  }).lean();

  const filteredUsers = options.excludeUserId
    ? users.filter((user) => user.appId !== options.excludeUserId)
    : users;

  return pushNotifications(filteredUsers, payload);
};

const notifyRolesInClient = async ({ clientId, roles, excludeUserId, payload }) => {
  if (!clientId || !Array.isArray(roles) || !roles.length) {
    return [];
  }

  const users = await User.find({
    clientId,
    role: { $in: roles },
    status: "active",
  }).lean();

  const filteredUsers = excludeUserId
    ? users.filter((user) => user.appId !== excludeUserId)
    : users;

  return pushNotifications(filteredUsers, {
    ...payload,
    clientId,
  });
};

const notifySuperAdmins = async (payload, options = {}) => {
  const users = await User.find({
    role: "super_admin",
    status: "active",
  }).lean();

  const filteredUsers = options.excludeUserId
    ? users.filter((user) => user.appId !== options.excludeUserId)
    : users;

  return pushNotifications(filteredUsers, payload);
};

const notifyTrainingOwner = async ({ clientId, trainerName, excludeUserId, payload }) => {
  if (!clientId || !trainerName) {
    return [];
  }

  const users = await User.find({
    clientId,
    role: "trainer",
    status: "active",
    $or: [{ fullname: trainerName }, { name: trainerName }],
  }).lean();

  const filteredUsers = excludeUserId
    ? users.filter((user) => user.appId !== excludeUserId)
    : users;

  return pushNotifications(filteredUsers, {
    ...payload,
    clientId,
  });
};

const listNotifications = async (userId, limit = 12) => {
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 12)));
  const records = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(safeLimit).lean();
  const unreadCount = await Notification.countDocuments({ userId, $or: [{ readAt: "" }, { readAt: { $exists: false } }] });

  return {
    unreadCount,
    notifications: records.map(sanitizeNotification),
  };
};

const refreshUnreadFlag = async (userId) => {
  if (!userId) {
    return false;
  }

  const unreadCount = await Notification.countDocuments({
    userId,
    $or: [{ readAt: "" }, { readAt: { $exists: false } }],
  });

  await User.updateOne(
    { appId: userId },
    {
      $set: {
        isUnreadNotifications: unreadCount > 0,
      },
    },
  );

  return unreadCount > 0;
};

const markNotificationsRead = async (userId, notificationIds = []) => {
  const ids = [...new Set((Array.isArray(notificationIds) ? notificationIds : []).filter(Boolean))];
  if (!ids.length) {
    return 0;
  }

  const now = new Date().toISOString();
  const result = await Notification.updateMany(
    {
      userId,
      appId: { $in: ids },
      $or: [{ readAt: "" }, { readAt: { $exists: false } }],
    },
    {
      $set: {
        readAt: now,
      },
    },
  );

  await refreshUnreadFlag(userId);
  return result.modifiedCount || 0;
};

const markAllNotificationsRead = async (userId) => {
  const now = new Date().toISOString();
  const result = await Notification.updateMany(
    {
      userId,
      $or: [{ readAt: "" }, { readAt: { $exists: false } }],
    },
    {
      $set: {
        readAt: now,
      },
    },
  );

  await refreshUnreadFlag(userId);
  return result.modifiedCount || 0;
};

module.exports = {
  sanitizeNotification,
  pushNotifications,
  notifyUserIds,
  notifyRolesInClient,
  notifySuperAdmins,
  notifyTrainingOwner,
  listNotifications,
  refreshUnreadFlag,
  markNotificationsRead,
  markAllNotificationsRead,
};
