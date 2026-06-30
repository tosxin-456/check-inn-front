"use strict";

// ---- API base resolution ----
// Default to local backend. Override with ?api=https://your-api  (remembered in localStorage).
const params = new URLSearchParams(location.search);
if (params.get("api")) localStorage.setItem("checkinApiBase", params.get("api"));
const API_BASE = (params.get("api") || localStorage.getItem("checkinApiBase") || "http://localhost:3001").replace(/\/+$/, "");

// ---- DOM refs ----
const rowsEl = document.getElementById("rows");
const qEl = document.getElementById("q");
const bannerEl = document.getElementById("banner");
const filterEl = document.getElementById("status-filter");
const modal = document.getElementById("modal");
const form = document.getElementById("register-form");
const formError = document.getElementById("form-error");

const state = { q: "", status: "all" };

// ---- Helpers ----
const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function highlight(value, terms) {
  let out = escapeHtml(value);
  for (const t of terms) {
    if (!t) continue;
    out = out.replace(new RegExp("(" + escapeRegExp(t) + ")", "gi"), "<mark>$1</mark>");
  }
  return out;
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toast(msg, type) {
  const el = document.createElement("div");
  el.className = "toast " + (type || "");
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 2400);
}

function showBanner(msg) {
  bannerEl.textContent = msg;
  bannerEl.classList.add("show");
}
function hideBanner() { bannerEl.classList.remove("show"); }

async function api(path, options) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) {
    const msg = (body && body.error) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body;
}

// ---- Stats ----
function renderStats(stats) {
  if (!stats) return;
  document.getElementById("stat-total").textContent = stats.total;
  document.getElementById("stat-in").textContent = stats.checkedIn;
  document.getElementById("stat-remaining").textContent = stats.remaining;
}

// ---- List ----
let loadSeq = 0;
async function load() {
  const seq = ++loadSeq;
  const qs = new URLSearchParams();
  if (state.q) qs.set("q", state.q);
  if (state.status !== "all") qs.set("status", state.status);

  let data;
  try {
    data = await api("/api/registrations?" + qs.toString());
  } catch (err) {
    if (seq !== loadSeq) return; // superseded by a newer request
    showBanner(`Can't reach the API at ${API_BASE} — is the backend running? (${err.message})`);
    rowsEl.innerHTML = `<tr><td colspan="6"><div class="empty">No connection to the server.</div></td></tr>`;
    return;
  }

  if (seq !== loadSeq) return; // a newer load already rendered; ignore this stale response
  hideBanner();
  renderStats(data.stats);
  renderRows(data.registrations);
}

function renderRows(list) {
  const terms = state.q.split(/\s+/).filter(Boolean);

  if (!list.length) {
    rowsEl.innerHTML = `<tr><td colspan="6"><div class="empty">No matching registrations.</div></td></tr>`;
    return;
  }

  rowsEl.innerHTML = list.map((r, i) => {
    const phone = r.phone || "";
    const tel = phone.replace(/[^\d+]/g, "");
    const phoneCell = phone
      ? `<a href="tel:${escapeHtml(tel)}">${highlight(phone, terms)}</a>`
      : `<span style="color:var(--muted)">—</span>`;

    const status = r.checkedIn
      ? `<span class="badge badge-in">Checked in</span>${r.checkedInAt ? `<span class="checked-at">${escapeHtml(fmtTime(r.checkedInAt))}</span>` : ""}`
      : `<span class="badge badge-out">Not yet</span>`;

    const action = r.checkedIn
      ? `<button class="btn-sm btn-undo" data-action="undo" data-id="${escapeHtml(r.id)}">Undo</button>`
      : `<button class="btn-sm btn-checkin" data-action="checkin" data-id="${escapeHtml(r.id)}">Check in</button>`;

    return `<tr class="${r.checkedIn ? "is-in" : ""}">
      <td class="num">${i + 1}</td>
      <td class="col-name">${highlight(r.name, terms)}</td>
      <td class="col-phone">${phoneCell}</td>
      <td>${highlight(r.church, terms)}</td>
      <td>${status}</td>
      <td class="actions">${action}</td>
    </tr>`;
  }).join("");
}

// ---- Actions (event delegation) ----
rowsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  btn.disabled = true;
  try {
    const data = await api(`/api/registrations/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    renderStats(data.stats);
    toast(action === "checkin" ? `Checked in ${data.registration.name}` : `Undid check-in for ${data.registration.name}`,
      action === "checkin" ? "success" : "");
    load();
  } catch (err) {
    toast(err.message, "error");
    btn.disabled = false;
  }
});

// ---- Search ----
let debounce;
qEl.addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.q = qEl.value.trim(); load(); }, 200);
});

// ---- Status filter ----
filterEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-status]");
  if (!btn) return;
  state.status = btn.dataset.status;
  [...filterEl.children].forEach((b) => b.classList.toggle("active", b === btn));
  load();
});

// ---- Register modal ----
function openModal() {
  formError.textContent = "";
  form.reset();
  modal.classList.add("open");
  setTimeout(() => document.getElementById("f-name").focus(), 50);
}
function closeModal() { modal.classList.remove("open"); }

document.getElementById("btn-register").addEventListener("click", openModal);
document.getElementById("btn-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";
  const payload = {
    name: form.name.value.trim(),
    phone: form.phone.value.trim(),
    church: form.church.value.trim(),
  };
  if (!payload.name) { formError.textContent = "Please enter a name."; return; }

  const saveBtn = document.getElementById("btn-save");
  saveBtn.disabled = true;
  try {
    // Register, then immediately check them in (handy for walk-ins at the door).
    const created = await api("/api/registrations", { method: "POST", body: JSON.stringify(payload) });
    await api(`/api/registrations/${encodeURIComponent(created.registration.id)}/checkin`, { method: "POST" });
    closeModal();
    toast(`Registered & checked in ${created.registration.name}`, "success");
    // Show the newcomer: clear filters/search so they're visible.
    state.q = ""; qEl.value = "";
    state.status = "all";
    [...filterEl.children].forEach((b) => b.classList.toggle("active", b.dataset.status === "all"));
    load();
  } catch (err) {
    formError.textContent = err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ---- Go ----
load();
