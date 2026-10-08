# Secure Access Application Exporter

A Chrome extension that downloads Cisco Secure Access application data as one JSON file, straight from the dashboard you're signed in to:

- **Applications**: the full application catalog (around 10,000 entries, including application protocols)
- **Application categories**, with how many applications each contains
- **Enterprise applications**
- **Application lists** defined in your organization

It reads the same endpoints the dashboard itself uses, so it needs no API key: only an open, signed-in dashboard tab.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension` folder.

## Use

1. Sign in to the Secure Access dashboard (`https://dashboard.sse.cisco.com/org/<orgId>/…`) and leave the tab open.
2. Click the extension icon, keep the lists you want ticked, and click **Export JSON**.
3. The file is saved to your Downloads folder as `secure-access-applications-<orgId>-<timestamp>.json`.

The export looks like this:

```json
{
  "exportedAt": "2026-10-08T18:08:36.000Z",
  "orgId": "1234567",
  "source": "dashboard.sse.cisco.com",
  "counts": { "applications": 10213, "applicationCategories": 64, "enterpriseApplications": 3, "applicationLists": 5 },
  "errors": {},
  "applications": [ … ],
  "applicationCategories": [ … ],
  "enterpriseApplications": [ … ],
  "applicationLists": [ … ]
}
```

Each list keeps the records exactly as the API returns them. If one list can't be fetched, the others are still exported and the reason is recorded under `errors`.

## How it works

When you click **Export JSON**, the extension runs a small function inside the dashboard tab:

| List | Endpoint | Token |
|---|---|---|
| Applications | `api.opendns.com/v3/organizations/{orgId}/applications` | fresh token from the dashboard's `/token` |
| Application categories | `api.opendns.com/v3/organizations/{orgId}/applicationcategories` | same |
| Enterprise applications | `api.opendns.com/v3/organizations/{orgId}/enterpriseapplications` | same |
| Application lists | `api.umbrella.com/v1/organizations/{orgId}/application_lists` | the dashboard's cached `api.umbrella.com` token |

Because the requests run in the dashboard page, they carry its origin and session, and the extension needs no access to those API hosts itself. Nothing leaves your browser except those requests to Cisco.

## Troubleshooting

- **"Open the Secure Access dashboard … first"**: no dashboard tab is open in this browser.
- **"no api.umbrella.com token in this dashboard tab"**: open **Policies → Access Policy** once so the dashboard fetches that token, then export again.
- **HTTP 401/403**: your dashboard session has expired; reload the dashboard and sign in again.
