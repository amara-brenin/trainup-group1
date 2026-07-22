const Client = require("../models/Client");
const { ok, fail } = require("../helpers/response");
const { getTenantClientId } = require("../helpers/tenant");

const AMARA_API_BASE = "https://amara.brenin.co:3000";
const AMARA_API_KEY = "trainup_ext_9f8c7b6a5e4d3c2b1a0f9e8d7c6b5a4";

const getAvatars = async (req, res) => {
  try {
    const fetchRes = await fetch(`${AMARA_API_BASE}/api-v1/external/get-avatar`, {
      method: "GET",
      headers: {
        "X-Api-Key": AMARA_API_KEY,
      },
    });

    if (!fetchRes.ok) {
      throw new Error(`Amara API returned ${fetchRes.status}`);
    }

    const data = await fetchRes.json();
    if (!data.status || !Array.isArray(data.data)) {
      return fail(res, 500, "Failed to parse avatar data from upstream");
    }

    const allAvatars = data.data;

    if (req.user && req.user.role === "super_admin") {
      return ok(res, "Avatars fetched successfully", allAvatars);
    }

    // For clients, filter based on assignedAvatars
    const clientId = getTenantClientId(req);
    if (!clientId) {
      return ok(res, "Avatars fetched successfully", allAvatars);
    }

    const client = await Client.findOne({ appId: clientId });
    if (!client) {
      return ok(res, "Avatars fetched successfully", allAvatars);
    }

    const assignedAvatars = client.assignedAvatars || [];
    
    // As per backward compatibility plan, if assignedAvatars is empty, show all.
    // If we want strict restriction, we would return [] when empty. 
    // The user's open question feedback was skipped, so we default to showing all if empty.
    if (assignedAvatars.length === 0) {
      return ok(res, "Avatars fetched successfully", allAvatars);
    }

    const filteredAvatars = allAvatars.filter(avatar => assignedAvatars.includes(avatar.avatarId));
    
    return ok(res, "Avatars fetched successfully", filteredAvatars);

  } catch (error) {
    console.error("Error fetching avatars:", error);
    return fail(res, 500, "Internal Server Error");
  }
};

module.exports = {
  getAvatars,
};
