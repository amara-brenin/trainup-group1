const ok = (res, message, data = {}) =>
  res.status(200).json({
    status: true,
    message,
    data,
  });

const fail = (res, status, message, data = {}) =>
  res.status(status).json({
    status: false,
    message,
    data,
  });

module.exports = {
  ok,
  fail,
};
