module.exports = (error, _req, res, _next) => {
  console.error(error);

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    status: false,
    message: error instanceof Error ? error.message : "Internal server error.",
    data: {},
  });
};
