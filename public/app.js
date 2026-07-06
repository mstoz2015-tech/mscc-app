// MSCC App — Frontend
const API = "";

let csvData = [], csvColumns = [], csvFileName = "", sendTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  document.getElementById("btnSaveCfg").addEventListener("click", saveConfig);
  loadConfig();
  const drop = document.getElementById("csvDrop"), inp = document.getElementById("csvInput");
  drop.addEventListener("click", () => inp.click());
  drop.addEventListener("dragover", e => e.preventDefault());
  drop.addEventListener("drop", e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  inp.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  document.getElementById("btnQueue").addEventListener("click", addToQueue);
  document.getElementById("btnStart").addEventListener("click", startSend);
  document.getElementById("btnClear").addEventListener("click", clearQueue);
  document.getElementById("btnAddCampaign").addEventListener("click", () => openCampaignModal());
  document.getElementById("btnAddSender").addEventListener("click", () => openSenderModal());
  document.getElementById("btnModalClose").addEventListener("click", closeModal);
  document.getElementById("btnModalSave").addEventListener("click", saveModal);
  switchTab("stats");
  refreshAll();
  setInterval(refreshAll, 10000);
});

async function api(url, opts = {}) {
  const res = await fetch(API + url, { headers: { "Content-Type": "application/json" }, ...opts });
  return res.json();
}

function switchTab(n) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === n));
  document.querySelectorAll(".content").forEach(c => c.classList.toggle("hidden", c.id !== n));
  if (n === "stats") refreshAll();
  if (n === "send") loadCampaignsForSend();
  if (n === "campaigns") refreshCampaigns();
  if (n === "senders") refreshSenders();
}

// CSV
function handleFile(file) {
  if (!file || !file.name.endsWith(".csv")) return alert("CSV requis");
  csvFileName = file.name;
  const r = new FileReader();
  r.onload = e => {
    const lines = e.target.result.split("\n").filter(l => l.trim());
    if (lines.length < 2) return alert("CSV vide");
    csvColumns = lines[0].split(/[,;\t]/).map(c => c.trim().toLowerCase());
    csvData = lines.slice(1).filter(l => l.trim() && l.includes("@")).map(l => {
      const v = l.split(/[,;\t]/).map(x => x.trim());
      const row = {};
      csvColumns.forEach((c, i) => row[c] = v[i] || "");
      return row;
    }).filter(r => r.email && r.email.includes("@"));
    showCsvPreview();
  };
  r.readAsText(file);
}

function showCsvPreview() {
  const info = document.getElementById("csvInfo"), prev = document.getElementById("csvPreview"), rows = document.getElementById("csvRows");
  info.innerHTML = "📄 <b>" + csvFileName + "</b> · " + csvData.length + " contacts · " + csvColumns.join(", ");
  info.classList.remove("hidden");
  prev.classList.remove("hidden");
  rows.innerHTML = "<tr style='font-weight:600'>" + csvColumns.map(c => "<td>" + c + "</td>").join("") + "</tr>" + csvData.slice(0, 5).map(r => "<tr>" + csvColumns.map(c => "<td>" + (r[c] || "") + "</td>").join("") + "</tr>").join("");
}

function clearCsv() {
  csvData = []; csvColumns = []; csvFileName = "";
  document.getElementById("csvInfo").classList.add("hidden");
  document.getElementById("csvPreview").classList.add("hidden");
  document.getElementById("csvInput").value = "";
}

// Queue
async function addToQueue() {
  const cid = document.getElementById("sendCampaign").value;
  const subject = document.getElementById("subject").value;
  const body = document.getElementById("editorBody").innerHTML;
  if (!cid) return alert("Choisissez une campagne");
  if (!subject) return alert("Objet requis");
  let recipients = [];
  if (csvData.length) {
    recipients = csvData.map(r => {
      let s = subject, b = body;
      csvColumns.forEach(c => { s = s.replace(new RegExp("{" + c + "}", "gi"), r[c] || ""); b = b.replace(new RegExp("{" + c + "}", "gi"), r[c] || ""); });
      return { to: r.email, subject: s, body: b };
    });
  } else {
    const raw = prompt("Adresses :");
    if (!raw) return;
    recipients = raw.split(/[\n,;]+/).map(e => e.trim()).filter(e => e.includes("@")).map(to => ({ to, subject, body }));
  }
  if (!recipients.length) return alert("Aucune adresse");
  const r = await api("/api/queue", { method: "POST", body: JSON.stringify({ campaign_id: cid, emails: recipients }) });
  alert("✅ " + r.queued + " dans la file");
  clearCsv();
  refreshAll();
}

async function clearQueue() {
  const cid = document.getElementById("sendCampaign").value;
  if (!confirm("Vider ?")) return;
  await api("/api/queue/" + cid, { method: "DELETE" });
  refreshAll();
}

// Send loop
async function startSend() {
  const cid = document.getElementById("sendCampaign").value;
  if (!cid) return alert("Choisissez une campagne");
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; document.getElementById("btnStart").textContent = "▶️ Démarrer l'envoi"; refreshAll(); return; }

  const settings = await api("/api/settings");
  const delay = (settings.delay || 80) * 1000;

  document.getElementById("btnStart").textContent = "⏹️ Arrêter l'envoi";
  document.getElementById("btnStart").className = "btn-danger";

  async function sendOne() {
    const m = new Date().getHours() * 60 + new Date().getMinutes();
    const [sh, sm] = (settings.startTime || "08:00").split(":").map(Number);
    const [eh, em] = (settings.endTime || "22:00").split(":").map(Number);
    if (m < sh * 60 + sm || m > eh * 60 + em) return;

    const r = await api("/api/send-one", { method: "POST", body: JSON.stringify({ campaign_id: cid }) });
    if (r.remaining === 0) {
      clearInterval(sendTimer);
      sendTimer = null;
      document.getElementById("btnStart").textContent = "▶️ Démarrer l'envoi";
      document.getElementById("btnStart").className = "btn-primary";
      alert("✅ Envoi terminé !");
    }
    refreshAll();
  }

  sendOne();
  sendTimer = setInterval(sendOne, delay);
}

// Campaigns
async function loadCampaignsForSend() {
  const camps = await api("/api/campaigns");
  const s = document.getElementById("sendCampaign");
  s.innerHTML = camps.length ? camps.map(c => '<option value="' + c.id + '">' + c.name + '</option>').join("") : '<option value="">— Aucune —</option>';
}
async function onCampaignChange() {
  const camps = await api("/api/campaigns");
  const c = camps.find(x => x.id === document.getElementById("sendCampaign").value);
  if (c) { document.getElementById("subject").value = c.subject || ""; document.getElementById("editorBody").innerHTML = c.body || ""; }
}
async function refreshCampaigns() {
  const camps = await api("/api/campaigns");
  document.getElementById("campaignList").innerHTML = camps.map(c =>
    '<div class="camp-card"><div><div class="item-name">' + c.name + '</div><div class="item-sub">' + (c.sender_id || "?") + ' · 📤' + (c.sent || 0) + ' 👁' + (c.opens || 0) + ' 🔗' + (c.clicks || 0) + '</div></div><div style="display:flex;gap:4px"><button class="btn-outline btn-sm edit-camp" data-id="' + c.id + '">✏️</button><button class="btn-danger btn-sm del-camp" data-id="' + c.id + '">🗑</button></div></div>'
  ).join("");
  document.querySelectorAll(".edit-camp").forEach(b => b.addEventListener("click", async () => openCampaignModal(camps.find(x => x.id === b.dataset.id))));
  document.querySelectorAll(".del-camp").forEach(b => b.addEventListener("click", async () => {
    if (confirm("Supprimer ?")) { await api("/api/campaigns/" + b.dataset.id, { method: "DELETE" }); refreshCampaigns(); }
  }));
}

// Senders
async function refreshSenders() {
  const senders = await api("/api/senders");
  document.getElementById("senderList").innerHTML = senders.map(s =>
    '<div class="item-row"><div><div class="item-name">' + s.name + '</div><div class="item-sub">' + s.usr + ' · ' + s.smtp + ':' + s.port + '</div></div><div style="display:flex;gap:4px"><button class="btn-outline btn-sm edit-snd" data-id="' + s.id + '">✏️</button><button class="btn-danger btn-sm del-snd" data-id="' + s.id + '">🗑</button></div></div>'
  ).join("");
  document.querySelectorAll(".edit-snd").forEach(b => b.addEventListener("click", async () => openSenderModal(senders.find(x => x.id === b.dataset.id))));
  document.querySelectorAll(".del-snd").forEach(b => b.addEventListener("click", async () => {
    if (confirm("Supprimer ?")) { await api("/api/senders/" + b.dataset.id, { method: "DELETE" }); refreshSenders(); }
  }));
}

// Modals
function openCampaignModal(camp) {
  document.getElementById("modalOverlay").classList.remove("hidden");
  document.getElementById("modalTitle").textContent = camp ? "Modifier" : "Nouvelle campagne";
  api("/api/senders").then(senders => {
    document.getElementById("modalFields").innerHTML =
      '<input id="modCampId" type="hidden" value="' + (camp ? camp.id : "") + '">' +
      '<label>Nom</label><input id="modCampName" value="' + (camp ? camp.name : "") + '">' +
      '<label>Expéditeur</label><select id="modCampSender">' + senders.map(s => '<option value="' + s.id + '"' + (camp && camp.sender_id === s.id ? ' selected' : '') + '>' + s.name + '</option>').join("") + '</select>' +
      '<label>Objet</label><input id="modCampSubject" value="' + (camp ? camp.subject : "") + '">' +
      '<label>Message</label><div class="editor-toolbar"><button onclick="execCmdModal(\'bold\')"><b>B</b></button><button onclick="execCmdModal(\'italic\')"><i>I</i></button></div><div id="modCampBody" class="editor-body" contenteditable="true" style="min-height:100px">' + (camp ? camp.body : "") + '</div>';
    document.getElementById("btnModalSave").onclick = async () => {
      const c = {
        id: document.getElementById("modCampId").value || "camp_" + Date.now(),
        name: document.getElementById("modCampName").value,
        sender_id: document.getElementById("modCampSender").value,
        subject: document.getElementById("modCampSubject").value,
        body: document.getElementById("modCampBody").innerHTML,
        created_at: camp ? camp.created_at : new Date().toISOString()
      };
      if (!c.name) return alert("Nom requis");
      await api("/api/campaigns", { method: "POST", body: JSON.stringify(c) });
      closeModal();
      refreshCampaigns();
      loadCampaignsForSend();
    };
  });
}

function openSenderModal(snd) {
  document.getElementById("modalOverlay").classList.remove("hidden");
  document.getElementById("modalTitle").textContent = snd ? "Modifier" : "Nouvel expéditeur";
  document.getElementById("modalFields").innerHTML =
    '<input id="modSndId" type="hidden" value="' + (snd ? snd.id : "") + '">' +
    '<label>Nom</label><input id="modSndName" value="' + (snd ? snd.name : "") + '">' +
    '<label>SMTP</label><input id="modSndSmtp" value="' + (snd ? snd.smtp : "smtp.stackmail.com") + '">' +
    '<label>Port</label><input id="modSndPort" type="number" value="' + (snd ? snd.port : 465) + '">' +
    '<label>Email</label><input id="modSndUser" value="' + (snd ? snd.usr : "") + '">' +
    '<label>Mot de passe</label><input id="modSndPass" type="password" value="' + (snd ? snd.pass : "") + '">' +
    '<label>Nom affiché</label><input id="modSndSender" value="' + (snd ? snd.sender_name : "Martin") + '">';
  document.getElementById("btnModalSave").onclick = async () => {
    const s = {
      id: document.getElementById("modSndId").value || document.getElementById("modSndName").value.toLowerCase().replace(/\s+/g, "-"),
      name: document.getElementById("modSndName").value,
      smtp: document.getElementById("modSndSmtp").value,
      port: parseInt(document.getElementById("modSndPort").value) || 465,
      usr: document.getElementById("modSndUser").value,
      pass: document.getElementById("modSndPass").value,
      sender_name: document.getElementById("modSndSender").value
    };
    if (!s.name || !s.usr) return alert("Nom et email requis");
    await api("/api/senders", { method: "POST", body: JSON.stringify(s) });
    closeModal();
    refreshSenders();
  };
}

function closeModal() { document.getElementById("modalOverlay").classList.add("hidden"); }
function saveModal() { document.getElementById("btnModalSave").onclick(); }

// Stats
async function refreshAll() {
  const stats = await api("/api/stats");
  document.getElementById("stSent").textContent = stats.sent || 0;
  document.getElementById("stOpens").textContent = stats.opens || 0;
  document.getElementById("stClicks").textContent = stats.clicks || 0;
  document.getElementById("hdrSent").textContent = stats.sent || 0;
  document.getElementById("hdrOpens").textContent = stats.opens || 0;
  document.getElementById("hdrClicks").textContent = stats.clicks || 0;

  const camps = await api("/api/campaigns");
  document.getElementById("campaignStatsList").innerHTML = camps.filter(c => (c.sent || 0) > 0).map(c =>
    '<div class="camp-card"><div><div class="item-name">' + c.name + '</div><div style="display:flex;gap:14px;font-size:13px;color:#5f6368;margin-top:4px"><span>📤 ' + (c.sent || 0) + '</span><span>👁 ' + (c.opens || 0) + '</span><span>🔗 ' + (c.clicks || 0) + '</span></div></div></div>'
  ).join("");

  // Queue status
  const q = await api("/api/queue");
  const div = document.getElementById("sendingStatus");
  const entries = Object.entries(q.queue || {});
  if (!entries.length) { div.innerHTML = ""; return; }
  div.innerHTML = entries.map(([cid, info]) =>
    '<div class="sending-bar"><span><b>' + cid + '</b> · ' + info.items + ' en attente</span>' +
    (sendTimer ? '<span style="color:#0d904f">● En cours</span>' : '<span style="color:#5f6368">○ En pause</span>') +
    '</div>'
  ).join("");
}

// Editor
function execCmd(cmd) { document.execCommand(cmd, false, null); document.getElementById("editorBody").focus(); }
function insertLink() { const url = prompt("URL:"); if (url) document.execCommand("createLink", false, url); }
function execCmdModal(cmd) { document.execCommand(cmd, false, null); }
window.execCmd = execCmd; window.insertLink = insertLink; window.execCmdModal = execCmdModal;

// Config
async function loadConfig() {
  const s = await api("/api/settings");
  document.getElementById("cfgDelay").value = s.delay || 80;
  document.getElementById("cfgStart").value = s.startTime || "08:00";
  document.getElementById("cfgEnd").value = s.endTime || "22:00";
}
async function saveConfig() {
  await api("/api/settings", { method: "POST", body: JSON.stringify({
    delay: parseInt(document.getElementById("cfgDelay").value) || 80,
    startTime: document.getElementById("cfgStart").value,
    endTime: document.getElementById("cfgEnd").value
  }) });
  alert("✅ Enregistré");
}

// Warn before leaving if sending
window.addEventListener("beforeunload", e => {
  if (sendTimer) e.preventDefault();
});
