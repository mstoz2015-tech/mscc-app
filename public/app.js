// MSCC App — Frontend
const API = "";

let csvData = [], csvColumns = [], csvFileName = "", sendTimer = null;
let verifyResults = [];

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  document.getElementById("btnSaveCfg").addEventListener("click", saveConfig);
  loadConfig();
  const drop = document.getElementById("csvDrop"), inp = document.getElementById("csvInput");
  drop.addEventListener("click", () => inp.click());
  drop.addEventListener("dragover", e => e.preventDefault());
  drop.addEventListener("drop", e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });
  inp.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  document.getElementById("btnStart").addEventListener("click", startSend);
  document.getElementById("btnClear").addEventListener("click", clearData);
  document.getElementById("btnVerify").addEventListener("click", verifyEmails);
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
  if (n === "verify") initVerify();
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
  info.classList.remove("hidden"); prev.classList.remove("hidden");
  rows.innerHTML = "<tr style='font-weight:600'>" + csvColumns.map(c => "<td>" + c + "</td>").join("") + "</tr>" + csvData.slice(0, 5).map(r => "<tr>" + csvColumns.map(c => "<td>" + (r[c] || "") + "</td>").join("") + "</tr>").join("");
  
  // Also show send list preview
  showSendList();
}

function showSendList() {
  const panel = document.getElementById("sendListPreview");
  const count = document.getElementById("sendListCount");
  const items = document.getElementById("sendListItems");
  if (!csvData.length) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");
  count.textContent = csvData.length + " emails prêts à être envoyés";
  items.innerHTML = csvData.slice(0, 100).map(r => 
    '<div style="padding:3px 0;border-bottom:1px solid #f1f3f4">' + (r.email || "") + '</div>'
  ).join("") + (csvData.length > 100 ? '<div style="color:#5f6368;padding:4px 0">... et ' + (csvData.length - 100) + ' de plus</div>' : "");
}

function clearCsv() {
  csvData = []; csvColumns = []; csvFileName = "";
  document.getElementById("csvInfo").classList.add("hidden");
  document.getElementById("csvPreview").classList.add("hidden");
  document.getElementById("sendListPreview").classList.add("hidden");
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

async function verifyEmails() {
  const cid = document.getElementById("sendCampaign").value;
  if (!cid) return alert("Choisissez une campagne");
  const btn = document.getElementById("btnVerify");
  btn.textContent = "⏳ Vérification en cours...";
  btn.disabled = true;

  // Get all pending emails
  const detail = await api("/api/queue/" + cid + "/detail");
  const pending = (detail || []).filter(i => i.status === "pending");
  if (!pending.length) { btn.textContent = "✅ Aucun email à vérifier"; btn.disabled = false; return; }

  const res = await api("/api/verify-emails", {
    method: "POST",
    body: JSON.stringify({ emails: pending.map(i => ({ id: i.id, email: i.email_to })) })
  });

  const invalid = (res.results || []).filter(r => !r.valid);
  btn.textContent = "🔍 Vérifier les emails en attente";
  btn.disabled = false;

  if (invalid.length) {
    alert("❌ " + invalid.length + " emails invalides marqués.\n\n" + invalid.map(r => r.email + ": " + r.reason).join("\n"));
  } else {
    alert("✅ Tous les emails semblent valides ! (" + pending.length + " vérifiés)");
  }
  refreshAll();
}

// Send loop
async function startSend(cidOverride) {
  const cid = cidOverride || document.getElementById("sendCampaign").value;
  if (!cid) return alert("Choisissez une campagne");

  // Use CSV data directly — send all at once via API
  const subject = document.getElementById("subject").value;
  const body = document.getElementById("editorBody").innerHTML;
  if (!subject) return alert("Objet requis");
  if (!csvData.length) return alert("Aucun email. Importez un CSV d'abord.");

  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; refreshAll(); return; }

  // Build recipients from CSV
  const recipients = csvData.map(r => {
    let s = subject, b = body;
    csvColumns.forEach(c => { s = s.replace(new RegExp("{"+c+"}","gi"), r[c]||""); b = b.replace(new RegExp("{"+c+"}","gi"), r[c]||""); });
    return { to: r.email, subject: s, body: b };
  });

  // Add to queue via API
  await api("/api/queue", { method: "POST", body: JSON.stringify({ campaign_id: cid, emails: recipients }) });
  
  const settings = await api("/api/settings");
  const delay = (settings.delay || 80) * 1000;
  document.getElementById("btnStart").textContent = "⏹️ Arrêter";
  document.getElementById("btnStart").className = "btn-danger";

  async function sendOne() {
    const m = new Date().getHours()*60 + new Date().getMinutes();
    const [sh,sm] = (settings.startTime||"08:00").split(":").map(Number);
    const [eh,em] = (settings.endTime||"22:00").split(":").map(Number);
    if (m < sh*60+sm || m > eh*60+em) return;
    const r = await api("/api/send-one", { method:"POST", body:JSON.stringify({ campaign_id:cid }) });
    if (r.remaining === 0) {
      clearInterval(sendTimer); sendTimer = null;
      document.getElementById("btnStart").textContent = "▶️ Démarrer l'envoi";
      document.getElementById("btnStart").className = "btn-primary";
      alert("✅ Envoi terminé !");
      clearCsv();
    } else {
      document.getElementById("btnStart").textContent = "⏹️ Arrêter ("+r.remaining+" restants)";
    }
    refreshAll();
  }
  sendOne();
  sendTimer = setInterval(sendOne, delay);
}

function clearData() {
  if (csvData.length && !confirm("Vider la liste ?")) return;
  clearCsv();
  refreshAll();
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
    if (!senders || !Array.isArray(senders)) senders = [];
    document.getElementById("modalFields").innerHTML =
      '<input id="modCampId" type="hidden" value="' + (camp ? camp.id : "") + '">' +
      '<label>Nom de la campagne</label><input id="modCampName" value="' + (camp ? camp.name : "") + '" placeholder="Ex: Relance Janvier">' +
      '<label>Expéditeur</label><select id="modCampSender">' + senders.map(s => '<option value="' + s.id + '"' + (camp && camp.sender_id === s.id ? ' selected' : '') + '>' + s.name + ' (' + s.usr + ')</option>').join("") + '</select>' +
      '<label>Objet par défaut</label><input id="modCampSubject" value="' + (camp ? camp.subject : "") + '" placeholder="Bonjour {prenom}">' +
      '<label>Message par défaut</label><div class="editor-toolbar"><button onclick="execCmdModal(\'bold\')"><b>B</b></button><button onclick="execCmdModal(\'italic\')"><i>I</i></button></div><div id="modCampBody" class="editor-body" contenteditable="true" style="min-height:100px">' + (camp ? camp.body : "") + '</div>';
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
  const q = await api("/api/queue");
  document.getElementById("campaignStatsList").innerHTML = camps.map(c => {
    const pending = (q.queue && q.queue[c.id]) ? q.queue[c.id].items : 0;
    let btn = "";
    if (pending > 0) {
      if (sendTimer) {
        btn = '<button class="btn-outline btn-sm" onclick="event.stopPropagation();stopSendCampaign(\''+c.id+'\')">⏸️ Pause</button>';
      } else {
        btn = '<button class="btn-success btn-sm" onclick="event.stopPropagation();resumeSend(\''+c.id+'\')">▶️</button>';
      }
    }
    return '<div class="camp-card" onclick="showCampaignDetail(\''+c.id+'\',\''+c.name+'\')" style="cursor:pointer">'+
      '<div style="flex:1"><div class="item-name">'+c.name+'</div>'+
      '<div style="display:flex;gap:14px;font-size:13px;color:#5f6368;margin-top:4px">'+
      '<span>📤 '+(c.sent||0)+'</span><span>👁 '+(c.opens||0)+'</span><span>🔗 '+(c.clicks||0)+'</span>'+
      (pending > 0 ? '<span style="color:#d97706">⏳ '+pending+' en attente</span>' : '')+
      '</div></div>'+btn+'</div>';
  }).join("");

  // Queue status + update button
  const div = document.getElementById("sendingStatus");
  const entries = Object.entries(q.queue || {});
  const btn = document.getElementById("btnStart");

  if (!entries.length) {
    div.innerHTML = "";
    if (!sendTimer) { btn.textContent = "▶️ Démarrer"; btn.className = "btn-primary"; }
  } else {
    const activeEntries = entries.filter(([, info]) => info.items > 0);
    if (activeEntries.length) {
      div.innerHTML = activeEntries.map(([cid, info]) =>
        '<div class="sending-bar"><span><b>' + cid + '</b> · ' + info.items + ' en attente</span>' +
        '<div style="display:flex;gap:6px;align-items:center">' +
        (sendTimer ? '<span style="color:#0d904f;font-size:12px">● En cours</span>' : '<span style="color:#5f6368;font-size:12px">○ En pause</span>') +
        (sendTimer
          ? '<button class="btn-outline btn-sm" onclick="stopSend()">⏹️ Arrêter</button>'
          : '<button class="btn-success btn-sm" onclick="resumeSend(\'' + cid + '\')">▶️ Reprendre</button>') +
        '</div></div>'
      ).join("");
      if (!sendTimer) { btn.textContent = "▶️ Reprendre"; btn.className = "btn-success"; }
      else { btn.textContent = "⏹️ Arrêter"; btn.className = "btn-danger"; }
    }
  }
}

// Editor
function execCmd(cmd) { document.execCommand(cmd, false, null); document.getElementById("editorBody").focus(); }
function insertLink() { const url = prompt("URL:"); if (url) document.execCommand("createLink", false, url); }
function insertImage(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(ev) {
    document.execCommand("insertImage", false, ev.target.result);
    document.getElementById("editorBody").focus();
  };
  reader.readAsDataURL(file);
  e.target.value = "";
}
window.execCmd = execCmd; window.insertLink = insertLink; window.insertImage = insertImage; window.execCmdModal = execCmdModal;

// Global helpers for inline buttons in Stats tab
async function resumeSend(cid) {
  await startSend(cid);
}
async function stopSend() {
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
  document.getElementById("btnStart").textContent = "▶️ Reprendre";
  document.getElementById("btnStart").className = "btn-success";
  refreshAll();
}
window.resumeSend = resumeSend;
window.stopSend = stopSend;

async function stopSendCampaign(cid) {
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
  document.getElementById("btnStart").textContent = "▶️ Démarrer l'envoi";
  document.getElementById("btnStart").className = "btn-primary";
  refreshAll();
}
window.stopSendCampaign = stopSendCampaign;

async function showCampaignDetail(cid, name) {
  document.getElementById("detailTitle").textContent = "📋 " + name;
  document.getElementById("campaignDetail").classList.remove("hidden");

  const items = await api("/api/queue/" + cid + "/detail");
  const content = document.getElementById("detailContent");

  if (!items || !items.length) {
    content.innerHTML = '<p style="color:#5f6368">Aucun email dans cette campagne.</p>';
    return;
  }

  const statusIcon = { sent: "✅", pending: "⏳", error: "❌" };
  const statusColor = { sent: "#0d904f", pending: "#5f6368", error: "#d93025" };

  content.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
    '<tr style="text-align:left;color:#5f6368;font-size:11px"><th style="padding:6px 8px;border-bottom:1px solid #e8eaed">Destinataire</th><th style="padding:6px 8px;border-bottom:1px solid #e8eaed">Statut</th><th style="padding:6px 8px;border-bottom:1px solid #e8eaed">Date</th></tr>' +
    items.map(i =>
      '<tr style="font-size:12px">' +
      '<td style="padding:6px 8px;border-bottom:1px solid #f1f3f4">' + i.email_to + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #f1f3f4;color:' + (statusColor[i.status] || "#5f6368") + '">' + (statusIcon[i.status] || "?") + " " + i.status + '</td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #f1f3f4;color:#5f6368;font-size:11px">' + (i.created_at ? new Date(i.created_at).toLocaleString("fr") : "") + '</td>' +
      '</tr>'
    ).join("") + '</table>';
}
window.showCampaignDetail = showCampaignDetail;

// === Verify Tab ===
function initVerify() {
  const drop = document.getElementById("verifyCsvDrop"), inp = document.getElementById("verifyCsvInput");
  drop.onclick = () => inp.click();
  drop.ondragover = e => e.preventDefault();
  drop.ondrop = e => { e.preventDefault(); handleVerifyFile(e.dataTransfer.files[0]); };
  inp.onchange = e => { if (e.target.files[0]) handleVerifyFile(e.target.files[0]); };
  document.getElementById("btnStartVerify").onclick = () => startVerify("dns");
  document.getElementById("btnStartSmtpVerify").onclick = () => startVerify("smtp");
  document.getElementById("btnExportVerify").onclick = exportVerify;
}

function handleVerifyFile(file) {
  const r = new FileReader();
  r.onload = e => {
    const emails = [];
    const lines = e.target.result.split("\n");
    const start = lines[0] && !lines[0].includes("@") ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const match = lines[i].match(/([\w.+-]+@[\w-]+\.[\w.-]+)/);
      if (match) emails.push(match[1].toLowerCase().trim());
    }
    const unique = [...new Set(emails)];
    document.getElementById("verifyPaste").value = unique.join("\n");
    document.getElementById("verifyInfo").classList.remove("hidden");
    document.getElementById("verifyInfo").textContent = "📄 " + file.name + " · " + unique.length + " emails";
  };
  r.readAsText(file);
}

async function startVerify(mode) {
  const raw = document.getElementById("verifyPaste").value;
  const emails = [...new Set(raw.split(/[\n,;\s]+/).map(e => e.trim()).filter(e => e.includes("@")))];

  if (!emails.length) return alert("Aucun email");

  const progress = document.getElementById("verifyProgress");
  const btn = mode === "smtp" ? document.getElementById("btnStartSmtpVerify") : document.getElementById("btnStartVerify");
  const expBtn = document.getElementById("btnExportVerify");

  btn.textContent = "⏳ Vérification..."; btn.disabled = true;
  progress.classList.remove("hidden");
  verifyResults = [];

  for (let i = 0; i < emails.length; i += 200) {
    const batch = emails.slice(i, i + 200).map(e => ({ id: null, email: e }));
    progress.textContent = "Vérification " + (i + 1) + "–" + Math.min(i + 200, emails.length) + "/" + emails.length;
    const res = await api("/api/verify-emails", { method: "POST", body: JSON.stringify({ emails: batch, mode }) });
    verifyResults.push(...(res.results || []));
  }

  const ok = verifyResults.filter(r => r.valid).length;
  const ko = verifyResults.filter(r => !r.valid).length;
  btn.textContent = "🔍 Relancer"; btn.disabled = false;
  progress.textContent = "✅ " + ok + " bons / ❌ " + ko + " invalides sur " + emails.length;
  expBtn.disabled = false;
  expBtn.textContent = "📥 Exporter CSV (" + ok + " bons, " + ko + " invalides)";
}

function exportVerify() {
  if (!verifyResults.length) return;
  const csv = "email,statut,raison\n" + verifyResults.map(r => r.email + "," + (r.valid ? "Bon" : "Pas bon") + "," + (r.reason || "")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "emails_verifies.csv"; a.click();
}

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
