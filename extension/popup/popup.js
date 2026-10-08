const fieldset = document.getElementById("catalogs");
const button = document.getElementById("export");
const status = document.getElementById("status");

function show(text, isError) {
  status.hidden = false;
  status.textContent = text;
  status.className = isError ? "error" : "";
}

chrome.runtime.sendMessage({ type: "CATALOGS" }, (catalogs) => {
  for (const [key, label] of Object.entries(catalogs || {})) {
    const row = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.name = key;
    box.checked = true;
    row.append(box, ` ${label}`);
    fieldset.append(row);
  }
});

document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const keys = [...fieldset.querySelectorAll("input:checked")].map((box) => box.name);
  if (!keys.length) {
    show("Pick at least one list to export.", true);
    return;
  }
  button.disabled = true;
  show("Exporting…");
  chrome.runtime.sendMessage({ type: "EXPORT", keys }, (result) => {
    button.disabled = false;
    if (!result || !result.ok) {
      show((result && result.error) || "Export failed.", true);
      return;
    }
    const lines = Object.entries(result.counts).map(([key, count]) => `${key}: ${count}`);
    const failed = Object.entries(result.errors || {}).map(([key, reason]) => `${key} failed: ${reason}`);
    show([`Saved ${result.filename}`, ...lines, ...failed].join("\n"), failed.length > 0);
  });
});
