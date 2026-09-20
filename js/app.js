const API_BASE = "https://varsity-portal-api.onrender.com";
let ws = null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentSelectedFolder = "/";
let allFiles = [];
let allFolders = [];
let allNotices = [];
let allDirectoryUsers = [];
let currentSortMode = 'name_asc';
let activeContextItem = null;
let activePreviewItem = null;
let activeNoticeTarget = null;
const pdfCache = {};
let isGuestMode = false;
let currentShareId = null;
let guestToken = null;
let guestFolderPath = "";
let sharedFiles = [];
let originalViewportContent = "";
let guestCurrentPath = "";
let originalDocumentTitle = "";
let currentImageScale = 1.0;

// ==========================================
// PUSH NOTIFICATION LOGIC
// ==========================================
const PUBLIC_VAPID_KEY = "BFxR3WqfhTrn0OlGxYolBvLimkLGZEPjFRO6Ve71QqkC3CT_leszW3ADP2QosgzPSPVPN6W1SQgeLsc762EDU7g";

// Convert VAPID key for subscription
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Ask for permission and subscribe
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
  }

  const registration = await navigator.serviceWorker.ready;
  try {
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY)
    });
    
    // Send subscription to backend
    await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentUser.token}`
      },
      body: JSON.stringify(subscription)
    });
    console.log("Push Notification Subscribed!");
  } catch (e) {
    console.error("Push subscription failed", e);
  }
}


// ==========================================
// PWA INSTALL LOGIC
// ==========================================
let deferredInstallPrompt = null;

// Check if app is running in standalone mode (already installed)
function isRunningAsPwa() {
  return window.matchMedia('(display-mode: standalone)').matches 
      || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  
  if (!isRunningAsPwa()) {
    const hasSeenPopup = localStorage.getItem('pwa_popup_seen');
    const headerBtn = document.getElementById('pwaInstallBtn');
    const popup = document.getElementById('pwaInstallPopup');
    
    if (!hasSeenPopup) {
      // Show the beautiful popup for first-time visitors
      if (popup) popup.classList.remove('hidden');
    } else {
      // If popup was dismissed earlier, only show the header button
      if (headerBtn) {
        headerBtn.classList.remove('hidden');
        headerBtn.classList.add('flex');
      }
    }
  }
});

// Hide popup and remember user choice
function dismissPwaPopup() {
  localStorage.setItem('pwa_popup_seen', 'true');
  const popup = document.getElementById('pwaInstallPopup');
  if (popup) popup.classList.add('hidden');
  
  // Show header button instead
  const headerBtn = document.getElementById('pwaInstallBtn');
  if (headerBtn) {
    headerBtn.classList.remove('hidden');
    headerBtn.classList.add('flex');
  }
}

function triggerPwaInstall() {
  if (!deferredInstallPrompt) {
    showToast('Install option not available on this browser', 'info');
    return;
  }
  
  // Hide popup and save choice before prompting
  dismissPwaPopup();
  
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then((result) => {
    if (result.outcome === 'accepted') {
      showToast('App installed successfully! 🎉', 'success');
      document.getElementById('pwaInstallBtn').classList.add('hidden');
    }
    deferredInstallPrompt = null;
  });
}

// Hide install button completely once installed
window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.classList.add('hidden');
  deferredInstallPrompt = null;
});

// GLOBAL API SECURITY INTERCEPTOR
const originalFetch = window.fetch;
window.fetch = async function(resource, config) {
  // Add token for backend
  if (typeof resource === 'string' && resource.startsWith(API_BASE)) {
    config = config || {};
    config.headers = config.headers || {};
    
    // add token for logged in users
    if (currentUser && currentUser.token && !isGuestMode) {
      config.headers['Authorization'] = `Bearer ${currentUser.token}`;
    }
  }
  return originalFetch(resource, config);
};

let presenceData = [];
let currentPresenceTab = 'online';

function getOnlineStatus(last_seen) {
  if (!last_seen) return { online: false, label: "Never seen" };
  const diff = (Date.now() - new Date(last_seen)) / 1000 / 60; // minutes
  if (diff <= 5) return { online: true, label: "Online now" };
  return { online: false, label: formatLastSeen(last_seen) };
}

function formatLastSeen(ts) {
  const diff = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

async function openOnlineUsersModal() {
  showAnimatedModal("onlineUsersModal");
  await refreshPresenceData();
}

async function refreshPresenceData() {
  try {
    const res = await fetch(`${API_BASE}/presence/list`);
    presenceData = await res.json();
    renderPresenceList();
    
    const onlineCount = presenceData.filter(u => getOnlineStatus(u.last_seen).online).length;
    document.getElementById("onlineCountBadge").innerText = onlineCount;
    document.getElementById("onlineTabCount").innerText = onlineCount;
  } catch(e) {}
}

function switchPresenceTab(tab) {
  currentPresenceTab = tab;
  const onlineBtn = document.getElementById("tabOnlineBtn");
  const lastSeenBtn = document.getElementById("tabLastSeenBtn");
  
  if (tab === 'online') {
    onlineBtn.className = "flex-1 py-2.5 font-semibold text-emerald-600 border-b-2 border-emerald-500";
    lastSeenBtn.className = "flex-1 py-2.5 text-slate-400 hover:text-slate-600";
  } else {
    lastSeenBtn.className = "flex-1 py-2.5 font-semibold text-blue-600 border-b-2 border-blue-500";
    onlineBtn.className = "flex-1 py-2.5 text-slate-400 hover:text-slate-600";
  }
  renderPresenceList();
}

function renderPresenceList() {
  const container = document.getElementById("onlineUsersContainer");
  
  let users = presenceData.map(u => ({
    ...u,
    status: getOnlineStatus(u.last_seen)
  }));

  if (currentPresenceTab === 'online') {
    users = users.filter(u => u.status.online);
    if (users.length === 0) {
      container.innerHTML = `<div class="text-center py-10 text-slate-400">No one is online right now.</div>`;
      return;
    }
  } else {
    users = users.filter(u => !u.status.online).sort((a, b) => {
      if (!a.last_seen) return 1;
      if (!b.last_seen) return -1;
      return new Date(b.last_seen) - new Date(a.last_seen);
    });
    if (users.length === 0) {
      container.innerHTML = `<div class="text-center py-10 text-slate-400">No offline users.</div>`;
      return;
    }
  }

  container.innerHTML = users.map(u => {
    const isMe = currentUser && u.student_id === currentUser.student_id;
    return `
      <div class="flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
            ${u.status.online ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">
            ${u.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div class="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
              ${u.name} ${isMe ? '<span class="text-[9px] bg-blue-100 dark:bg-blue-900 text-blue-600 px-1.5 rounded font-bold">You</span>' : ''}
            </div>
            <div class="text-[10px] text-slate-400 font-mono">${u.student_id}</div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <span class="h-2 w-2 rounded-full ${u.status.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}"></span>
          <span class="text-[10px] font-mono ${u.status.online ? 'text-emerald-500' : 'text-slate-400'}">${u.status.label}</span>
        </div>
      </div>
    `;
  }).join('');
}

// PDF Rendering Global State
let currentPdfDoc = null;
let currentPdfScale = 1.0;
let defaultFitScale = 1.0;

if (window['pdfjs-dist/build/pdf']) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function showAnimatedModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("modal-hidden");
}

function hideAnimatedModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("modal-hidden");
}

function showToast(message, type = "info", subtitle = "") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  let border = type === "success" ? "border-emerald-500 text-emerald-500" : (type === "error" ? "border-rose-500 text-rose-500" : "border-blue-500 text-blue-500");
  
  toast.className = `flex flex-col gap-0.5 px-4 py-3 rounded-xl border bg-white dark:bg-slate-900 shadow-xl text-xs font-medium ${border}`;
  toast.innerHTML = `
    <div class="flex items-center gap-2">
      <i class="fa-solid ${type === 'success' ? 'fa-check' : (type === 'error' ? 'fa-exclamation' : 'fa-info')}"></i> 
      <span>${message}</span>
    </div>
    ${subtitle ? `<span class="text-[10px] text-slate-400 font-normal pl-5 line-clamp-3">${subtitle}</span>` : ''}
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function isAdmin() {
  return currentUser && (currentUser.role === 'super_admin' || currentUser.student_id === '2510376101');
}

function isPrimarySuperAdmin() {
  return currentUser && currentUser.student_id === '2510376101';
}

function isApproved() {
  return currentUser && (currentUser.status === 'approved' || isPrimarySuperAdmin());
}

function isFileBanned() {
  if (!currentUser || !currentUser.file_banned_until) return false;
  return new Date() < new Date(currentUser.file_banned_until);
}

function hasFolderPermission(folderPath) {
  if (isPrimarySuperAdmin()) return true;
  if (!folderPath || folderPath === '/') return true;

  const targetFolderObj = allFolders.find(f => f.folder_name === folderPath);
  if (!targetFolderObj) return true;

  if (targetFolderObj.allowed_students && targetFolderObj.allowed_students.length > 0) {
    return currentUser && targetFolderObj.allowed_students.includes(currentUser.student_id);
  }
  if (targetFolderObj.is_locked) {
    return false;
  }
  return true;
}

async function syncUserRole() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/auth/check-role/${currentUser.student_id}`);
    if (res.ok) {
      const data = await res.json();
      currentUser.role = data.role;
      currentUser.status = data.status;
      currentUser.reg_no = data.reg_no;
      currentUser.chat_banned_until = data.chat_banned_until;
      currentUser.file_banned_until = data.file_banned_until;
      localStorage.setItem("user", JSON.stringify(currentUser));
    }
  } catch(e) {}
}


function startPresenceHeartbeat() {
  if (!currentUser) return;
  
  async function ping() {
    // Check if user is admin and ghost mode is enabled
    if (isAdmin() && localStorage.getItem("ghostMode") === "true") {
      return; 
    }
    
    try {
      await fetch(`${API_BASE}/presence/heartbeat`, { method: "POST" });
    } catch(e) {}
  }
  
  ping(); // Instant ping on load
  setInterval(ping, 2 * 60 * 1000); // Ping every 2 minutes
}

async function renderPortalView() {
  // --- Auto Open Preview from URL (For New Tab feature) ---
  const urlParams = new URLSearchParams(window.location.search);
  const pMsgId = urlParams.get('preview_msg_id');
  const pName = urlParams.get('preview_name');
  if (pMsgId && pName) {
    setTimeout(() => openPreview(pName, pMsgId), 600); // open preview after loading ui
  }
  
  restoreFolderFromUrl();
  if (isGuestMode) return;

  await syncUserRole();

  const guestView = document.getElementById("guestLandingView");
  const authView = document.getElementById("authenticatedView");
  const adminDropzone = document.getElementById("adminDropzoneArea");
  const adminSidebar = document.getElementById("adminSidebarSection");
  const adminActionTrash = document.getElementById("adminActionTrashBtn");
  const adminToolbarTrash = document.getElementById("adminToolbarTrashBtn");
  const navAuth = document.getElementById("navAuthSection");
  const sidebarBtn = document.getElementById("sidebarToggleBtn");
  const clearChatBtn = document.getElementById("clearChatBtn");
  const adminClearNotices = document.getElementById("adminClearNoticesBtn");
  const adminNoticeComposer = document.getElementById("adminNoticeComposer");

  if (isGuestMode) return;
  if (currentUser) {
    guestView.classList.add("hidden");
    authView.classList.remove("hidden");
    sidebarBtn.classList.remove("hidden");

    navAuth.innerHTML = `
      <span class="text-xs text-slate-500 hidden sm:inline font-mono">${currentUser.name} (${isAdmin() ? 'Admin' : 'Student'})</span>
      <button onclick="handleLogout()" class="border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
        <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
      </button>
    `;

    if (isAdmin()) {
      adminDropzone.classList.remove("hidden");
      adminSidebar.classList.remove("hidden");
      adminActionTrash.classList.remove("hidden");
      adminToolbarTrash.classList.remove("hidden");
      adminClearNotices.classList.remove("hidden");
      adminNoticeComposer.classList.remove("hidden");
    } else {
      adminDropzone.classList.add("hidden");
      adminSidebar.classList.add("hidden");
      adminActionTrash.classList.add("hidden");
      adminToolbarTrash.classList.add("hidden");
      adminClearNotices.classList.add("hidden");
      adminNoticeComposer.classList.add("hidden");
    }

    if (isPrimarySuperAdmin()) {
      clearChatBtn.classList.remove("hidden");
    } else {
      clearChatBtn.classList.add("hidden");
    }

    await loadFolders();
    await loadFiles();
    restoreFolderFromUrl();
    sortFiles(currentSortMode);
    initWebSocket();
    startPresenceHeartbeat();
    checkUnseenNotices();
    loadDynamicTools();
    // Subscribe to push notifications
    subscribeToPush();
  } else {
    guestView.classList.remove("hidden");
    authView.classList.add("hidden");
    sidebarBtn.classList.add("hidden");

    navAuth.innerHTML = `
      <button onclick="toggleAuthModal(true, false)" class="bg-blue-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg shadow-sm">
        Login
      </button>
    `;
  }
}

function toggleAuthModal(show, isRegister = false) { 
  if (show) {
    toggleAuthForms(isRegister ? 'register' : 'login');
    showAnimatedModal("authModal");
  } else {
    hideAnimatedModal("authModal");
  }
}

function toggleAuthForms(mode) {
  document.getElementById("loginSection").classList.toggle("hidden", mode !== 'login');
  document.getElementById("registerSection").classList.toggle("hidden", mode !== 'register');
  document.getElementById("forgotSection").classList.toggle("hidden", mode !== 'forgot');
}

function showForgotPasswordForm() {
  toggleAuthForms('forgot');
  document.getElementById("fpStep1").classList.remove("hidden");
  document.getElementById("fpStep2").classList.add("hidden");
}

async function fetchRecoveryQuestion() {
  const sid = document.getElementById("fpStudentId").value.trim();
  if (!sid) return showToast("Enter Student ID", "error");

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password/get-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: sid })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    document.getElementById("fpQuestionLabel").innerText = `Question: ${data.question}`;
    document.getElementById("fpStep1").classList.add("hidden");
    document.getElementById("fpStep2").classList.remove("hidden");
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function executePasswordReset() {
  const student_id = document.getElementById("fpStudentId").value.trim();
  const answer = document.getElementById("fpAnswer").value.trim();
  const new_password = document.getElementById("fpNewPass").value.trim();

  if (!answer || !new_password) return showToast("Fill all fields", "error");

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id, answer, new_password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    showToast(data.message, "success");
    toggleAuthForms('login');
  } catch(err) {
    showToast(err.message, "error");
  }
}

function openSettingsModal() {
  if (!currentUser) return showToast("Please login first", "error");
  switchSettingsTab('pass');
  document.getElementById("setCurPass").value = "";
  document.getElementById("setNewPass").value = "";
  document.getElementById("setSecCurPass").value = "";
  document.getElementById("setNewQ").value = "";
  document.getElementById("setNewA").value = "";

  const ghostContainer = document.getElementById("adminGhostModeContainer");
  if (ghostContainer) {
    if (isAdmin()) {
      ghostContainer.classList.remove("hidden");
      document.getElementById("ghostModeToggle").checked = localStorage.getItem("ghostMode") === "true";
    } else {
      ghostContainer.classList.add("hidden");
    }
  }
  
  showAnimatedModal("settingsModal");
}

function closeSettingsModal() {
  hideAnimatedModal("settingsModal");
}
// Toggle Admin Ghost Mode
function toggleGhostMode(el) {
  localStorage.setItem("ghostMode", el.checked);
  showToast(el.checked ? "Ghost Mode ON: You are now hidden" : "Ghost Mode OFF: You are visible", "success");
}


function switchSettingsTab(tab) {
  const passTab = document.getElementById("setTabPass");
  const secTab = document.getElementById("setTabSec");
  const passBtn = document.getElementById("setTabPassBtn");
  const secBtn = document.getElementById("setTabSecBtn");

  if (tab === 'pass') {
    passTab.classList.remove("hidden");
    secTab.classList.add("hidden");
    passBtn.className = "px-3 py-1 font-semibold text-blue-600 border-b-2 border-blue-600";
    secBtn.className = "px-3 py-1 text-slate-400 hover:text-slate-600";
  } else {
    passTab.classList.add("hidden");
    secTab.classList.remove("hidden");
    secBtn.className = "px-3 py-1 font-semibold text-blue-600 border-b-2 border-blue-600";
    passBtn.className = "px-3 py-1 text-slate-400 hover:text-slate-600";
  }
}

async function saveNewPassword() {
  const current_password = document.getElementById("setCurPass").value.trim();
  const new_password = document.getElementById("setNewPass").value.trim();

  if (!current_password || !new_password) return showToast("Fill all fields", "error");

  try {
    const res = await fetch(`${API_BASE}/user/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: currentUser.student_id,
        current_password,
        new_password
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    showToast(data.message, "success");
    closeSettingsModal();
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function saveNewSecurityQuestion() {
  const current_password = document.getElementById("setSecCurPass").value.trim();
  const question = document.getElementById("setNewQ").value.trim();
  const answer = document.getElementById("setNewA").value.trim();

  if (!current_password || !question || !answer) return showToast("Fill all fields", "error");

  try {
    const res = await fetch(`${API_BASE}/user/update-security-question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id: currentUser.student_id,
        current_password,
        question,
        answer
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    showToast(data.message, "success");
    closeSettingsModal();
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function handleLogin() {
  const student_id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPass").value.trim();
  if (!student_id || !password) return showToast("Enter credentials", "error");

  const btn = document.getElementById("loginSubmitBtn");
  const text = document.getElementById("loginText");
  const spin = document.getElementById("loginSpin");
  btn.disabled = true; text.classList.add("hidden"); spin.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ student_id, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    
    currentUser = data;
    localStorage.setItem("user", JSON.stringify(data));
    toggleAuthModal(false);
    showToast(`Welcome back, ${data.name}!`, "success");
    renderPortalView();
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false; text.classList.remove("hidden"); spin.classList.add("hidden");
  }
}

async function handleRegister() {
  const name = document.getElementById("regName").value.trim();
  const student_id = document.getElementById("regId").value.trim();
  const reg_no = document.getElementById("regNo").value.trim();
  const q1 = document.getElementById("secQ1").value.trim();
  const a1 = document.getElementById("secA1").value.trim();

  if (!name || !student_id || !reg_no || !q1 || !a1) return showToast("Fill all fields", "error");

  const btn = document.getElementById("regSubmitBtn");
  const text = document.getElementById("regText");
  const spin = document.getElementById("regSpin");
  btn.disabled = true; text.classList.add("hidden"); spin.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ 
        name, 
        student_id, 
        reg_no,
        security_questions: [{ question: q1, answer: a1 }] 
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 400 && data.detail && data.detail.includes("already registered")) {
        throw new Error("Student ID already registered! Please login.");
      }
      throw new Error(data.detail || "Registration failed");
    }
    showToast(data.message, "success");
    toggleAuthForms('login');
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false; text.classList.remove("hidden"); spin.classList.add("hidden");
  }
}

function handleLogout() {
  currentUser = null;
  localStorage.removeItem("user");
  renderPortalView();
  showToast("Logged out successfully", "info");
}

function toggleSidebar(show) { 
  if (!currentUser) return;
  if (show) showAnimatedModal("sideDrawer");
  else hideAnimatedModal("sideDrawer");
}

function toggleDropdown(id) {
  const drop = document.getElementById(id);
  drop.classList.toggle("hidden");
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('#actionsDropdownMenu') && !e.target.closest('button[onclick*="actionsDropdownMenu"]')) {
    document.getElementById("actionsDropdownMenu").classList.add("hidden");
  }
  if (!e.target.closest('#sortDropdownMenu') && !e.target.closest('button[onclick*="sortDropdownMenu"]')) {
    document.getElementById("sortDropdownMenu").classList.add("hidden");
  }
  if (!e.target.closest('#itemActionMenu') && !e.target.closest('button[onclick*="openItemActionMenu"]')) {
    document.getElementById("itemActionMenu").classList.add("hidden");
  }
});

async function loadDynamicTools() {
  const container = document.getElementById("dynamicToolsContainer");
  const defaultTools = [
    { file: "cgpa.html", defaultTitle: "CGPA / GPA Suite" },
    { file: "ru-result.html", defaultTitle: "RU Result Portal" }
  ];

  container.innerHTML = `<span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">Academic Tools</span>`;

  for (let tool of defaultTools) {
    let title = tool.defaultTitle;
    try {
      const res = await fetch(`tools/${tool.file}`);
      if (res.ok) {
        const text = await res.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        if (doc.querySelector('title') && doc.querySelector('title').innerText.trim()) {
          title = doc.querySelector('title').innerText.trim();
        }
      }
    } catch(e) {}

    container.innerHTML += `
      <a href="tools/${tool.file}" class="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300">
        <i class="fa-solid fa-wrench text-indigo-500"></i>
        <span>${title}</span>
      </a>
    `;
  }
}

async function loadFolders() {
  if (!currentUser) return;

  // Check if offline, load from local storage
  if (!navigator.onLine) {
    allFolders = getFromLocalStorage("cached_folders");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/folders/list?t=${Date.now()}`);
    allFolders = await res.json();
    
    allFolders = allFolders.map(f => {
      let n = f.folder_name;
      if (!n.startsWith('/')) n = '/' + n;
      return { ...f, folder_name: n };
    });

    // Save to local storage for offline use
    saveToLocalStorage("cached_folders_time", Date.now());
    saveToLocalStorage("cached_folders", allFolders);

    const moveSelect = document.getElementById("moveFolderSelect");
    if(moveSelect) {
      moveSelect.innerHTML = `<option value="/">Home (/)</option>`;
      allFolders.forEach(f => {
        if (f.folder_name !== '/') {
          moveSelect.innerHTML += `<option value="${f.folder_name}">${f.folder_name}</option>`;
        }
      });
    }
  } catch(e) { 
    console.error(e);
    // Fallback to local storage if API fails
    allFolders = getFromLocalStorage("cached_folders");
  }
}


function selectFolder(path) {
  const target = path.startsWith('/') ? path : '/' + path;
  if (!hasFolderPermission(target)) {
    return showToast("Access Denied: You do not have permission to view this folder.", "error");
  }

  currentSelectedFolder = (target !== '/' && target.endsWith('/')) ? target.slice(0, -1) : target;
  document.getElementById("activeFolderPathText").innerText = `Folder: ${currentSelectedFolder}`;
  
  // URL update করো
  const newUrl = currentSelectedFolder === '/' ? '/' : '/?folder=' + encodeURIComponent(currentSelectedFolder);
  history.pushState({ folder: currentSelectedFolder }, '', newUrl);
  
  renderFilesTable();
}

function goToParentFolder() {
  if (currentSelectedFolder === '/') return;
  const parts = currentSelectedFolder.split('/').filter(Boolean);
  parts.pop();
  const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
  selectFolder(parent);
}

function openFolderModal() { 
  if (!isAdmin()) return showToast("Only Admin can create folders", "error");
  document.getElementById("folderModalSubText").innerText = `Creating inside: ${currentSelectedFolder}`;
  document.getElementById("newFolderName").value = "";
  showAnimatedModal("folderModal"); 
}
function closeFolderModal() { hideAnimatedModal("folderModal"); }

async function handleCreateFolder() {
  let name = document.getElementById("newFolderName").value.trim();
  if (!name) return showToast("Enter folder name", "error");
  name = name.replace(/^\/+|\/+$/g, '');
  let targetPath = currentSelectedFolder === '/' ? `/${name}` : `${currentSelectedFolder}/${name}`;

  const formData = new FormData();
  formData.append("folder_name", targetPath);

  try {
    const res = await fetch(`${API_BASE}/folders/create`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    showToast("Folder created!", "success");
    closeFolderModal();
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function uploadSelectedFiles(input) {
  if (!isAdmin()) return showToast("Only Admin can upload files", "error");
  if (!input.files || input.files.length === 0) return;
  
  const filesList = Array.from(input.files);
  const totalFiles = filesList.length;

  const progressBar = document.getElementById("uploadProgressBar");
  const progressText = document.getElementById("uploadProgressText");

  showAnimatedModal("uploadProgressModal");

  let uploadedCount = 0;
  let uploadedFileNames = []; // List of successfully uploaded files

  for (let i = 0; i < totalFiles; i++) {
    const file = filesList[i];
    progressText.innerText = `Uploading (${i + 1}/${totalFiles}): ${file.name}`;
    progressBar.style.width = `${Math.round(((i) / totalFiles) * 100)}%`;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", currentSelectedFolder);
    formData.append("uploader_name", currentUser ? currentUser.name : "Admin");
    formData.append("skip_notice", "true"); // Skip individual notice for each file

    try {
      const res = await fetch(`${API_BASE}/slides/upload`, {
        method: "POST",
        body: formData
      });
      if (res.ok) {
        const jsonRes = await res.json();
        if (jsonRes.file) {
          const newF = jsonRes.file;
          newF.folder_path = (newF.folder_path && newF.folder_path.startsWith('/')) ? newF.folder_path : '/' + (newF.folder_path || '');
          allFiles.unshift(newF);
          renderFilesTable();
          uploadedFileNames.push(file.name); // Add the file to the uploaded list
        }
        uploadedCount++;
      }
    } catch(err) {
      console.error(err);
    }
  }

  // Send a single batch notice for all files after the loop finishes
  if (uploadedFileNames.length > 0) {
    try {
      await fetch(`${API_BASE}/notices/create-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_names: uploadedFileNames,
          folder_path: currentSelectedFolder,
          uploader_name: currentUser ? currentUser.name : "Admin"
        })
      });
    } catch(e) { console.error("Batch notice failed", e); }
  }

  progressBar.style.width = "100%";
  hideAnimatedModal("uploadProgressModal");
  input.value = "";
  showToast(`Successfully uploaded ${uploadedCount} of ${totalFiles} files!`, "success");
  
  await loadFiles();
  sortFiles(currentSortMode);
}

async function loadFiles() {
  if (!currentUser) return;

  // Check if offline, load from local storage
  if (!navigator.onLine) {
    allFiles = getFromLocalStorage("cached_files");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/slides/list?t=${Date.now()}`);
    const data = await res.json();
    
    allFiles = data.map(f => {
      let p = f.folder_path || '/';
      if (!p.startsWith('/')) p = '/' + p;
      return { ...f, folder_path: p };
    });

    // Save to local storage for offline use
    saveToLocalStorage("cached_files_time", Date.now());
    saveToLocalStorage("cached_files", allFiles);

  } catch(e) { 
    console.error(e);
    // Fallback to local storage if API fails
    allFiles = getFromLocalStorage("cached_files");
  }
}


function sortFiles(type) {
  currentSortMode = type;
  const label = document.getElementById("currentSortLabel");

  const sortFn = (a, b, isFolder = false) => {
    const nameA = (isFolder ? (a.folder_name || '').split('/').filter(Boolean).pop() : a.file_name) || '';
    const nameB = (isFolder ? (b.folder_name || '').split('/').filter(Boolean).pop() : b.file_name) || '';

    if (type === 'name_asc') return nameA.localeCompare(nameB);
    if (type === 'name_desc') return nameB.localeCompare(nameA);
    if (type === 'newest') return new Date(b.created_at) - new Date(a.created_at);
    if (type === 'oldest') return new Date(a.created_at) - new Date(b.created_at);
    if (type === 'largest') return (b.file_size || 0) - (a.file_size || 0);
    if (type === 'smallest') return (a.file_size || 0) - (b.file_size || 0);
    return 0;
  };

  allFolders.sort((a, b) => sortFn(a, b, true));
  allFiles.sort((a, b) => sortFn(a, b, false));

  if (type === 'name_asc') label.innerText = "Name A - Z";
  if (type === 'name_desc') label.innerText = "Name Z - A";
  if (type === 'newest') label.innerText = "Newest";
  if (type === 'oldest') label.innerText = "Oldest";
  if (type === 'largest') label.innerText = "Largest";
  if (type === 'smallest') label.innerText = "Smallest";

  renderFilesTable();
}

function renderFilesTable() {
  const container = document.getElementById("fileTableContent");
  
  if (!isApproved()) {
    container.innerHTML = `<div class="text-center py-12 text-amber-500 font-semibold">Your account is currently PENDING approval from administrator.</div>`;
    return;
  }

  if (isFileBanned()) {
    container.innerHTML = `<div class="text-center py-12 text-rose-500 font-medium">Your account is currently restricted from viewing files.</div>`;
    return;
  }

  let parentRow = "";
  if (currentSelectedFolder !== '/') {
    parentRow = `
      <div onclick="goToParentFolder()" class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
        <div class="col-span-8 md:col-span-9 flex items-center gap-3 overflow-hidden">
          <i class="fa-solid fa-arrow-turn-up rotate-90 text-blue-600 font-bold text-sm"></i>
          <span class="font-bold text-sm text-slate-800 dark:text-slate-100">..</span>
          <span class="text-[11px] text-slate-400 font-normal">(Parent directory)</span>
        </div>
        <div class="col-span-4 md:col-span-3 flex items-center justify-end text-slate-400 font-mono text-[11px]">
          <span>Up</span>
        </div>
      </div>
    `;
  }

  const currentPrefix = currentSelectedFolder === '/' ? '/' : currentSelectedFolder + '/';
  
  const childFolders = allFolders.filter(f => {
    if (f.folder_name === '/') return false;
    if (!f.folder_name.startsWith(currentPrefix)) return false;
    
    if (f.allowed_students && f.allowed_students.length > 0 && !isPrimarySuperAdmin()) {
      if (!currentUser || !f.allowed_students.includes(currentUser.student_id)) return false;
    } else if (f.is_locked && !isPrimarySuperAdmin()) {
      return false;
    }

    const remainder = f.folder_name.slice(currentPrefix.length);
    return remainder.length > 0 && !remainder.includes('/');
  });

  const foldersMarkup = childFolders.map(f => {
    const displayName = f.folder_name.split('/').filter(Boolean).pop();
    const isRestricted = f.allowed_students && f.allowed_students.length > 0;

    return `
      <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition border-b border-slate-100 dark:border-slate-800">
        <div onclick="selectFolder('${f.folder_name}')" class="col-span-8 md:col-span-9 flex items-center gap-3 cursor-pointer">
          <i class="fa-solid ${isRestricted ? 'fa-folder-lock text-indigo-500' : (f.is_locked ? 'fa-folder-closed text-rose-500' : 'fa-folder text-amber-500')} text-base"></i>
          <span class="font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 break-all">${displayName}</span>
          ${isRestricted ? '<span class="text-[9px] bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-bold uppercase">Restricted</span>' : ''}
        </div>
        <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono text-[11px]">
          <span>Folder</span>
          <button onclick="openItemActionMenu(event, '${f.id}', null, '${f.folder_name}', true)" class="hover:text-slate-600 p-1">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  const filteredFiles = allFiles.filter(f => {
    if (f.folder_path !== currentSelectedFolder) return false;
    const currentFolderObj = allFolders.find(x => x.folder_name === currentSelectedFolder);
    if (currentFolderObj && currentFolderObj.allowed_students && currentFolderObj.allowed_students.length > 0 && !isPrimarySuperAdmin()) {
      if (!currentUser || !currentFolderObj.allowed_students.includes(currentUser.student_id)) return false;
    } else if (currentFolderObj && currentFolderObj.is_locked && !isPrimarySuperAdmin()) {
      return false;
    }
    return true;
  });

  const filesMarkup = filteredFiles.map(f => `
    <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 no-select-callout"
         oncontextmenu="handleRightClick(event, '${f.id}', ${f.telegram_message_id}, '${f.file_name.replace(/'/g, "\\'")}', false)"
         ontouchstart="handleTouchStart(event, '${f.id}', ${f.telegram_message_id}, '${f.file_name.replace(/'/g, "\\'")}', false)"
         ontouchend="handleTouchEnd(event)"
         ontouchcancel="handleTouchEnd(event)"
         ontouchmove="handleTouchMove(event)">
      <div class="col-span-8 md:col-span-9 flex items-center gap-3">
        <input type="checkbox" value="${f.id}" data-id="${f.telegram_message_id}" data-name="${f.file_name}" class="file-item-check rounded border-slate-300">
        <i class="fa-solid fa-file-lines text-slate-400 text-sm"></i>
        <span onclick="openPreview('${f.file_name.replace(/'/g, "\\'")}', ${f.telegram_message_id})" 
              onauxclick="handleMiddleClick(event, ${f.telegram_message_id}, '${f.file_name.replace(/'/g, "\\'")}')" 
              class="cursor-pointer hover:text-blue-600 font-medium text-slate-700 dark:text-slate-200 break-all">
          ${f.file_name}
        </span>
      </div>
      <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono">
        <span>${formatBytes(f.file_size)}</span>
        <button onclick="openItemActionMenu(event, '${f.id}', ${f.telegram_message_id}, '${f.file_name}', false)" class="hover:text-slate-600 p-1">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </div>
    </div>
  `).join('');

  if (!parentRow && foldersMarkup === "" && filesMarkup === "") {
    container.innerHTML = `<div class="text-center py-10 text-slate-400">No files in this folder.</div>`;
  } else {
    container.innerHTML = parentRow + foldersMarkup + filesMarkup;
  }
}

function openItemActionMenu(e, id, messageId, name, isFolder = false) {
  e.stopPropagation();
  activeContextItem = { id, messageId, name, isFolder };
  const menu = document.getElementById("itemActionMenu");

  const downloadBtn = document.getElementById("menuDownloadBtn");
  const shareBtn = document.getElementById("menuShareBtn");
  const renameBtn = document.getElementById("menuRenameBtn");
  const moveBtn = document.getElementById("menuMoveBtn");
  const trashBtn = document.getElementById("menuTrashBtn");
  const delFolderBtn = document.getElementById("menuDeleteFolderBtn");
  const downloadFolderBtn = document.getElementById("menuDownloadFolderBtn");
  const folderPermBtn = document.getElementById("menuFolderPermBtn");
  const publicShareBtn = document.getElementById("menuPublicShareBtn"); // <--- একদম ঠিক এখানে থাকবে

  if (isFolder) {
    downloadBtn.classList.add("hidden");
    shareBtn.classList.add("hidden");
    moveBtn.classList.add("hidden");
    downloadFolderBtn.classList.remove("hidden");
    trashBtn.classList.add("hidden");
    
    if (isPrimarySuperAdmin()) {
      folderPermBtn.classList.remove("hidden");
    } else {
      folderPermBtn.classList.add("hidden");
    }

    if (isAdmin()) {
      delFolderBtn.classList.remove("hidden");
      renameBtn.classList.remove("hidden");
      publicShareBtn.classList.remove("hidden");
      moveBtn.classList.remove("hidden");
    } else {
      delFolderBtn.classList.add("hidden");
      renameBtn.classList.add("hidden");
      publicShareBtn.classList.add("hidden");
    }
  } else {
    delFolderBtn.classList.add("hidden");
    downloadFolderBtn.classList.add("hidden");
    folderPermBtn.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
    shareBtn.classList.remove("hidden");
    publicShareBtn.classList.add("hidden"); 

    if (isAdmin()) {
      moveBtn.classList.remove("hidden");
      trashBtn.classList.remove("hidden");
      renameBtn.classList.remove("hidden");
    } else {
      moveBtn.classList.add("hidden");
      trashBtn.classList.add("hidden");
      renameBtn.classList.add("hidden");
    }
  }
  
  const btn = e.target.closest('button');
  const rect = btn.getBoundingClientRect();
  const menuWidth = 208;
  const menuHeight = isFolder ? 140 : 190;

  let top = rect.bottom + 4;
  if (top + menuHeight > window.innerHeight) {
    top = rect.top - menuHeight - 4;
  }

  let left = rect.right - menuWidth;
  if (left < 10) left = 10;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.classList.remove("hidden");
}

async function openPermissionsModalForCurrentFolder() {
  if (!activeContextItem || !activeContextItem.isFolder || !isPrimarySuperAdmin()) return;
  document.getElementById("itemActionMenu").classList.add("hidden");

  const folderObj = allFolders.find(x => x.id === activeContextItem.id);
  const allowed = (folderObj && folderObj.allowed_students) ? folderObj.allowed_students : [];

  document.getElementById("permModalSubText").innerText = `Folder: ${activeContextItem.name}`;
  const container = document.getElementById("permUsersListContainer");
  container.innerHTML = `<p class="text-center py-6 text-slate-400">Loading users...</p>`;
  showAnimatedModal("permissionsModal");

  try {
    const res = await fetch(`${API_BASE}/admin/users/list`);
    allDirectoryUsers = await res.json();

    const isPublic = allowed.length === 0;
    document.getElementById("permAllowAllCheck").checked = isPublic;

    renderPermUsersCheckboxes(allowed);
  } catch(e) {
    container.innerHTML = `<p class="text-center py-6 text-rose-500">Error loading users</p>`;
  }
}

function renderPermUsersCheckboxes(allowedList) {
  const container = document.getElementById("permUsersListContainer");
  const isPublic = document.getElementById("permAllowAllCheck").checked;

  container.innerHTML = allDirectoryUsers.map(u => {
    const isChecked = !isPublic && allowedList.includes(u.student_id);
    return `
      <label class="flex items-center justify-between py-2 px-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer ${isPublic ? 'opacity-40 pointer-events-none' : ''}">
        <div class="flex items-center gap-2 truncate">
          <input type="checkbox" value="${u.student_id}" ${isChecked ? 'checked' : ''} onchange="updatePermSelectedCount()" class="perm-user-check rounded border-slate-300">
          <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${u.name}</span>
          <span class="text-[10px] text-slate-400 font-mono">(${u.student_id})</span>
        </div>
      </label>
    `;
  }).join('');

  updatePermSelectedCount();
}

function togglePermAll(el) {
  const isPublic = el.checked;
  document.querySelectorAll('.perm-user-check').forEach(cb => {
    if (isPublic) cb.checked = false;
    cb.closest('label').classList.toggle('opacity-40', isPublic);
    cb.closest('label').classList.toggle('pointer-events-none', isPublic);
  });
  updatePermSelectedCount();
}

function updatePermSelectedCount() {
  const isPublic = document.getElementById("permAllowAllCheck").checked;
  if (isPublic) {
    document.getElementById("selectedPermCount").innerText = "Public";
  } else {
    const checked = document.querySelectorAll(".perm-user-check:checked").length;
    document.getElementById("selectedPermCount").innerText = `${checked} Selected`;
  }
}

async function saveFolderPermissions() {
  const folderId = activeContextItem.id;
  const isPublic = document.getElementById("permAllowAllCheck").checked;
  let allowed = [];

  if (!isPublic) {
    allowed = Array.from(document.querySelectorAll(".perm-user-check:checked")).map(cb => cb.value);
  }

  try {
    const res = await fetch(`${API_BASE}/folders/update-permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder_id: folderId,
        allowed_students: allowed,
        admin_id: currentUser.student_id
      })
    });
    if (!res.ok) throw new Error("Could not update permissions");
    showToast(isPublic ? "Folder is now public to all" : `Restricted to ${allowed.length} students`, "success");
    closePermissionsModal();
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

function closePermissionsModal() {
  hideAnimatedModal("permissionsModal");
}

function openRenameModalForCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("renameItemId").value = activeContextItem.id;
  document.getElementById("renameItemIsFolder").value = activeContextItem.isFolder;
  document.getElementById("renameItemOldName").value = activeContextItem.name;

  const currentDisplay = activeContextItem.isFolder 
    ? activeContextItem.name.split('/').filter(Boolean).pop() 
    : activeContextItem.name;

  document.getElementById("renameNewNameInput").value = currentDisplay;
  document.getElementById("itemActionMenu").classList.add("hidden");
  showAnimatedModal("renameModal");
}

function closeRenameModal() { hideAnimatedModal("renameModal"); }

async function executeRenameItem() {
  const itemId = document.getElementById("renameItemId").value;
  const isFolder = document.getElementById("renameItemIsFolder").value === "true";
  const oldName = document.getElementById("renameItemOldName").value;
  const newNameRaw = document.getElementById("renameNewNameInput").value.trim();

  if (!newNameRaw) return showToast("Name cannot be empty", "error");

  let finalNewName = newNameRaw;
  if (isFolder) {
    const parts = oldName.split('/').filter(Boolean);
    parts.pop();
    finalNewName = parts.length === 0 ? `/${newNameRaw}` : `/${parts.join('/')}/${newNameRaw}`;
  }

  try {
    const res = await fetch(`${API_BASE}/items/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: itemId,
        is_folder: isFolder,
        old_name: oldName,
        new_name: finalNewName
      })
    });
    if (!res.ok) throw new Error("Failed to rename");
    showToast("Renamed successfully!", "success");
    closeRenameModal();
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function downloadDirectFile(messageId, fileName) {
  // Remove any existing download strip
  document.getElementById("dlStrip")?.remove();

  // Create a fixed bottom download strip
  const strip = document.createElement("div");
  strip.id = "dlStrip";
  strip.className = "fixed bottom-0 left-0 right-0 z-[998] bg-slate-900 border-t border-slate-700 px-4 py-3 flex items-center gap-4 shadow-2xl";
  strip.innerHTML = `
    <div class="flex items-center gap-2 text-blue-400 shrink-0">
      <i class="fa-solid fa-download text-sm animate-bounce"></i>
      <span class="text-xs font-semibold text-slate-200 truncate max-w-[180px] sm:max-w-xs" id="dlStripName">${fileName}</span>
    </div>
    <div class="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
      <div id="dlStripBar" class="bg-blue-500 h-full rounded-full progress-bar-striped" style="width: 100%"></div>
    </div>
    <span id="dlStripStatus" class="text-[11px] font-mono text-slate-400 shrink-0">Downloading...</span>
    <button onclick="document.getElementById('dlStrip')?.remove()" class="text-slate-500 hover:text-slate-300 shrink-0 pl-1">
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  `;
  document.body.appendChild(strip);

  try {
    const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');
    const res = await fetch(`${API_BASE}/slides/stream/${messageId}?filename=${encodeURIComponent(fileName)}&token=${token}`);
    if (!res.ok) throw new Error("Download failed or unauthorized");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    // Success state
    document.getElementById("dlStripBar").className = "bg-emerald-500 h-full rounded-full transition-all duration-300";
    document.getElementById("dlStripBar").style.width = "100%";
    document.getElementById("dlStripStatus").innerText = "✓ Done!";
    document.getElementById("dlStripStatus").className = "text-[11px] font-mono text-emerald-400 shrink-0";

  } catch (err) {
    document.getElementById("dlStripBar").className = "bg-rose-500 h-full rounded-full";
    document.getElementById("dlStripStatus").innerText = "✗ Failed";
    document.getElementById("dlStripStatus").className = "text-[11px] font-mono text-rose-400 shrink-0";
    document.getElementById("dlStripName").innerText = err.message;
  } finally {
    setTimeout(() => document.getElementById("dlStrip")?.remove(), 3500);
  }
}

function triggerDownloadCurrentItem() {
  if (!activeContextItem) return;
  downloadDirectFile(activeContextItem.messageId, activeContextItem.name);
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function downloadActivePreviewFile() {
  if (!activePreviewItem) return;
  downloadDirectFile(activePreviewItem.id, activePreviewItem.name);
}

async function triggerDownloadTargetFolder() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");

  const targetPath = activeContextItem.name;
  const filesToPack = allFiles.filter(f => f.folder_path === targetPath || f.folder_path.startsWith(targetPath + '/'));

  if (filesToPack.length === 0) return showToast("This folder is empty, nothing to download", "error");

  // Create fixed bottom strip (same as guest)
  document.getElementById("dlStrip")?.remove();
  const strip = document.createElement("div");
  strip.id = "dlStrip";
  strip.className = "fixed bottom-0 left-0 right-0 z-[998] bg-slate-900 border-t border-slate-700 px-4 py-3 flex items-center gap-4 shadow-2xl";
  strip.innerHTML = `
    <div class="flex items-center gap-2 shrink-0">
      <i class="fa-solid fa-file-zipper text-blue-400 text-sm"></i>
      <span class="text-xs font-semibold text-slate-200 truncate max-w-[180px] sm:max-w-xs" id="dlStripName">Preparing ZIP...</span>
    </div>
    <div class="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
      <div id="dlStripBar" class="bg-blue-500 h-full rounded-full progress-bar-striped transition-all duration-200" style="width: 0%"></div>
    </div>
    <span id="dlStripStatus" class="text-[11px] font-mono text-slate-400 shrink-0">0%</span>
    <button onclick="document.getElementById('dlStrip')?.remove()" class="text-slate-500 hover:text-slate-300 shrink-0 pl-1">
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  `;
  document.body.appendChild(strip);

  const zip = new JSZip();
  const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');
  const total = filesToPack.length;

  for (let i = 0; i < total; i++) {
    const f = filesToPack[i];
    const percent = Math.round(((i) / total) * 90);
    const shortName = f.file_name.length > 30 ? f.file_name.substring(0, 30) + '...' : f.file_name;
    document.getElementById("dlStripName").innerText = `(${i + 1}/${total}) ${shortName}`;
    document.getElementById("dlStripBar").style.width = `${percent}%`;
    document.getElementById("dlStripStatus").innerText = `${percent}%`;

    try {
      const res = await fetch(`${API_BASE}/slides/stream/${f.telegram_message_id}?filename=${encodeURIComponent(f.file_name)}&token=${token}`);
      const blob = await res.blob();

      let relative = f.folder_path.replace(targetPath, '').replace(/^\/+/, '');
      if (relative) {
        zip.folder(relative).file(f.file_name, blob);
      } else {
        zip.file(f.file_name, blob);
      }
    } catch(e) {
      console.error(e);
    }
  }

  document.getElementById("dlStripName").innerText = "Creating ZIP file...";
  document.getElementById("dlStripBar").style.width = "90%";
  document.getElementById("dlStripStatus").innerText = "90%";

  const folderName = targetPath.split('/').filter(Boolean).pop() || "Folder";
  const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    const zipPercent = 90 + Math.round(metadata.percent * 0.1);
    document.getElementById("dlStripBar").style.width = `${zipPercent}%`;
    document.getElementById("dlStripStatus").innerText = `${zipPercent}%`;
  });

  // Success
  document.getElementById("dlStripName").innerText = `${folderName}.zip — Ready!`;
  document.getElementById("dlStripBar").className = "bg-emerald-500 h-full rounded-full transition-all duration-300";
  document.getElementById("dlStripBar").style.width = "100%";
  document.getElementById("dlStripStatus").innerText = "✓ Done!";
  document.getElementById("dlStripStatus").className = "text-[11px] font-mono text-emerald-400 shrink-0";

  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = `${folderName}.zip`;
  link.click();

  setTimeout(() => document.getElementById("dlStrip")?.remove(), 3500);
}

async function deleteCurrentFolder() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  if (!confirm(`Move "${activeContextItem.name}" to Trash? Files inside will also be trashed.`)) return;

  try {
    const res = await fetch(`${API_BASE}/folders/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        folder_id: activeContextItem.id, 
        folder_name: activeContextItem.name 
      })
    });
    if (!res.ok) throw new Error("Could not trash folder");
    showToast("Folder moved to Trash", "success");
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

function copyCurrentShareLink() {
  if (!activeContextItem) return;
  const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');
  const link = `${API_BASE}/slides/stream/${activeContextItem.messageId}?filename=${encodeURIComponent(activeContextItem.name)}&token=${token}`;
  navigator.clipboard.writeText(link);
  showToast("Direct link copied to clipboard!", "success");
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function openMoveModalForCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("moveTargetFileId").value = activeContextItem.id;
  document.getElementById("moveTargetIsFolder").value = activeContextItem.isFolder ? "true" : "false";
  document.getElementById("moveTargetFolderName").value = activeContextItem.name;
  document.getElementById("itemActionMenu").classList.add("hidden");
  document.getElementById("folderSearchInput").value = "";
  document.getElementById("selectedFolderDisplay").classList.add("hidden");
  
  // Default selected = current folder
  window._selectedMoveFolder = currentSelectedFolder;
  
  renderFolderPickerList('');
  showAnimatedModal("moveModal");
}

function renderFolderPickerList(query) {
  const container = document.getElementById("folderPickerList");
  
  const allOptions = [{ folder_name: '/', display: 'Home (/)' }, ...allFolders
    .filter(f => f.folder_name !== '/')
    .map(f => ({ folder_name: f.folder_name, display: f.folder_name }))
  ];

  const filtered = query
    ? allOptions.filter(f => f.display.toLowerCase().includes(query.toLowerCase()))
    : allOptions;

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-center py-4 text-slate-400 text-xs">No folders found</p>`;
    return;
  }

  container.innerHTML = filtered.map(f => {
    const isSelected = f.folder_name === window._selectedMoveFolder;
    const depth = f.folder_name === '/' ? 0 : f.folder_name.split('/').filter(Boolean).length;
    const displayName = f.folder_name === '/' ? 'Home (/)' : f.folder_name.split('/').filter(Boolean).pop();
    const indent = depth > 1 ? `padding-left:${(depth - 1) * 12}px` : '';

    return `
      <div onclick="selectMoveFolder('${f.folder_name}', '${f.folder_name === '/' ? 'Home (/)' : displayName}')"
           style="${indent}"
           class="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-xs transition
           ${isSelected ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'}">
        <i class="fa-solid fa-folder ${isSelected ? 'text-blue-500' : 'text-amber-500'}"></i>
        <span class="truncate">${displayName}</span>
        ${isSelected ? '<i class="fa-solid fa-check ml-auto text-blue-500"></i>' : ''}
      </div>
    `;
  }).join('');
}

function selectMoveFolder(path, name) {
  window._selectedMoveFolder = path;
  const display = document.getElementById("selectedFolderDisplay");
  document.getElementById("selectedFolderName").innerText = name;
  display.classList.remove("hidden");
  renderFolderPickerList(document.getElementById("folderSearchInput").value);
}

function filterFolderList(query) {
  renderFolderPickerList(query);
}

function closeMoveModal() { hideAnimatedModal("moveModal"); }

async function executeMoveFile() {
  const fileId = document.getElementById("moveTargetFileId").value;
  const isFolder = document.getElementById("moveTargetIsFolder").value === "true";
  const folderName = document.getElementById("moveTargetFolderName").value;
  const target = window._selectedMoveFolder || '/';

  try {
    if (isFolder) {
      const res = await fetch(`${API_BASE}/folders/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: fileId,
          is_folder: true,
          old_name: folderName,
          new_name: target
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Move failed");
      showToast(`Folder moved to ${target}`, "success");
    } else {
      const res = await fetch(`${API_BASE}/slides/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId, target_folder: target })
      });
      if (!res.ok) throw new Error("Move failed");
      showToast(`Moved to ${target}`, "success");
    }
    closeMoveModal();
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function trashCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  try {
    const res = await fetch(`${API_BASE}/slides/trash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: [activeContextItem.id] })
    });
    if (!res.ok) throw new Error("Trash failed");
    showToast("Moved to Trash", "success");
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function trashSelected() {
  if (!isAdmin()) return showToast("Only admin can trash files", "error");
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("No files selected", "error");

  const ids = Array.from(checked).map(c => c.value);
  try {
    const res = await fetch(`${API_BASE}/slides/trash`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ file_ids: ids })
    });
    if(!res.ok) throw new Error("Trash failed");
    showToast("Moved selected files to Trash", "success");
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(err) { showToast(err.message, "error"); }
}

async function checkUnseenNotices() {
  try {
    const res = await fetch(`${API_BASE}/notices/list?t=${Date.now()}`);
    const notices = await res.json();
    
    allNotices = notices.filter(n => {
      if (!n.folder_path || n.folder_path === '/') return true;
      return hasFolderPermission(n.folder_path);
    });

    if (allNotices.length === 0) return;

    const lastSeenId = localStorage.getItem("last_seen_notice_id");
    const latestNotice = allNotices[0];

    if (latestNotice.id !== lastSeenId) {
      document.getElementById("headerUnseenNoticeDot").classList.remove("hidden");
      document.getElementById("noticeBadgeCount").classList.remove("hidden");
      
      const timeFormatted = new Date(latestNotice.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
      });
      showToast(latestNotice.title, "info", `${latestNotice.file_name || latestNotice.message || ''} • ${timeFormatted}`);
    }
  } catch(e) {}
}

async function openNoticeBoardModal() {
  showAnimatedModal("noticeBoardModal");
  document.getElementById("headerUnseenNoticeDot").classList.add("hidden");
  document.getElementById("noticeBadgeCount").classList.add("hidden");

  if (allNotices.length > 0) {
    localStorage.setItem("last_seen_notice_id", allNotices[0].id);
  }

  loadNoticesList();
}

function closeNoticeBoardModal() { hideAnimatedModal("noticeBoardModal"); }

async function loadNoticesList() {
  const container = document.getElementById("noticesListContainer");
  try {
    const res = await fetch(`${API_BASE}/notices/list?t=${Date.now()}`);
    const rawNotices = await res.json();

    allNotices = rawNotices.filter(n => {
      if (!n.folder_path || n.folder_path === '/') return true;
      return hasFolderPermission(n.folder_path);
    });

    if (allNotices.length === 0) {
      container.innerHTML = `<p class="text-center py-10 text-slate-400">No notices published yet.</p>`;
      return;
    }

    container.innerHTML = allNotices.map(n => {
      const timeFormatted = new Date(n.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
      });

      return `
        <div onclick="openNoticeDetails('${n.id}')" class="py-3 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl cursor-pointer transition flex items-center justify-between">
          <div class="flex items-center gap-3 overflow-hidden">
            <div class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-500 flex items-center justify-center shrink-0">
              <i class="fa-solid fa-bullhorn text-xs"></i>
            </div>
            <div class="truncate">
              <span class="font-bold text-slate-800 dark:text-slate-100 block truncate">${n.title}</span>
              <span class="text-[11px] text-slate-500 font-mono truncate">${(n.file_name || n.message || '').replace(/\n/g, ', ')}</span>
            </div>
          </div>
          <span class="text-[10px] text-slate-400 font-mono whitespace-nowrap ml-2">${timeFormatted}</span>
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
}

async function postCustomNotice() {
  const title = document.getElementById("customNoticeTitle").value.trim();
  const message = document.getElementById("customNoticeMsg").value.trim();
  if (!title || !message) return showToast("Title and message are required", "error");

  try {
    const res = await fetch(`${API_BASE}/notices/create-custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        message,
        admin_name: currentUser.name
      })
    });
    if (!res.ok) throw new Error("Could not publish notice");
    showToast("Notice broadcasted successfully!", "success");
    document.getElementById("customNoticeTitle").value = "";
    document.getElementById("customNoticeMsg").value = "";
    loadNoticesList();
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function confirmClearAllNotices() {
  if (!confirm("Are you sure you want to clear all notices from the board?")) return;
  try {
    const res = await fetch(`${API_BASE}/notices/clear-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: currentUser.student_id })
    });
    if (!res.ok) throw new Error("Failed to clear notices");
    showToast("All notices cleared", "success");
    loadNoticesList();
  } catch(err) {
    showToast(err.message, "error");
  }
}

function openNoticeDetails(noticeId) {
  const n = allNotices.find(x => x.id === noticeId);
  if (!n) return;

  activeNoticeTarget = n;
  const timeFormatted = new Date(n.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
  });

  document.getElementById("ndModalHeading").innerText = n.title;
  document.getElementById("ndTime").innerText = timeFormatted;
  document.getElementById("ndUploader").innerText = n.uploaded_by || "Administrator";

  if (n.file_name) {
    document.getElementById("ndFileBox").classList.remove("hidden");
    document.getElementById("ndFolderBox").classList.remove("hidden");
    document.getElementById("ndCustomMsgBox").classList.add("hidden");
    document.getElementById("ndGoFolderBtn").classList.remove("hidden");
    
    // If there are multiple files, render them as a list
    const fileNames = n.file_name.split('\n');
    if (fileNames.length > 1) {
      const listHtml = fileNames.map(f => `<div class="flex items-center gap-2 mt-1.5"><i class="fa-solid fa-file-lines text-blue-500"></i> <span class="break-all">${f}</span></div>`).join('');
      document.getElementById("ndFileName").innerHTML = `<div class="mt-2 text-slate-700 dark:text-slate-300 font-medium max-h-48 overflow-y-auto">${listHtml}</div>`;
    } else {
      document.getElementById("ndFileName").innerText = n.file_name;
    }
    
    document.getElementById("ndFolderPath").innerText = n.folder_path;
  } else {
    document.getElementById("ndFileBox").classList.add("hidden");
    document.getElementById("ndFolderBox").classList.add("hidden");
    document.getElementById("ndGoFolderBtn").classList.add("hidden");
    document.getElementById("ndCustomMsgBox").classList.remove("hidden");
    document.getElementById("ndCustomMsg").innerText = n.message || "";
  }

  closeNoticeBoardModal();
  showAnimatedModal("noticeDetailsModal");
}

function closeNoticeDetailsModal() { hideAnimatedModal("noticeDetailsModal"); }

function goToNoticeFolder() {
  if (!activeNoticeTarget || !activeNoticeTarget.folder_path) return;
  if (!hasFolderPermission(activeNoticeTarget.folder_path)) {
    return showToast("Access Restricted: You are not authorized to access this folder.", "error");
  }
  closeNoticeDetailsModal();
  selectFolder(activeNoticeTarget.folder_path);
}

async function openUserManagementModal() {
  if (!isAdmin()) return;
  showAnimatedModal("userManagementModal");
  loadUsersList();
}

function closeUserManagementModal() { hideAnimatedModal("userManagementModal"); }

async function loadUsersList() {
  const container = document.getElementById("usersListContainer");
  try {
    const res = await fetch(`${API_BASE}/admin/users/list?t=${Date.now()}`);
    allDirectoryUsers = await res.json();

    if (allDirectoryUsers.length === 0) {
      container.innerHTML = `<p class="text-center py-10 text-slate-400">No users found.</p>`;
      return;
    }

    container.innerHTML = allDirectoryUsers.map(u => {
      const isSuper = u.student_id === '2510376101';
      const isUserAdmin = u.role === 'super_admin';
      const isUserApproved = u.status === 'approved';
      const chatBanned = u.chat_banned_until && new Date() < new Date(u.chat_banned_until);
      const fileBanned = u.file_banned_until && new Date() < new Date(u.file_banned_until);

      return `
        <div class="flex flex-col md:flex-row md:items-center justify-between py-3 gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800 dark:text-slate-100">${u.name}</span>
              <span class="font-mono text-[10px] text-slate-400">(${u.student_id})</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isUserApproved ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'}">${u.status}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isUserAdmin ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}">${u.role}</span>
            </div>
            <div class="flex flex-wrap gap-2 text-[10px] text-slate-400 mt-1 font-mono">
              <span>Chat: ${chatBanned ? '<b class="text-rose-500">Banned</b>' : 'Allowed'}</span>
              <span>•</span>
              <span>Files: ${fileBanned ? '<b class="text-rose-500">Banned</b>' : 'Allowed'}</span>
            </div>
          </div>

          ${isSuper ? '<span class="text-emerald-500 font-bold text-xs">Primary Super Admin</span>' : `
            <div class="flex flex-wrap items-center gap-1.5">
              ${isUserApproved ? `
                <button onclick="toggleUserStatus('${u.student_id}', 'rejected')" class="px-2.5 py-1 rounded text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-100">Reject</button>
              ` : `
                <button onclick="toggleUserStatus('${u.student_id}', 'approved')" class="px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500">Approve</button>
              `}

              <button onclick="removeUserAccount('${u.student_id}', '${u.name}')" class="px-2.5 py-1 rounded text-xs font-semibold bg-red-600 hover:bg-red-700 text-white flex items-center gap-1" title="Delete Account Permanently">
                <i class="fa-solid fa-user-xmark"></i> Remove
              </button>

              <button onclick="toggleUserRole('${u.student_id}', '${isUserAdmin ? 'student' : 'super_admin'}')" class="px-2.5 py-1 rounded text-xs font-semibold ${isUserAdmin ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-500'}">
                ${isUserAdmin ? 'Demote' : 'Make Admin'}
              </button>
              
              <select onchange="applyUserBan('${u.student_id}', this.value)" class="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-[11px]">
                <option value="">Restrictions...</option>
                <option value="chat:30">Ban Chat 30m</option>
                <option value="chat:60">Ban Chat 1h</option>
                <option value="chat:4320">Ban Chat 3d</option>
                <option value="chat:0">Unban Chat</option>
                <option value="file:30">Ban Files 30m</option>
                <option value="file:60">Ban Files 1h</option>
                <option value="file:4320">Ban Files 3d</option>
                <option value="file:0">Unban Files</option>
                <option value="both:4320">Ban All 3d</option>
                <option value="both:0">Unban All</option>
              </select>
            </div>
          `}
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
}

async function removeUserAccount(student_id, name) {
  if (!confirm(`Are you sure you want to completely remove ${name} (${student_id}) from the system?`)) return;

  try {
    const res = await fetch(`${API_BASE}/admin/users/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student_id,
        admin_id: currentUser.student_id
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    showToast(data.message, "success");
    loadUsersList();
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function toggleUserStatus(student_id, new_status) {
  try {
    const res = await fetch(`${API_BASE}/admin/users/update-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id, status: new_status })
    });
    if (!res.ok) throw new Error("Failed to update status");
    showToast(`User ${new_status}!`, "success");
    loadUsersList();
  } catch(err) {
    showToast(err.message, "error");
  }
}

function openClassmatesListModal() {
  const formattedText = allDirectoryUsers.map((u, i) => {
    return `${i + 1}. Name: ${u.name}\n   Student ID: ${u.student_id}\n   Registration No: ${u.reg_no || 'Not Set'}\n   Status: ${u.status.toUpperCase()}\n----------------------------------------`;
  }).join('\n\n');

  document.getElementById("classmatesTextarea").value = formattedText || "No users found.";
  showAnimatedModal("classmatesListModal");
}

function closeClassmatesListModal() {
  hideAnimatedModal("classmatesListModal");
}

function copyClassmatesListText() {
  const ta = document.getElementById("classmatesTextarea");
  ta.select();
  navigator.clipboard.writeText(ta.value);
  showToast("Classmates list copied to clipboard!", "success");
}

async function toggleUserRole(student_id, new_role) {
  try {
    const res = await fetch(`${API_BASE}/admin/users/update-role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id, role: new_role })
    });
    if (!res.ok) throw new Error("Failed to change role");
    showToast(`Role updated to ${new_role}`, "success");
    loadUsersList();
    if (currentUser.student_id === student_id) {
      renderPortalView();
    }
  } catch(err) { showToast(err.message, "error"); }
}

async function applyUserBan(student_id, banCode) {
  if (!banCode) return;
  const [ban_type, mins] = banCode.split(':');
  try {
    const res = await fetch(`${API_BASE}/admin/users/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id, ban_type, duration_minutes: parseInt(mins) })
    });
    if (!res.ok) throw new Error("Ban action failed");
    showToast(`Restriction updated!`, "success");
    loadUsersList();
  } catch(err) { showToast(err.message, "error"); }
}

async function openAdminTrashModal() {
  if (!isAdmin()) return;
  showAnimatedModal("adminTrashModal");
  loadTrashFiles();
}

function closeAdminTrashModal() { hideAnimatedModal("adminTrashModal"); }

async function loadTrashFiles() {
  const container = document.getElementById("trashListContainer");
  try {
    const [filesRes, foldersRes] = await Promise.all([
      fetch(`${API_BASE}/admin/trash/list`),
      fetch(`${API_BASE}/admin/trash/folders`)
    ]);
    const files = await filesRes.json();
    const folders = await foldersRes.json();

    if (files.length === 0 && folders.length === 0) {
      container.innerHTML = `<p class="text-center py-10 text-slate-400">Trash is completely empty.</p>`;
      return;
    }

    const foldersHtml = folders.map(f => `
      <div class="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800">
        <div class="flex items-center gap-2 truncate">
          <i class="fa-solid fa-folder text-amber-400"></i>
          <span class="truncate font-medium">${f.folder_name}</span>
          <span class="text-[10px] bg-amber-100 text-amber-600 px-1.5 rounded">Folder</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="restoreTrashFolder('${f.folder_name}')" class="px-2.5 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium text-xs">Restore</button>
          <button onclick="permanentlyDeleteFolder('${f.folder_name}')" class="px-2.5 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 font-medium text-xs">Delete Forever</button>
        </div>
      </div>
    `).join('');

    const filesHtml = files.map(f => `
      <div class="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800">
        <div class="flex items-center gap-2 truncate">
          <i class="fa-solid fa-file text-rose-400"></i>
          <span class="truncate font-medium">${f.file_name}</span>
          <span class="text-[10px] text-slate-400 font-mono">(${formatBytes(f.file_size)})</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button onclick="restoreTrashFile('${f.id}')" class="px-2.5 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium text-xs">Restore</button>
          <button onclick="permanentlyDeleteFile('${f.id}')" class="px-2.5 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 font-medium text-xs">Delete Forever</button>
        </div>
      </div>
    `).join('');

    container.innerHTML = foldersHtml + filesHtml;
  } catch(e) { console.error(e); }
}

async function restoreTrashFolder(folderName) {
  try {
    await fetch(`${API_BASE}/admin/trash/restore-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: "", folder_name: folderName })
    });
    showToast("Folder restored!", "success");
    loadTrashFiles();
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(e) { showToast("Error restoring folder", "error"); }
}

async function permanentlyDeleteFolder(folderName) {
  if (!confirm("Delete folder permanently? All files inside will also be deleted forever.")) return;
  try {
    await fetch(`${API_BASE}/admin/trash/permanent-delete-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id: "", folder_name: folderName })
    });
    showToast("Folder deleted forever!", "success");
    loadTrashFiles();
  } catch(e) { showToast("Error deleting folder", "error"); }
}

async function restoreTrashFile(id) {
  try {
    await fetch(`${API_BASE}/admin/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: [id] })
    });
    showToast("Restored file", "success");
    loadTrashFiles();
    await loadFiles();
    sortFiles(currentSortMode);
  } catch(e) { showToast("Error restoring", "error"); }
}

async function permanentlyDeleteFile(id) {
  if (!confirm("Delete permanently? This will remove the file from both Database and Telegram channel.")) return;
  try {
    await fetch(`${API_BASE}/admin/trash/permanent-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: [id] })
    });
    showToast("Deleted forever from DB & Telegram!", "success");
    loadTrashFiles();
  } catch(e) { showToast("Error deleting", "error"); }
}

function toggleSelectAll(el) {
  document.querySelectorAll(".file-item-check").forEach(cb => cb.checked = el.checked);
}

async function downloadSelectedZip() {
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("Select files to download", "error");

  showToast("Packing selected files into ZIP...", "info");
  const zip = new JSZip();
  const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');

  for (let box of checked) {
    const id = box.getAttribute("data-id");
    const name = box.getAttribute("data-name");
    const res = await fetch(`${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}&token=${token}`);
    const blob = await res.blob();
    zip.file(name, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = "selected_materials.zip";
  link.click();
  showToast("ZIP download started!", "success");
}

async function openPreview(name, id) {
  // Set dynamic title
  if (!originalDocumentTitle) originalDocumentTitle = document.title;
  document.title = name;
  
  document.getElementById("previewTitle").innerText = name;
  activePreviewItem = { name, id };

  history.pushState({ folder: currentSelectedFolder, previewOpen: true }, "", "");
  
  const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');
  const originalStreamUrl = `${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}&token=${token}`;

  let finalUrlToRender = originalStreamUrl;
  const FILE_CACHE_NAME = 'portal-offline-files-v1';

  // --- SMART CACHING & OFFLINE LOGIC START ---
  if ('caches' in window) {
    try {
      const cache = await caches.open(FILE_CACHE_NAME);
      const matched = await cache.match(originalStreamUrl, { ignoreSearch: true });
      
      if (matched) {
        // File is already cached! Open locally without API request
        const cachedBlob = await matched.blob();
        finalUrlToRender = URL.createObjectURL(cachedBlob); 
      } else if (!navigator.onLine) {
        // File not cached and internet is off
        showAnimatedModal("previewModal");
        const container = document.getElementById("previewContainer");
        const topBar = document.getElementById("previewTopBar");
        if(topBar) topBar.classList.remove("hidden");
        
        container.style.justifyContent = "center";
        container.innerHTML = `
          <div class="text-center p-8 bg-slate-900 border border-slate-800 rounded-2xl max-w-sm">
            <i class="fa-solid fa-wifi text-rose-500 text-4xl mb-3 block"></i>
            <h4 class="text-sm font-semibold text-slate-200 mb-1">Not found in local storage</h4>
            <p class="text-xs text-slate-400">Please turn on your internet connection to view this file.</p>
          </div>
        `;
        return; 
      } else {
        // File not cached, but internet is on. Save in background (won't slow down preview)
        fetch(originalStreamUrl)
          .then(res => res.blob())
          .then(blob => cache.put(originalStreamUrl, new Response(blob)))
          .then(() => trimCacheIfOverLimit())
          .catch(e => console.warn("Background cache failed"));
      }
    } catch (e) {
      console.warn("Caching error", e);
    }
  }
  // --- SMART CACHING & OFFLINE LOGIC END ---

  const container = document.getElementById("previewContainer");
  const pageIndicator = document.getElementById("pdfPageIndicator");
  const topBar = document.getElementById("previewTopBar");
  
  if (pageIndicator) pageIndicator.classList.add("hidden");
  container.scrollTop = 0;
  container.style.justifyContent = "flex-start";
  container.style.padding = "16px"; 
  
  if(topBar) topBar.classList.remove("hidden");

  container.innerHTML = `<div class="m-auto text-center text-slate-400 py-20 flex flex-col items-center gap-2"><span class="spinner"></span><span>Loading preview...</span></div>`;
  showAnimatedModal("previewModal");

  const lower = name.toLowerCase();

  // Common text and programming file extensions list
  const textExtensions = ['.txt', '.v', '.sv', '.c', '.cpp', '.h', '.py', '.java', '.html', '.css', '.js', '.json', '.xml', '.md', '.csv', '.sql', '.sh', '.bat', '.log'];
  const isTextFile = textExtensions.some(ext => lower.endsWith(ext));

  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.ogg') || lower.endsWith('.mkv') || lower.endsWith('.mov')) {
    container.style.justifyContent = "center";
    container.innerHTML = `
      <div class="w-full max-w-4xl max-h-[85vh] flex items-center justify-center">
        <video controls autoplay playsinline class="w-full max-h-[80vh] rounded-xl shadow-2xl bg-black">
          <source src="${finalUrlToRender}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
    `;
  }
  else if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a') || lower.endsWith('.aac')) {
    container.style.justifyContent = "center";
    container.innerHTML = `
      <div class="p-8 bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center gap-4 text-center">
        <div class="w-16 h-16 rounded-full bg-blue-600/20 text-blue-500 flex items-center justify-center text-2xl">
          <i class="fa-solid fa-music"></i>
        </div>
        <span class="text-sm font-semibold text-slate-200 break-all">${name}</span>
        <audio controls autoplay class="w-72 md:w-96">
          <source src="${finalUrlToRender}">
        </audio>
      </div>
    `;
  }
  else if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.svg')) {
    container.style.justifyContent = "center";
    container.style.overflow = "hidden"; // scrollbar hide
    
    // image e cursor: grab deya hoyese
    container.innerHTML = `<img id="previewImageElement" src="${finalUrlToRender}" alt="${name}" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl transition-transform duration-75" style="transform: translate(0px, 0px) scale(1); cursor: grab;">`;

    currentImageScale = 1.0;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let startX, startY;

    const img = document.getElementById("previewImageElement");

    // Ctrl + Mouse Wheel Zoom
    container.onwheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const zoomSpeed = 0.15;
        currentImageScale += (e.deltaY < 0) ? zoomSpeed : -zoomSpeed;
        currentImageScale = Math.max(0.3, Math.min(currentImageScale, 10.0));
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentImageScale})`;
      }
    };

    // Mouse Drag (Panning) Logic
    img.onmousedown = (e) => {
      e.preventDefault();
      isDragging = true;
      startX = e.clientX - translateX;
      startY = e.clientY - translateY;
      img.style.cursor = "grabbing";
    };

    container.onmousemove = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      translateX = e.clientX - startX;
      translateY = e.clientY - startY;
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${currentImageScale})`;
    };

    container.onmouseup = () => {
      isDragging = false;
      img.style.cursor = "grab";
    };

    container.onmouseleave = () => {
      isDragging = false;
      img.style.cursor = "grab";
    };
  }
  else if (lower.endsWith('.pdf')) {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (viewportMeta) {
      originalViewportContent = viewportMeta.getAttribute("content");
      viewportMeta.setAttribute("content", "width=1024, user-scalable=yes");
    }
    
    if(topBar) topBar.classList.add("hidden");
    container.style.padding = "0";

    const viewerUrl = `/pdfjs/web/viewer.html?file=${encodeURIComponent(finalUrlToRender)}#zoom=page-width`;

    container.style.justifyContent = "center";
    container.innerHTML = `
      <iframe 
        id="pdfIframe"
        src="${viewerUrl}" 
        class="w-full h-full border-0 shadow-xl"
        allowfullscreen>
      </iframe>
    `;

    const iframe = document.getElementById("pdfIframe");
    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const openFileBtn = doc.getElementById('openFile');
        if (openFileBtn) openFileBtn.style.display = 'none';

        const toolbarLeft = doc.getElementById('toolbarViewerLeft');
        if (toolbarLeft) {
           const titleEl = doc.createElement('div');
           titleEl.innerHTML = name;
           titleEl.style.cssText = 'color:#d1d5db; font-size:13px; font-weight:600; padding-top:6px; margin-left:20px; max-width:250px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:inline-block; vertical-align:top;';
           toolbarLeft.appendChild(titleEl); 
        }

        const toolbarRight = doc.getElementById('toolbarViewerRight');
        if (toolbarRight) {
          const closeBtn = doc.createElement('button');
          closeBtn.innerHTML = '✕ Close';
          closeBtn.style.cssText = 'background-color: #e11d48; border: none; padding: 4px 12px; margin-top: 4px; margin-right: 8px; border-radius: 6px; cursor: pointer; color: white; font-weight: bold; font-size: 12px; transition: 0.2s;';
          closeBtn.onclick = () => window.parent.closePreview();
          toolbarRight.insertBefore(closeBtn, toolbarRight.firstChild);
        }
      } catch(e) {}
    };
  }
  // --- NEW TEXT/CODE READER LOGIC ---
  else if (isTextFile) {
    container.style.justifyContent = "flex-start";
    container.innerHTML = `
      <div class="w-full max-w-4xl max-h-[85vh] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-2xl">
        <div class="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between items-center shrink-0">
           <span class="text-xs font-mono text-slate-400"><i class="fa-solid fa-code mr-2"></i>Text Viewer</span>
           <button onclick="downloadActivePreviewFile()" class="text-blue-400 hover:text-blue-300 text-xs font-semibold px-2 py-1"><i class="fa-solid fa-download"></i> Download</button>
        </div>
        <div class="p-4 overflow-auto flex-1 text-left">
           <pre><code id="textPreviewCode" class="text-[13px] font-mono text-slate-300 break-words whitespace-pre-wrap">Loading content...</code></pre>
        </div>
      </div>
    `;
    
    fetch(finalUrlToRender)
      .then(res => res.text())
      .then(text => {
         // textContent automatically escapes HTML tags, making it XSS secure
         document.getElementById("textPreviewCode").textContent = text;
      })
      .catch(err => {
         document.getElementById("textPreviewCode").textContent = "Error loading text content.";
      });
  }
  // --- FALLBACK LOGIC (With "Read as Text" button for unknown files) ---
  else {
    const isPptx = lower.endsWith('.pptx') || lower.endsWith('.ppt');
    container.style.justifyContent = "center";
    container.innerHTML = `
      <div class="text-center p-8 bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full">
        <i class="fa-solid ${isPptx ? 'fa-file-powerpoint text-amber-500' : 'fa-file-lines text-slate-500'} text-4xl mb-3 block"></i>
        <h4 class="text-sm font-semibold text-slate-200 mb-1 break-all">${name}</h4>
        <p class="text-xs text-slate-400 mb-5">${isPptx ? 'PowerPoint Presentation' : 'Unknown File Format'}</p>
        
        <div class="flex flex-col gap-2.5">
          <button onclick="downloadActivePreviewFile()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition shadow-sm">
            <i class="fa-solid fa-download"></i> Download File
          </button>
          
          <button onclick="forceLoadAsText('${finalUrlToRender}')" class="bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition">
            <i class="fa-solid fa-code"></i> Read as Text
          </button>
        </div>
      </div>
    `;
  }
}
 
function closePreview(isFromBackButton = false) {
  // Clear zoom event
  const container = document.getElementById("previewContainer");
  if (container) {
    container.onwheel = null;
    container.onmousemove = null;
    container.onmouseup = null;
    container.onmouseleave = null;
  }
  
  hideAnimatedModal("previewModal");
  document.getElementById("previewContainer").innerHTML = "";
  
  // Reset things back to normal when closing
  document.getElementById("previewContainer").style.padding = "16px";
  const topBar = document.getElementById("previewTopBar");
  if(topBar) topBar.classList.remove("hidden");
  
  document.getElementById("pdfPageIndicator").classList.add("hidden");
  activePreviewItem = null;
  
  // Close desktop mode
  const viewportMeta = document.querySelector('meta[name="viewport"]');
  if (viewportMeta && originalViewportContent) {
    viewportMeta.setAttribute("content", originalViewportContent);
    originalViewportContent = ""; // Reset
  }

  // Close using backbutton
  if (!isFromBackButton && history.state && history.state.previewOpen) {
    history.back(); 
  } else {
    document.title = "Private Cloud | Academic Storage";
  }
}

function openChatFullscreen() {
  if (!currentUser) return showToast("Please login first", "error");
  document.getElementById("chatModal").classList.remove("chat-closed");
}

function closeChatFullscreen() { 
  document.getElementById("chatModal").classList.add("chat-closed"); 
}

async function confirmClearChat() {
  if (!isPrimarySuperAdmin()) return;
  if (!confirm("Are you sure you want to permanently clear the entire class chat history?")) return;

  try {
    const res = await fetch(`${API_BASE}/chat/clear-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ admin_id: currentUser.student_id })
    });
    if (!res.ok) throw new Error("Could not clear chat");
    document.getElementById("chatMessages").innerHTML = "";
    showToast("Chat history completely cleared!", "success");
  } catch(err) {
    showToast(err.message, "error");
  }
}

function initWebSocket() {
  // Only load chat history if user is logged in
  if (!currentUser || !currentUser.token) return;

  fetch(`${API_BASE}/chat/history`)
    .then(res => res.json())
    .then(msgs => {
      const box = document.getElementById("chatMessages");
      box.innerHTML = "";
      if (Array.isArray(msgs)) {
        msgs.forEach(appendMessage);
      }
    }).catch(err => console.error("Chat history load failed", err));

  if (!ws) {
    // Append the JWT token to the websocket URL for authentication
    const token = currentUser.token;
    const wsUrl = API_BASE.replace("https://", "wss://").replace("http://", "ws://") + `/ws/chat?token=${token}`;
    
    ws = new WebSocket(wsUrl);
    ws.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "notice") {
        if (!data.folder_path || hasFolderPermission(data.folder_path)) {
          document.getElementById("headerUnseenNoticeDot").classList.remove("hidden");
          document.getElementById("noticeBadgeCount").classList.remove("hidden");
          showToast(data.title, "info", `${data.file_name || data.message || ''} • ${data.time}`);
          await loadFiles();
          sortFiles(currentSortMode);
        }
      } else if (data.type === "chat_event" && data.cleared) {
        document.getElementById("chatMessages").innerHTML = "";
        showToast(data.message, "info");
      } else if (data.system) {
        showToast(data.message, "error");
      } else {
        appendMessage(data);
      }
    };
    
    ws.onclose = () => {
      console.log("WebSocket disconnected.");
      ws = null; // Allow reconnecting if needed
    };
  }
  setInterval(() => {
    const modal = document.getElementById("onlineUsersModal");
    if (modal && !modal.classList.contains("modal-hidden")) {
      refreshPresenceData();
    }
  }, 30 * 1000);
}

function appendMessage(msg) {
  const box = document.getElementById("chatMessages");
  const isMe = currentUser && currentUser.student_id === msg.student_id;
  const el = document.createElement("div");
  el.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
  el.innerHTML = `
    <span class="text-[9px] text-slate-400 mb-0.5">${msg.sender_name} (${msg.student_id})</span>
    <div class="px-3.5 py-2 rounded-2xl max-w-[80%] text-xs shadow-xs ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none'}">
      ${msg.message}
    </div>
  `;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function sendLiveMessage(e) {
  e.preventDefault();
  if (!isApproved()) return showToast("Account is pending approval. You cannot chat yet.", "error");

  const input = document.getElementById("chatInput");
  if (!input.value.trim() || !ws) return;
  ws.send(JSON.stringify({ student_id: currentUser.student_id, sender_name: currentUser.name, message: input.value.trim() }));
  input.value = "";
}

function restoreFolderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const shareId = params.get('share');
  
  if (shareId) {
    initGuestMode(shareId);
    return;
  }
  
  const folder = params.get('folder') || '/';
  currentSelectedFolder = folder;
  history.replaceState({ folder }, '', folder === '/' ? '/' : '/?folder=' + encodeURIComponent(folder));
}

window.addEventListener('popstate', (e) => {
  if (!currentUser) return;

  document.title = "Private Cloud | Academic Storage";

  // Close preview on backpress
  const previewModal = document.getElementById("previewModal");
  if (previewModal && !previewModal.classList.contains("modal-hidden")) {
    closePreview(true);
  }
  
  const folder = e.state?.folder || '/';
  currentSelectedFolder = folder;
  document.getElementById("activeFolderPathText").innerText = `Folder: ${currentSelectedFolder}`;
  renderFilesTable();
});

async function openCreateShareModal() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  
  const folderPath = activeContextItem.name;
  document.getElementById("shareTargetFolderPath").value = folderPath;
  document.getElementById("sharePasswordInput").value = "";
  
  // Reset UI
  document.getElementById("shareCreateSection").classList.add("hidden");
  document.getElementById("shareManageSection").classList.add("hidden");
  document.getElementById("shareModalSubtext").innerHTML = `<span class="spinner"></span> Checking link status...`;
  
  showAnimatedModal("createShareModal");

  try {
    const res = await fetch(`${API_BASE}/share/status?folder_path=${encodeURIComponent(folderPath)}&admin_id=${currentUser.student_id}`);
    const data = await res.json();
    
    if (data.is_shared) {
      document.getElementById("shareModalSubtext").innerText = "This folder is currently shared publicly.";
      const shareUrl = `${window.location.origin}${window.location.pathname}?share=${data.share_id}`;
      document.getElementById("generatedShareLink").value = shareUrl;
      document.getElementById("shareManageSection").classList.remove("hidden");
    } else {
      document.getElementById("shareModalSubtext").innerText = "Generate a link to share this folder.";
      document.getElementById("shareCreateSection").classList.remove("hidden");
    }
  } catch(e) {
    document.getElementById("shareModalSubtext").innerText = "Error loading link status.";
  }
}

// এই ফাংশনটি মাঝখানেই থাকুক
function closeCreateShareModal() { hideAnimatedModal("createShareModal"); }

async function executeCreateShareLink() {
  const folderPath = document.getElementById("shareTargetFolderPath").value;
  const password = document.getElementById("sharePasswordInput").value.trim();
  
  try {
    const res = await fetch(`${API_BASE}/share/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        folder_path: folderPath, 
        admin_id: currentUser.student_id, 
        password: password || null 
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    
    showToast("Share link successfully generated!", "success");
    // Reload modal to show the newly created link
    closeCreateShareModal();
    setTimeout(openCreateShareModal, 300);
  } catch (err) { 
    showToast(err.message, "error"); 
  }
}

async function executeRevokeShareLink() {
  const folderPath = document.getElementById("shareTargetFolderPath").value;
  
  if (!confirm("Are you sure you want to disable this link? Anyone using it will immediately lose access.")) return;
  
  try {
    const res = await fetch(`${API_BASE}/share/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        folder_path: folderPath, 
        admin_id: currentUser.student_id 
      })
    });
    if (!res.ok) throw new Error("Failed to disable link");
    
    showToast("Public link has been disabled!", "success");
    closeCreateShareModal();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function copyGeneratedShareLink() {
  const input = document.getElementById("generatedShareLink");
  input.select();
  navigator.clipboard.writeText(input.value);
  showToast("Link copied to clipboard! You can share it now.", "success");
}

async function initGuestMode(shareId) {
  isGuestMode = true;
  currentShareId = shareId;
  
  // Hide default portal elements
  document.getElementById("guestLandingView").classList.add("hidden");
  document.getElementById("sidebarToggleBtn").classList.add("hidden");
  document.getElementById("navAuthSection").innerHTML = `<span class="bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-400 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5"><i class="fa-solid fa-earth-americas"></i> Public View</span>`;
  
  await verifyAndLoadSharedFolder();
}

async function verifyAndLoadSharedFolder() {
  const passInput = document.getElementById("guestSharePassword");
  const password = passInput ? passInput.value.trim() : null;

  try {
    const res = await fetch(`${API_BASE}/share/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_id: currentShareId, password: password || null })
    });
    const data = await res.json();
    
    if (!res.ok) {
      if (res.status === 401) { // Password required or incorrect
         document.getElementById("guestPasswordModal").classList.remove("hidden");
         if(password) showToast("Incorrect Password!", "error");
         return;
      }
      throw new Error(data.detail || "Invalid Share Link");
    }

    // Authentication Success
    document.getElementById("guestPasswordModal").classList.add("hidden");
    guestToken = data.token;
    guestFolderPath = data.folder_path;
    guestCurrentPath = data.folder_path; 
    
    // UI Adjustments for Guest
    document.getElementById("authenticatedView").classList.remove("hidden");
    document.getElementById("activeFolderPathText").innerText = `Shared Folder: ${guestFolderPath}`;
    document.getElementById("adminDropzoneArea").classList.add("hidden");
    
    // Hide sorting and multi-selection actions from guests
    const sortToolbar = document.querySelector(".flex.flex-wrap.items-center.justify-between.gap-3.pt-2.text-xs");
    if(sortToolbar) sortToolbar.classList.add("hidden");
    
    await loadSharedFiles();

    // Auto Open Preview from URL (For Guest New Tab feature) 
    const urlParams = new URLSearchParams(window.location.search);
    const pMsgId = urlParams.get('preview_msg_id');
    const pName = urlParams.get('preview_name');
    if (pMsgId && pName) {
      setTimeout(() => openPreview(pName, pMsgId), 600); 
    }
  } catch(err) {
    showToast(err.message, "error");
    document.getElementById("guestLandingView").innerHTML = `<div class="p-10 text-center text-rose-500 font-bold text-lg"><i class="fa-solid fa-triangle-exclamation text-3xl mb-2 block"></i> ${err.message}. Link may be broken or expired.</div>`;
    document.getElementById("guestLandingView").classList.remove("hidden");
  }
}

async function loadSharedFiles() {
  try {
    const res = await fetch(`${API_BASE}/share/files/${currentShareId}?token=${guestToken}`);
    const data = await res.json();
    if (!res.ok) throw new Error("Could not load shared files");
    sharedFiles = data;
    renderSharedFilesTable();
  } catch(err) { showToast(err.message, "error"); }
}

function renderSharedFilesTable() {
  const container = document.getElementById("fileTableContent");
  
  let topHtml = `
    <div class="px-4 py-3 flex justify-between items-center bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-900/50">
        <span class="text-xs font-bold text-blue-600 dark:text-blue-400">
          <i class="fa-solid fa-folder-open mr-1"></i> ${sharedFiles.length} files shared
        </span>
        <button onclick="downloadGuestZip()" class="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold flex items-center gap-1.5 shadow-sm">
          <i class="fa-solid fa-file-zipper"></i> Download All as ZIP
        </button>
    </div>
  `;

  if (sharedFiles.length === 0) {
    container.innerHTML = topHtml + `<div class="text-center py-12 text-slate-400">This shared folder is empty.</div>`;
    return;
  }

  // Current path track করার জন্য
  // sharedFiles এ সব subfolders বের করো
  const allPaths = [...new Set(sharedFiles.map(f => f.folder_path))];
  
  // guestFolderPath এর direct child folders বের করো
  function getChildFolders(parentPath) {
    const prefix = parentPath === '/' ? '/' : parentPath + '/';
    const children = new Set();
    allPaths.forEach(p => {
      if (p === parentPath) return;
      if (!p.startsWith(prefix)) return;
      const remainder = p.slice(prefix.length);
      if (!remainder.includes('/')) {
        children.add(prefix + remainder);
      } else {
        children.add(prefix + remainder.split('/')[0]);
      }
    });
    return [...children];
  }

  // Current guest folder এর direct files
  function getFilesInFolder(folderPath) {
    return sharedFiles.filter(f => f.folder_path === folderPath);
  }

  // Render করো
  function renderGuestFolder(folderPath) {
    const childFolders = getChildFolders(folderPath);
    const filesHere = getFilesInFolder(folderPath);

    let html = '';

    // Parent directory button (root এ নয়)
    if (folderPath !== guestFolderPath) {
      const parts = folderPath.split('/').filter(Boolean);
      parts.pop();
      const parent = parts.length === 0 ? guestFolderPath : '/' + parts.join('/');
      html += `
        <div onclick="guestCurrentPath='${parent}'; renderSharedFilesTable();" 
             class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-100 dark:hover:bg-slate-800/80 cursor-pointer transition border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
          <div class="col-span-8 md:col-span-9 flex items-center gap-3">
            <i class="fa-solid fa-arrow-turn-up rotate-90 text-blue-600 font-bold text-sm"></i>
            <span class="font-bold text-sm text-slate-800 dark:text-slate-100">..</span>
            <span class="text-[11px] text-slate-400">(Parent directory)</span>
          </div>
          <div class="col-span-4 md:col-span-3 flex justify-end text-slate-400 font-mono text-[11px]">Up</div>
        </div>
      `;
    }

    // Folders
    childFolders.forEach(fp => {
      const displayName = fp.split('/').filter(Boolean).pop();
      html += `
        <div onclick="guestCurrentPath='${fp}'; renderSharedFilesTable();"
             class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition border-b border-slate-100 dark:border-slate-800 cursor-pointer">
          <div class="col-span-8 md:col-span-9 flex items-center gap-3">
            <i class="fa-solid fa-folder text-amber-500 text-base"></i>
            <span class="font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600">${displayName}</span>
          </div>
          <div class="col-span-4 md:col-span-3 flex justify-end text-slate-400 font-mono text-[11px]">Folder</div>
        </div>
      `;
    });

    // Files
    filesHere.forEach(f => {
      html += `
        <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition border-b border-slate-50 dark:border-slate-800/30 no-select-callout">
          <div class="col-span-8 md:col-span-9 flex items-center gap-3">
            <i class="fa-solid fa-file-lines text-slate-400 text-sm"></i>
            <span onclick="openPreview('${f.file_name.replace(/'/g, "\\'")}', ${f.telegram_message_id})" 
                  onauxclick="handleMiddleClick(event, ${f.telegram_message_id}, '${f.file_name.replace(/'/g, "\\'")}')"
                  class="cursor-pointer hover:text-blue-600 font-medium text-slate-700 dark:text-slate-200 break-all text-[11px] md:text-xs">
              ${f.file_name}
            </span>
          </div>
          <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono text-[10px] md:text-[11px]">
            <span class="hidden sm:inline">${formatBytes(f.file_size)}</span>
            <button onclick="downloadDirectFile(${f.telegram_message_id}, '${f.file_name}')" 
                    class="text-blue-600 hover:text-white bg-blue-50 hover:bg-blue-500 dark:bg-blue-900/30 dark:hover:bg-blue-600 p-2 rounded-lg transition" title="Download">
              <i class="fa-solid fa-download"></i>
            </button>
          </div>
        </div>
      `;
    });

    return html;
  }

  // Path badge update করো
  document.getElementById("activeFolderPathText").innerText = `Shared Folder: ${guestCurrentPath}`;

  container.innerHTML = topHtml + renderGuestFolder(guestCurrentPath);
}

async function downloadGuestZip() {
  if (sharedFiles.length === 0) return;

  // Progress toast create করো
  const toastContainer = document.getElementById("toastContainer");
  const progressToast = document.createElement("div");
  progressToast.id = "zipProgressToast";
  progressToast.className = "flex flex-col gap-2 px-4 py-3 rounded-xl border border-blue-500 bg-white dark:bg-slate-900 shadow-xl text-xs font-medium text-blue-500 pointer-events-auto";
  progressToast.innerHTML = `
    <div class="flex items-center justify-between gap-4">
      <span class="flex items-center gap-2">
        <i class="fa-solid fa-file-zipper"></i>
        <span id="zipProgressLabel">Preparing ZIP...</span>
      </span>
      <span id="zipProgressPercent" class="font-mono font-bold">0%</span>
    </div>
    <div class="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
      <div id="zipProgressBar" class="bg-blue-500 h-full rounded-full transition-all duration-200" style="width: 0%"></div>
    </div>
  `;
  toastContainer.appendChild(progressToast);

  const zip = new JSZip();
  const total = sharedFiles.length;

  for (let i = 0; i < total; i++) {
    const f = sharedFiles[i];
    const percent = Math.round(((i) / total) * 90); // 90% পর্যন্ত download phase

    document.getElementById("zipProgressLabel").innerText = `Downloading (${i + 1}/${total}): ${f.file_name.length > 25 ? f.file_name.substring(0, 25) + '...' : f.file_name}`;
    document.getElementById("zipProgressPercent").innerText = `${percent}%`;
    document.getElementById("zipProgressBar").style.width = `${percent}%`;

    try {
      const res = await fetch(`${API_BASE}/slides/stream/${f.telegram_message_id}?filename=${encodeURIComponent(f.file_name)}&token=${guestToken}`);
      const blob = await res.blob();

      // Folder structure maintain করো ZIP এ
      const relativePath = f.folder_path.replace(guestFolderPath, '').replace(/^\//, '');
      if (relativePath) {
        zip.folder(relativePath).file(f.file_name, blob);
      } else {
        zip.file(f.file_name, blob);
      }
    } catch (e) {
      console.error(`Failed: ${f.file_name}`, e);
    }
  }

  // Zipping phase
  document.getElementById("zipProgressLabel").innerText = "Creating ZIP file...";
  document.getElementById("zipProgressPercent").innerText = "90%";
  document.getElementById("zipProgressBar").style.width = "90%";

  const zipBlob = await zip.generateAsync(
    { type: "blob" },
    (metadata) => {
      const zipPercent = 90 + Math.round(metadata.percent * 0.1); // 90-100%
      document.getElementById("zipProgressPercent").innerText = `${zipPercent}%`;
      document.getElementById("zipProgressBar").style.width = `${zipPercent}%`;
    }
  );

  // Done!
  document.getElementById("zipProgressLabel").innerText = "Download starting...";
  document.getElementById("zipProgressPercent").innerText = "100%";
  document.getElementById("zipProgressBar").style.width = "100%";
  document.getElementById("zipProgressBar").className = "bg-emerald-500 h-full rounded-full transition-all duration-200";

  const folderName = guestFolderPath.split('/').filter(Boolean).pop() || "Shared_Folder";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = `${folderName}.zip`;
  link.click();

  // 3 সেকেন্ড পর toast সরাও
  setTimeout(() => {
    progressToast.remove();
  }, 3000);
}


// ==========================================
// CLASS ROUTINE SYSTEM
// ==========================================
let routineData = { courses: [], routine_image_message_id: null, routine_image_filename: null, last_edited_by: null, last_edited_at: null };
let tempNewRoutineImageFile = null;

async function openRoutineModal() {
  showAnimatedModal("routineModal");
  if (isAdmin()) {
    document.getElementById("routineEditBtn").classList.remove("hidden");
    document.getElementById("routineSettingsBtn").classList.remove("hidden");
  }
  await loadRoutineData();
}

function closeRoutineModal() { hideAnimatedModal("routineModal"); }

async function loadRoutineData() {
  try {
    const res = await fetch(`${API_BASE}/routine/get`);
    routineData = await res.json();
    renderRoutineModal();
  } catch(e) {
    document.getElementById("routineCourseList").innerHTML = `<p class="text-center py-8 text-rose-400">Failed to load routine.</p>`;
  }
}

function formatRoutineEditTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return `Last edited at ${timeStr}`;
  if (isYesterday) return `Last edited Yesterday at ${timeStr}`;
  return `Last edited ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function getTomorrowDateLabel() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function switchRoutineTab(tab) {
  const scheduleTab = document.getElementById("routineTabSchedule");
  const imageTab = document.getElementById("routineTabImage");
  const scheduleBtn = document.getElementById("routineTabScheduleBtn");
  const imageBtn = document.getElementById("routineTabImageBtn");

  if (tab === 'schedule') {
    scheduleTab.classList.remove("hidden");
    imageTab.classList.add("hidden");
    scheduleBtn.className = "flex-1 py-2.5 font-semibold text-blue-600 border-b-2 border-blue-500";
    imageBtn.className = "flex-1 py-2.5 text-slate-400 hover:text-slate-600";
  } else {
    scheduleTab.classList.add("hidden");
    imageTab.classList.remove("hidden");
    imageBtn.className = "flex-1 py-2.5 font-semibold text-blue-600 border-b-2 border-blue-500";
    scheduleBtn.className = "flex-1 py-2.5 text-slate-400 hover:text-slate-600";
  }
}

function renderRoutineModal() {
  // Reset to schedule tab
  switchRoutineTab('schedule');

  // Last edited time
  const lastEditedEl = document.getElementById("routineLastEdited");
  if (routineData.last_edited_at) {
    lastEditedEl.innerText = formatRoutineEditTime(routineData.last_edited_at);
    lastEditedEl.classList.remove("hidden");
  }

  // Routine image tab
  if (routineData.routine_image_message_id && routineData.routine_image_filename) {
    const token = currentUser ? currentUser.token : '';
    const imgUrl = `${API_BASE}/slides/stream/${routineData.routine_image_message_id}?filename=${encodeURIComponent(routineData.routine_image_filename)}&token=${token}`;
    const imgEl = document.getElementById("routineImage");
    imgEl.src = imgUrl;
    imgEl.classList.remove("hidden");
    document.getElementById("routineImageError").classList.add("hidden");
    document.getElementById("routineImageSection").classList.remove("hidden");
    document.getElementById("routineNoImage").classList.add("hidden");
  } else {
    document.getElementById("routineImageSection").classList.add("hidden");
    document.getElementById("routineNoImage").classList.remove("hidden");
  }

  // Tomorrow's schedule
  const tomorrowClasses = (routineData.courses || []).filter(c => c.tomorrow_selected);
  const tomorrowSection = document.getElementById("tomorrowScheduleSection");
  if (tomorrowClasses.length > 0) {
    document.getElementById("tomorrowDateLabel").innerText = getTomorrowDateLabel();
    document.getElementById("tomorrowClassList").innerHTML = tomorrowClasses.map(c => `
      <div class="flex flex-col gap-1.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl px-3 py-2.5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="font-bold text-slate-800 dark:text-slate-100">${c.code}</span>
            <span class="text-slate-500 dark:text-slate-400 ml-1">${c.name}</span>
          </div>
          ${c.tomorrow_time ? `<span class="text-xs font-mono text-amber-700 dark:text-amber-400 font-semibold whitespace-nowrap shrink-0">${c.tomorrow_time}</span>` : ''}
        </div>
        ${c.tomorrow_place ? `<span class="text-[11px] text-slate-500 dark:text-slate-400">${c.tomorrow_place}</span>` : ''}
        ${c.teacher ? `<span class="text-[10px] text-slate-400">${c.teacher}</span>` : ''}
      </div>
    `).join('');
    tomorrowSection.classList.remove("hidden");
  } else {
    tomorrowSection.classList.add("hidden");
  }

  // All courses
  const courseList = document.getElementById("routineCourseList");
  if (!routineData.courses || routineData.courses.length === 0) {
    courseList.innerHTML = `<p class="text-center py-8 text-slate-400">No courses added yet.</p>`;
    return;
  }
  courseList.innerHTML = routineData.courses.map(c => `
    <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5">
      <div>
        <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">${c.code}</span>
        <span class="text-slate-500 dark:text-slate-400 text-xs ml-1">${c.name}</span>
        ${c.teacher ? `<p class="text-[10px] text-slate-400 mt-0.5">${c.teacher}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function openRoutineImagePreview() {
  if (!routineData.routine_image_message_id) return;
  const token = currentUser ? currentUser.token : '';
  const imgUrl = `${API_BASE}/slides/stream/${routineData.routine_image_message_id}?filename=${encodeURIComponent(routineData.routine_image_filename)}&token=${token}`;
  openPreview(routineData.routine_image_filename, routineData.routine_image_message_id);
}

// ---- Settings Modal ----
function openRoutineSettingsModal() {
  if (!isAdmin()) return;
  tempNewRoutineImageFile = null;
  document.getElementById("routineImagePreviewNew").classList.add("hidden");
  document.getElementById("routineImageFileInput").value = "";

  // Show existing image thumb
  if (routineData.routine_image_message_id && routineData.routine_image_filename) {
    const token = currentUser ? currentUser.token : '';
    const imgUrl = `${API_BASE}/slides/stream/${routineData.routine_image_message_id}?filename=${encodeURIComponent(routineData.routine_image_filename)}&token=${token}`;
    document.getElementById("routineThumbImg").src = imgUrl;
    document.getElementById("currentRoutineImageThumb").classList.remove("hidden");
  } else {
    document.getElementById("currentRoutineImageThumb").classList.add("hidden");
  }

  renderSettingsCourseList();
  showAnimatedModal("routineSettingsModal");
}

function closeRoutineSettingsModal() { hideAnimatedModal("routineSettingsModal"); }

function renderSettingsCourseList() {
  const container = document.getElementById("settingsCourseList");
  if (!routineData.courses || routineData.courses.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center py-3">No courses yet.</p>`;
    return;
  }
  container.innerHTML = routineData.courses.map((c, i) => `
    <div class="flex items-center justify-between bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2">
      <div class="text-xs">
        <span class="font-bold text-slate-800 dark:text-slate-100">${c.code}</span>
        <span class="text-slate-500 ml-1">${c.name}</span>
        ${c.teacher ? `<span class="text-[10px] text-slate-400 ml-1">• ${c.teacher}</span>` : ''}
      </div>
      <button onclick="removeCourse(${i})" class="text-rose-400 hover:text-rose-600 p-1 ml-2 shrink-0">
        <i class="fa-solid fa-trash-can text-xs"></i>
      </button>
    </div>
  `).join('');
}

function previewRoutineImageUpload(input) {
  if (!input.files || !input.files[0]) return;
  tempNewRoutineImageFile = input.files[0];
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById("routineNewThumb").src = e.target.result;
    document.getElementById("routineImagePreviewNew").classList.remove("hidden");
  };
  reader.readAsDataURL(tempNewRoutineImageFile);
}

function addNewCourse() {
  const code = document.getElementById("newCourseCode").value.trim();
  const name = document.getElementById("newCourseName").value.trim();
  const teacher = document.getElementById("newCourseTeacher").value.trim();
  if (!code || !name) return showToast("Course code and name are required", "error");

  if (!routineData.courses) routineData.courses = [];
  routineData.courses.push({ code, name, teacher, tomorrow_selected: false, tomorrow_time: "", tomorrow_place: "" });

  document.getElementById("newCourseCode").value = "";
  document.getElementById("newCourseName").value = "";
  document.getElementById("newCourseTeacher").value = "";
  renderSettingsCourseList();
  showToast("Course added!", "success");
}

function removeCourse(index) {
  routineData.courses.splice(index, 1);
  renderSettingsCourseList();
}

async function saveRoutineSettings() {
  // Upload new image if selected
  if (tempNewRoutineImageFile) {
    showToast("Uploading routine image...", "info");
    const formData = new FormData();
    formData.append("file", tempNewRoutineImageFile);
    formData.append("folder", "/");
    formData.append("uploader_name", currentUser ? currentUser.name : "Admin");
    formData.append("skip_notice", "true");

    try {
      const res = await fetch(`${API_BASE}/slides/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Image upload failed");
      const data = await res.json();
      routineData.routine_image_message_id = data.file.telegram_message_id;
      routineData.routine_image_filename = data.file.file_name;
      tempNewRoutineImageFile = null;
    } catch(err) {
      return showToast(err.message, "error");
    }
  }

  try {
    const res = await fetch(`${API_BASE}/routine/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routineData)
    });
    if (!res.ok) throw new Error("Failed to save routine");
    showToast("Routine settings saved!", "success");
    closeRoutineSettingsModal();
    await loadRoutineData();
  } catch(err) {
    showToast(err.message, "error");
  }
}

// ---- Edit Tomorrow's Routine ----
function openEditRoutineModal() {
  if (!isAdmin()) return;
  const tomorrow = getTomorrowDateLabel();
  document.getElementById("editRoutineDateLabel").innerText = tomorrow;

  const container = document.getElementById("editCourseCheckboxList");
  if (!routineData.courses || routineData.courses.length === 0) {
    container.innerHTML = `<p class="text-center py-6 text-slate-400">No courses in settings yet.</p>`;
    showAnimatedModal("editRoutineModal");
    return;
  }

  container.innerHTML = routineData.courses.map((c, i) => `
    <div class="border border-slate-200 dark:border-slate-700 rounded-xl p-3 space-y-2 transition" id="editCourseRow_${i}">
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" class="edit-course-check rounded border-slate-300 w-4 h-4" 
               data-index="${i}" ${c.tomorrow_selected ? 'checked' : ''}
               onchange="toggleEditCourseRow(${i}, this.checked)">
        <div>
          <span class="font-bold text-slate-800 dark:text-slate-100">${c.code}</span>
          <span class="text-slate-500 dark:text-slate-400 ml-1">${c.name}</span>
          ${c.teacher ? `<p class="text-[10px] text-slate-400">${c.teacher}</p>` : ''}
        </div>
      </label>
      <div id="editCourseDetails_${i}" class="${c.tomorrow_selected ? '' : 'hidden'} grid grid-cols-2 gap-2 pt-1">
        <input type="text" placeholder="Time (e.g. 10:00 AM)" value="${c.tomorrow_time || ''}"
               class="edit-time-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs"
               data-index="${i}">
        <input type="text" placeholder="Place (e.g. Room 301)" value="${c.tomorrow_place || ''}"
               class="edit-place-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg p-2 text-xs"
               data-index="${i}">
      </div>
    </div>
  `).join('');

  showAnimatedModal("editRoutineModal");
}

function toggleEditCourseRow(index, checked) {
  const details = document.getElementById(`editCourseDetails_${index}`);
  details.classList.toggle("hidden", !checked);
}

function closeEditRoutineModal() { hideAnimatedModal("editRoutineModal"); }

async function saveEditedRoutine() {
  // Collect all checkbox values
  document.querySelectorAll(".edit-course-check").forEach(cb => {
    const i = parseInt(cb.getAttribute("data-index"));
    routineData.courses[i].tomorrow_selected = cb.checked;
  });
  document.querySelectorAll(".edit-time-input").forEach(inp => {
    const i = parseInt(inp.getAttribute("data-index"));
    routineData.courses[i].tomorrow_time = inp.value.trim();
  });
  document.querySelectorAll(".edit-place-input").forEach(inp => {
    const i = parseInt(inp.getAttribute("data-index"));
    routineData.courses[i].tomorrow_place = inp.value.trim();
  });

  try {
    const res = await fetch(`${API_BASE}/routine/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(routineData)
    });
    if (!res.ok) throw new Error("Failed to save");
    showToast("Tomorrow's routine updated!", "success");
    closeEditRoutineModal();
    await loadRoutineData();
  } catch(err) {
    showToast(err.message, "error");
  }
}

// ==========================================
// OFFLINE CACHING UTILITIES
// ==========================================

// Function to automatically trim older cached files when storage exceeds 1.5 GB limit
async function trimCacheIfOverLimit() {
  if (!('caches' in window) || !navigator.storage || !navigator.storage.estimate) return;

  const MAX_BYTES = 1536 * 1024 * 1024; // 1.5 GB in Bytes
  const FILE_CACHE_NAME = 'portal-offline-files-v1';

  try {
    let { usage } = await navigator.storage.estimate();

    // If storage usage exceeds 1.5 GB
    if (usage && usage > MAX_BYTES) {
      const cache = await caches.open(FILE_CACHE_NAME);
      const requests = await cache.keys();

      // Older cached files are stored first, so start deleting from the beginning
      for (const request of requests) {
        // Re-check storage estimate after deleting each file
        const currentEstimate = await navigator.storage.estimate();
        if (currentEstimate.usage <= MAX_BYTES * 0.85) { 
          // Stop loop once usage drops to 85% (approx 870 MB)
          break; 
        }
        await cache.delete(request);
      }
    }
  } catch (err) {
    console.warn("Auto cache trimming failed:", err);
  }
}

// Helper to save data to local storage
function saveToLocalStorage(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) { console.error("Storage full"); }
}

// Helper to get data from local storage
function getFromLocalStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch(e) { return []; }
}

// Listen for internet connection return
window.addEventListener('online', async () => {
  showToast("Internet connected! Updating data...", "success");
  if(currentUser) {
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
  }
});

// Listen for internet connection loss
window.addEventListener('offline', () => {
  showToast("You are offline. Showing cached data.", "info");
});

// Offline এ cached data দিয়ে render করো
if (!navigator.onLine && currentUser) {
  allFiles = getFromLocalStorage("cached_files");
  allFolders = getFromLocalStorage("cached_folders");
}

// ==========================================
// STORAGE MANAGER LOGIC
// ==========================================

// Get real storage estimation from browser API
async function getStorageInfo() {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage || 0,
      quota: estimate.quota || 0
    };
  }
  return { usage: 0, quota: 500 * 1024 * 1024 }; // Fallback to 500MB if API not supported
}

async function openStorageManager() {
  showAnimatedModal("storageManagerModal");
  
  document.getElementById("storageUsedText").innerText = `... MB`;
  
  const info = await getStorageInfo();
  
  const usedMB = (info.usage / (1024 * 1024)).toFixed(2);
  
  // Set fixed 1.5 GB (1536 MB) limit as requested
  const MAX_LIMIT_MB = 1536; 
  
  // Calculate the used percentage based on the 1.5 GB limit
  const percent = Math.min((usedMB / MAX_LIMIT_MB) * 100, 100).toFixed(1);

  document.getElementById("storageUsedText").innerText = `${usedMB} MB`;
  document.getElementById("storageTotalText").innerText = `${MAX_LIMIT_MB} MB Limit (1.5 GB)`;
  document.getElementById("storagePercentText").innerText = `${percent}%`;
  
  // Set progress bar width and change color if getting full
  const bar = document.getElementById("storageProgressBar");
  bar.style.width = `${percent}%`;
  
  if (percent > 80) {
    bar.className = "bg-rose-500 h-full rounded-full transition-all duration-500";
  } else if (percent > 50) {
    bar.className = "bg-amber-500 h-full rounded-full transition-all duration-500";
  } else {
    bar.className = "bg-indigo-500 h-full rounded-full transition-all duration-500";
  }
}

function closeStorageManager() {
  hideAnimatedModal("storageManagerModal");
}

async function clearOfflineStorage() {
  if (!confirm("Are you sure you want to delete all downloaded files? You will need an internet connection to view them again.")) return;

  try {
    // 1. Clear file cache (PDFs, Images)
    if ('caches' in window) {
      await caches.delete('portal-offline-files-v1'); 
    }
    
    // 2. Clear localStorage fallback data
    localStorage.removeItem("cached_files");
    localStorage.removeItem("cached_folders");
    
    showToast("Offline storage cleared successfully!", "success");
    
    // Refresh modal UI
    openStorageManager(); 
  } catch (err) {
    showToast("Failed to clear storage.", "error");
  }
}

// ==========================================
// FORCE TEXT VIEWER LOGIC
// ==========================================
window.forceLoadAsText = function(url) {
  const container = document.getElementById("previewContainer");
  container.style.justifyContent = "flex-start";
  container.innerHTML = `
    <div class="w-full max-w-4xl max-h-[85vh] bg-slate-950 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-2xl">
      <div class="bg-slate-900 px-4 py-2 border-b border-slate-800 flex justify-between items-center shrink-0">
         <span class="text-xs font-mono text-slate-400">
           <i class="fa-solid fa-triangle-exclamation text-amber-500 mr-2"></i> Forced Text View
         </span>
         <button onclick="downloadActivePreviewFile()" class="text-blue-400 hover:text-blue-300 text-xs font-semibold px-2 py-1"><i class="fa-solid fa-download"></i> Download</button>
      </div>
      <div class="p-4 overflow-auto flex-1 text-left">
         <pre><code id="textPreviewCode" class="text-[13px] font-mono text-slate-300 break-words whitespace-pre-wrap">Forcing text read...</code></pre>
      </div>
    </div>
  `;
  
  fetch(url)
    .then(res => res.text())
    .then(text => {
       document.getElementById("textPreviewCode").textContent = text;
    })
    .catch(err => {
       document.getElementById("textPreviewCode").textContent = "Error: Could not read file as text. It might be a binary file.";
    });
};


// ==========================================
// ZIP EXTRACTOR & UPLOAD
// ==========================================
async function handleZipExtract(input) {
  if (!isAdmin()) return showToast("Only Admin can upload files", "error");
  if (!input.files || input.files.length === 0) return;

  const file = input.files[0];
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return uploadSelectedFiles(input);
  }

  if (!confirm(`Extract "${file.name}" and upload all files to current folder?`)) {
    input.value = "";
    return;
  }

  showAnimatedModal("uploadProgressModal");
  const progressBar = document.getElementById("uploadProgressBar");
  const progressText = document.getElementById("uploadProgressText");
  progressText.innerText = "Reading ZIP file...";

  try {
    const zip = new JSZip();
    const loaded = await zip.loadAsync(file);
    const entries = Object.values(loaded.files).filter(f => !f.dir);
    const total = entries.length;
    let done = 0;
    let uploadedNames = [];


    // ZIP upload to current directory
    const mainFolder = currentSelectedFolder;
    const createdFolders = new Set([mainFolder]);

    for (const entry of entries) {
      progressText.innerText = `Extracting (${done + 1}/${total}): ${entry.name}`;
      progressBar.style.width = `${Math.round((done / total) * 100)}%`;

      const blob = await entry.async("blob");
      const parts = entry.name.split('/').filter(Boolean);
      const fileName = parts.pop(); // Last part = file name
      
      // Target folder = mainFolder + entry এর subfolder path
      let targetFolder = mainFolder;
      if (parts.length > 0) {
        targetFolder = (mainFolder === '/' ? '' : mainFolder) + '/' + parts.join('/');
      }

      // Subfolder গুলো create করো (যদি না থাকে)
      if (targetFolder !== mainFolder) {
        let buildPath = mainFolder === '/' ? '' : mainFolder;
        for (const part of parts) {
          buildPath = buildPath + '/' + part;
          if (!createdFolders.has(buildPath)) {
            const existingSub = allFolders.find(f => f.folder_name === buildPath);
            if (!existingSub) {
              try {
                const fd = new FormData();
                fd.append("folder_name", buildPath);
                const fr = await fetch(`${API_BASE}/folders/create`, { method: "POST", body: fd });
                if (fr.ok) {
                  const fdata = await fr.json();
                  allFolders.push({ ...fdata.data, folder_name: buildPath });
                }
              } catch(e) { console.error("Subfolder create failed", e); }
            }
            createdFolders.add(buildPath);
          }
        }
      }

      // File upload করো
      const formData = new FormData();
      formData.append("file", new File([blob], fileName));
      formData.append("folder", targetFolder);
      formData.append("uploader_name", currentUser ? currentUser.name : "Admin");
      formData.append("skip_notice", "true");

      try {
        const res = await fetch(`${API_BASE}/slides/upload`, { method: "POST", body: formData });
        if (res.ok) {
          const data = await res.json();
          if (data.file) {
            const newF = data.file;
            newF.folder_path = newF.folder_path.startsWith('/') ? newF.folder_path : '/' + newF.folder_path;
            allFiles.unshift(newF);
          }
          uploadedNames.push(fileName);
        }
      } catch(e) { console.error(e); }

      done++;
    }

    // Batch notice
    if (uploadedNames.length > 0) {
      try {
        await fetch(`${API_BASE}/notices/create-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_names: uploadedNames,
            folder_path: mainFolder,
            uploader_name: currentUser ? currentUser.name : "Admin"
          })
        });
      } catch(e) {}
    }

    progressBar.style.width = "100%";
    hideAnimatedModal("uploadProgressModal");
    input.value = "";
    showToast(`Extracted & uploaded ${done} files successfully!`, "success");
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);

  } catch(err) {
    hideAnimatedModal("uploadProgressModal");
    showToast("ZIP extraction failed: " + err.message, "error");
  }
}

// ==========================================
// CUSTOM CONTEXT MENU & SHORTCUT LOGIC
// ==========================================
let touchTimer = null;
let isTouching = false;
let advancedContextItem = null;

// Handle Mouse Right Click
function handleRightClick(e, id, messageId, name, isFolder) {
  if(isFolder) return;
  e.preventDefault(); // default menu prevention
  showAdvancedContextMenu(e.clientX, e.clientY, id, messageId, name, isFolder);
}

// Handle Mobile Touch and Hold (Long Press)
function handleTouchStart(e, id, messageId, name, isFolder) {
  if(isFolder) return;
  if(e.target.closest('button') || e.target.closest('input')) return; // বাটন বা চেকবক্সে টাচ করলে মেনু আসবে না
  
  isTouching = true;
  const touch = e.touches[0];
  touchTimer = setTimeout(() => {
    if(isTouching) {
      showAdvancedContextMenu(touch.clientX, touch.clientY, id, messageId, name, isFolder);
      // vibration feedback to prevent default popup
      if(navigator.vibrate) navigator.vibrate(50); 
    }
  }, 500); // 500ms hold time
}

function handleTouchEnd(e) { isTouching = false; clearTimeout(touchTimer); }
function handleTouchMove(e) { isTouching = false; clearTimeout(touchTimer); }

// Show Context Menu UI
function showAdvancedContextMenu(x, y, id, messageId, name, isFolder) {
  advancedContextItem = { id, messageId, name, isFolder };
  const menu = document.getElementById("advancedContextMenu");
  
  menu.classList.remove("hidden");
  const rect = menu.getBoundingClientRect();
  
  // position adjustment
  let top = y;
  let left = x;
  if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
  if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
  
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

// Close Context Menu on clicking outside
window.addEventListener('click', (e) => {
  if (!e.target.closest('#advancedContextMenu')) {
    const menu = document.getElementById("advancedContextMenu");
    if(menu) menu.classList.add("hidden");
  }
});

// Action 1: Open in Custom Previewer (New Tab)
function contextOpenNewTab() {
  if(!advancedContextItem) return;
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('preview_msg_id', advancedContextItem.messageId);
  url.searchParams.set('preview_name', advancedContextItem.name);
  if(isGuestMode && currentShareId) url.searchParams.set('share', currentShareId);
  
  window.open(url.toString(), '_blank');
  document.getElementById("advancedContextMenu").classList.add("hidden");
}

// Action 2: Open with Default Browser Viewer
function contextOpenBrowser() {
  if(!advancedContextItem) return;
  const token = isGuestMode ? guestToken : (currentUser ? currentUser.token : '');
  const streamUrl = `${API_BASE}/slides/stream/${advancedContextItem.messageId}?filename=${encodeURIComponent(advancedContextItem.name)}&token=${token}`;
  window.open(streamUrl, '_blank');
  document.getElementById("advancedContextMenu").classList.add("hidden");
}

// Action 3: Download Directly
function contextDownload() {
  if(!advancedContextItem) return;
  downloadDirectFile(advancedContextItem.messageId, advancedContextItem.name);
  document.getElementById("advancedContextMenu").classList.add("hidden");
}

// Keyboard Shortcut Listener (Alt + T)
document.addEventListener('keydown', (e) => {
  // Check if Alt + T is pressed
  if (e.altKey && e.key.toLowerCase() === 't') {
    // shortcut for newtab
    if (advancedContextItem && !document.getElementById("advancedContextMenu").classList.contains("hidden")) {
      e.preventDefault();
      contextOpenNewTab();
    } 
    // otherwise, opens the checkboxed first file in newtab
    else {
      const checkedFile = document.querySelector(".file-item-check:checked");
      if (checkedFile) {
        e.preventDefault();
        advancedContextItem = {
          messageId: checkedFile.getAttribute("data-id"),
          name: checkedFile.getAttribute("data-name")
        };
        contextOpenNewTab();
      }
    }
  }
});

// Handle Middle Mouse Click (Wheel Click) for New Tab
function handleMiddleClick(e, messageId, name) {
  // e.button === 1 means wheel button
  if (e.button === 1) {
    e.preventDefault();
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('preview_msg_id', messageId);
    url.searchParams.set('preview_name', name);
    if(isGuestMode && currentShareId) url.searchParams.set('share', currentShareId);
    
    window.open(url.toString(), '_blank');
  }
}


renderPortalView();
