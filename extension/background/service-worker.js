const DASHBOARD_URLS = ["https://dashboard.sse.cisco.com/*", "https://*.sse.cisco.com/*"];

const CATALOGS = {
  applications: {
    label: "Applications",
    token: "opendns",
    url: (orgId) => `https://api.opendns.com/v3/organizations/${orgId}/applications?outputFormat=jsonHttpStatusOverride`,
    dataKey: "data",
  },
  applicationCategories: {
    label: "Application categories",
    token: "opendns",
    url: (orgId) => `https://api.opendns.com/v3/organizations/${orgId}/applicationcategories?optionalFields=%5B%22applicationsCount%22%5D&outputFormat=jsonHttpStatusOverride`,
    dataKey: "data",
  },
  enterpriseApplications: {
    label: "Enterprise applications",
    token: "opendns",
    url: (orgId) => `https://api.opendns.com/v3/organizations/${orgId}/enterpriseapplications?outputFormat=jsonHttpStatusOverride`,
    dataKey: "data",
  },
  applicationLists: {
    label: "Application lists",
    token: "sse",
    url: (orgId) => `https://api.umbrella.com/v1/organizations/${orgId}/application_lists`,
    dataKey: "applicationLists",
  },
};

async function findDashboardTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && /^https:\/\/([a-z0-9-]+\.)*sse\.cisco\.com\//.test(active.url || "")) return active;
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URLS });
  return tabs.find((tab) => /\/org\/\d+/.test(tab.url || "")) || tabs[0] || null;
}

function orgIdFromUrl(url) {
  const match = (url || "").match(/\/org\/(\d+)/);
  return match ? match[1] : null;
}

// Runs inside the dashboard page (MAIN world), so requests carry the
// dashboard's own origin and session, exactly like the dashboard's own calls.
async function collectInPage(orgId, jobs) {
  const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

  function decode(token) {
    try {
      return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    } catch (_) {
      return null;
    }
  }

  function storedJwt(pattern) {
    const now = Date.now() / 1000;
    let best = null;
    for (const store of [sessionStorage, localStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const raw = store.getItem(key) || "";
        const candidates = [];
        if (JWT.test(raw.trim())) candidates.push(raw.trim());
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            for (const value of Object.values(parsed)) {
              if (typeof value === "string" && JWT.test(value.trim())) candidates.push(value.trim());
            }
          }
        } catch (_) {}
        for (const token of candidates) {
          const claims = decode(token) || {};
          const audience = [].concat(claims.aud || [], claims.iss || []).join(" ");
          if (!pattern.test(audience) && !pattern.test(key)) continue;
          if (claims.exp && claims.exp < now + 5) continue;
          if (!best || (claims.exp || 0) > best.exp) best = { token, exp: claims.exp || 0 };
        }
      }
    }
    return best && best.token;
  }

  async function opendnsToken() {
    try {
      const response = await fetch("/token", { credentials: "include", headers: { Accept: "application/json" } });
      if (response.ok) {
        const body = await response.json();
        if (body && body.token) return body.token;
      }
    } catch (_) {}
    const cached = storedJwt(/api\.opendns\.com/);
    if (cached) return cached;
    throw new Error("could not get a dashboard token for api.opendns.com — reload the dashboard and try again");
  }

  function sseToken() {
    const cached = storedJwt(/api\.(sse\.cisco|umbrella)\.com/);
    if (cached) return cached;
    throw new Error("no api.umbrella.com token in this dashboard tab — open Policies > Access Policy once, then try again");
  }

  function rows(json, dataKey) {
    if (Array.isArray(json)) return json;
    for (const key of [dataKey, "data", "results", "items"]) {
      if (json && Array.isArray(json[key])) return json[key];
    }
    return [];
  }

  async function getAll(url, token, dataKey) {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    const first = await fetch(url, { headers });
    if (!first.ok) throw new Error(`HTTP ${first.status}`);
    const json = await first.json();
    const items = rows(json, dataKey);
    const total = Number(json && json.total) || 0;
    if (!total || items.length >= total || !items.length) return items;
    const limit = items.length;
    for (let page = 2; items.length < total; page++) {
      const separator = url.includes("?") ? "&" : "?";
      const next = await fetch(`${url}${separator}page=${page}&limit=${limit}`, { headers });
      if (!next.ok) throw new Error(`HTTP ${next.status} on page ${page}`);
      const more = rows(await next.json(), dataKey);
      if (!more.length) break;
      items.push(...more);
    }
    return items;
  }

  const tokens = {};
  const data = {};
  const errors = {};
  for (const job of jobs) {
    try {
      if (!tokens[job.token]) tokens[job.token] = job.token === "opendns" ? await opendnsToken() : sseToken();
      data[job.key] = await getAll(job.url, tokens[job.token], job.dataKey);
    } catch (error) {
      errors[job.key] = String(error && error.message || error);
    }
  }
  return { data, errors };
}

async function exportCatalogs(keys) {
  const tab = await findDashboardTab();
  if (!tab) throw new Error("Open the Secure Access dashboard (dashboard.sse.cisco.com) in a tab first.");
  const orgId = orgIdFromUrl(tab.url);
  if (!orgId) throw new Error("Couldn't find the organization ID in the dashboard URL. Open any page under /org/<id>/ and try again.");

  const jobs = keys
    .filter((key) => CATALOGS[key])
    .map((key) => ({ key, token: CATALOGS[key].token, url: CATALOGS[key].url(orgId), dataKey: CATALOGS[key].dataKey }));
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: collectInPage,
    args: [orgId, jobs],
  });
  const { data, errors } = injection.result || { data: {}, errors: { all: "the dashboard tab did not return a result" } };

  const counts = Object.fromEntries(Object.entries(data).map(([key, items]) => [key, items.length]));
  if (!Object.keys(data).length) {
    const reasons = Object.entries(errors).map(([key, reason]) => `${CATALOGS[key] ? CATALOGS[key].label : key}: ${reason}`);
    throw new Error(reasons.join("\n") || "Nothing was exported.");
  }

  const exportedAt = new Date().toISOString();
  const payload = { exportedAt, orgId, source: "dashboard.sse.cisco.com", counts, errors, ...data };
  const json = JSON.stringify(payload, null, 2);
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  const filename = `secure-access-applications-${orgId}-${exportedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
  await chrome.downloads.download({ url, filename, saveAs: false });
  return { orgId, counts, errors, filename };
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message && message.type === "EXPORT") {
    exportCatalogs(message.keys || Object.keys(CATALOGS))
      .then((result) => reply({ ok: true, ...result }))
      .catch((error) => reply({ ok: false, error: String(error && error.message || error) }));
    return true;
  }
  if (message && message.type === "CATALOGS") {
    reply(Object.fromEntries(Object.entries(CATALOGS).map(([key, value]) => [key, value.label])));
  }
  return false;
});
