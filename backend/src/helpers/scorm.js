const { createZipBuffer } = require("./zip");

// SCORM 1.2 "dispatch" package generator (LMS_INTEGRATION_RESEARCH.md — Method C).
//
// Produces a tiny, universally-accepted SCORM 1.2 zip that a customer uploads
// into their LMS. Instead of bundling the whole training offline, the package is
// a thin wrapper: it iframes the LIVE TrainUp player (via a signed launch URL)
// and bridges completion + score back into the LMS gradebook through the SCORM
// API. This keeps all live features (AI Ask, proctoring) while still being a
// normal "upload a file" experience for the LMS admin.

const escapeXml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const buildManifest = (training) => {
  const id = escapeXml(`TRAINUP_${training.id}`);
  const title = escapeXml(training.title || "Training");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>${title}</title>
      <item identifier="ITEM" identifierref="RES">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;
};

// The wrapper page: finds the SCORM API, opens the live player in an iframe with
// the LMS learner's identity, and reports completion/score on a postMessage from
// the player (origin-checked) or on exit.
const buildWrapperHtml = (training, launchUrl) => {
  const title = escapeXml(training.title || "Training");
  // launchUrl is embedded into JS as a JSON string (safe quoting).
  const launchJson = JSON.stringify(launchUrl);
  let launchOrigin = "*";
  try {
    launchOrigin = new URL(launchUrl).origin;
  } catch {
    launchOrigin = "*";
  }
  const originJson = JSON.stringify(launchOrigin);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0b0b0c}#f{border:0;width:100%;height:100%;display:block}</style>
</head>
<body>
<iframe id="f" allow="camera; microphone; autoplay; fullscreen" allowfullscreen></iframe>
<script>
(function () {
  var LAUNCH_URL = ${launchJson};
  var PLAYER_ORIGIN = ${originJson};

  // --- SCORM 1.2 API discovery (walk up frames + opener) ---
  function findAPI(win) {
    var tries = 0;
    while (win && tries < 12) {
      if (win.API) return win.API;
      if (win.parent && win.parent !== win) { win = win.parent; } else { break; }
      tries++;
    }
    return null;
  }
  function getAPI() {
    var api = findAPI(window);
    if (!api && window.opener) api = findAPI(window.opener);
    return api;
  }

  var API = getAPI();
  var initialized = false;
  var finished = false;
  var learnerName = "";
  var learnerId = "";

  function lmsGet(key) {
    try { return API ? API.LMSGetValue(key) : ""; } catch (e) { return ""; }
  }
  function lmsSet(key, val) {
    try { if (API) API.LMSSetValue(key, String(val)); } catch (e) {}
  }

  if (API) {
    try { initialized = API.LMSInitialize("") === "true" || API.LMSInitialize("") === true; } catch (e) {}
    learnerName = lmsGet("cmi.core.student_name") || "";
    learnerId = lmsGet("cmi.core.student_id") || "";
    if (lmsGet("cmi.core.lesson_status") === "not attempted" || lmsGet("cmi.core.lesson_status") === "") {
      lmsSet("cmi.core.lesson_status", "incomplete");
    }
    try { API.LMSCommit(""); } catch (e) {}
  }

  function finish(status, score) {
    if (!API || finished) return;
    if (typeof score === "number" && !isNaN(score)) {
      lmsSet("cmi.core.score.raw", Math.round(score));
      lmsSet("cmi.core.score.min", 0);
      lmsSet("cmi.core.score.max", 100);
    }
    lmsSet("cmi.core.lesson_status", status || "completed");
    try { API.LMSCommit(""); } catch (e) {}
    try { API.LMSFinish(""); } catch (e) {}
    finished = true;
  }

  // Pass the LMS learner identity to the player so it auto-starts without a form.
  // "Last, First" -> "First Last" for nicer display.
  var displayName = learnerName;
  if (displayName.indexOf(",") > -1) {
    var parts = displayName.split(",");
    displayName = (parts[1] || "").trim() + " " + (parts[0] || "").trim();
  }
  var sep = LAUNCH_URL.indexOf("?") > -1 ? "&" : "?";
  var src = LAUNCH_URL + sep + "ln=" + encodeURIComponent(displayName.trim() || "Learner")
    + "&le=" + encodeURIComponent(learnerId || ("scorm-" + Date.now()));
  document.getElementById("f").src = src;

  // Receive completion/score from the TrainUp player (origin-checked).
  window.addEventListener("message", function (ev) {
    if (PLAYER_ORIGIN !== "*" && ev.origin !== PLAYER_ORIGIN) return;
    var d = ev.data || {};
    if (d && d.source === "trainup" && d.type === "completed") {
      finish("completed", typeof d.score === "number" ? d.score : undefined);
    }
  });

  // Safety net: report completion on exit if the learner closes mid-way.
  window.addEventListener("unload", function () { if (!finished && API) { try { API.LMSCommit(""); API.LMSFinish(""); } catch (e) {} } });
})();
</script>
</body>
</html>`;
};

// Build the full SCORM 1.2 package as a zip Buffer.
const buildScormPackage = (training, launchUrl) => {
  const files = [
    { name: "imsmanifest.xml", content: buildManifest(training) },
    { name: "index.html", content: buildWrapperHtml(training, launchUrl) },
  ];
  return createZipBuffer(files);
};

module.exports = { buildScormPackage, buildManifest, buildWrapperHtml };
