const API_BASE = "https://varsity-portal-api.onrender.com";
let ws = null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentSelectedFolder = "/";

// --- Custom Toast Alert Notification ---
function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  
  let bg = "bg-slate-900 border-indigo-500/50 text-indigo-300";
  let icon = "fa-circle-info";
  if (type === "success") {
    bg = "bg-slate-900 border-emerald-500/50 text-emerald-400";
    icon = "fa-circle-check";
  } else if (type === "error") {
    bg = "bg-slate-900 border-rose-500/50 text-rose-400";
    icon = "fa-triangle-exclamation";
  }

  toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-md transition-all duration-300 transform translate-y-4 opacity-0 text-xs font-medium ${bg}`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i> <span>${message}</span>`;
  
  container.appendChild(toast);
  setTimeout(() => toast.classList.remove("translate-y-4", "opacity-0"), 10);
  setTimeout(() => {
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Theme Management ---
function initTheme() {
  const isDark = localStorage.getItem("theme") !== "light";
  document.documentElement.classList.toggle("dark", isDark);
  document.getElementById("themeIcon").className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  document.getElementById("themeIcon").className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
}

function toggleSidebar(show) {
  document.getElementById("sideDrawer").classList.toggle("hidden", !show);
}

// --- Auth Header & Modal Controls ---
function renderHeader() {
  const el = document.getElementById("authHeaderAction");
  const adminHeader = document.getElementById("adminActionHeader");
  
  if (currentUser) {
    if (currentUser.role === 'super_admin' || currentUser.student_id === '2510376101') {
      adminHeader.classList.remove("hidden");
    }
    el.innerHTML = `
      <button onclick="openProfileModal()" class="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-xl transition">
        <i class="fa-solid fa-circle-user text-indigo-500"></i>
        <span class="text-xs font-medium">${currentUser.name.split(' ')[0]}</span>
      </button>
    `;
  } else {
    adminHeader.classList.add("hidden");
    el.innerHTML = `
      <button onclick="toggleAuthModal(true)" class="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-xl font-medium shadow-md shadow-indigo-600/20 transition">Login / Register</button>
    `;
  }
}

function toggleAuthModal(show) {
  document.getElementById("authModal").classList.toggle("hidden", !show);
}

function showRegisterForm(show) {
  document.getElementById("loginFormSection").classList.toggle("hidden", show);
  document.getElementById("registerFormSection").classList.toggle("hidden", !show);
}

// --- Auth Handlers with Spinner ---
async function handleLogin() {
  const student_id = document.getElementById("loginId").value.trim();
  const password = document.getElementById("loginPass").value.trim();
  if (!student_id || !password) return showToast("Please fill all fields", "error");

  const btn = document.getElementById("loginSubmitBtn");
  const text = document.getElementById("loginBtnText");
  const spinner = document.getElementById("loginSpinner");

  btn.disabled = true;
  text.classList.add("hidden");
  spinner.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({student_id, password})
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Login failed");
    
    localStorage.setItem("user", JSON.stringify(data));
    showToast("Logged in successfully!", "success");
    setTimeout(() => location.reload(), 600);
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    text.classList.remove("hidden");
    spinner.classList.add("hidden");
  }
}

async function handleRegister() {
  const name = document.getElementById("regName").value.trim();
  const student_id = document.getElementById("regId").value.trim();
  const password = document.getElementById("regPass").value.trim();
  const q1 = document.getElementById("secQ1").value.trim();
  const a1 = document.getElementById("secA1").value.trim();

  if (!name || !student_id || !password || !q1 || !a1) return showToast("Please complete all inputs", "error");

  const btn = document.getElementById("regSubmitBtn");
  const text = document.getElementById("regBtnText");
  const spinner = document.getElementById("regSpinner");

  btn.disabled = true;
  text.classList.add("hidden");
  spinner.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, student_id, password, security_questions: [{question: q1, answer: a1}] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");
    
    showToast("Account registered! Please login.", "success");
    showRegisterForm(false);
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    text.classList.remove("hidden");
    spinner.classList.add("hidden");
  }
}

function handleLogout() {
  localStorage.removeItem("user");
  location.reload();
}

function openProfileModal() {
  if (!currentUser) return toggleAuthModal(true);
  document.getElementById("profName").innerText = currentUser.name;
  document.getElementById("profId").innerText = `ID: ${currentUser.student_id}`;
  
  const roleBadge = document.getElementById("profRole");
  if (currentUser.role === 'super_admin') {
    roleBadge.innerText = "Super Admin";
    roleBadge.className = "inline-block text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400";
  } else {
    roleBadge.innerText = "Verified Student";
    roleBadge.className = "inline-block text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400";
  }
  document.getElementById("profileModal").classList.remove("hidden");
}

function closeProfileModal() {
  document.getElementById("profileModal").classList.add("hidden");
}

// --- Folder Management ---
async function loadFolders() {
  try {
    const res = await fetch(`${API_BASE}/folders/list`);
    const folders = await res.json();
    
    const sidebarList = document.getElementById("sidebarFolderList");
    const uploadSelect = document.getElementById("uploadFolderSelect");
    
    sidebarList.innerHTML = `<div onclick="selectFolder('/')" class="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${currentSelectedFolder === '/' ? 'text-indigo-500 font-bold' : ''}"><span><i class="fa-solid fa-house mr-2"></i>Root Folder (/)</span></div>`;
    uploadSelect.innerHTML = `<option value="/">Root Folder (/)</option>`;

    folders.forEach(f => {
      if (f.folder_name !== '/') {
        sidebarList.innerHTML += `
          <div onclick="selectFolder('${f.folder_name}')" class="flex items-center justify-between p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${currentSelectedFolder === f.folder_name ? 'text-indigo-500 font-bold' : ''}">
            <span><i class="fa-regular fa-folder text-amber-500 mr-2"></i>${f.folder_name}</span>
          </div>
        `;
        uploadSelect.innerHTML += `<option value="${f.folder_name}">${f.folder_name}</option>`;
      }
    });
  } catch(e) { console.error(e); }
}

function selectFolder(name) {
  currentSelectedFolder = name;
  document.getElementById("currentFolderTitle").innerText = name === '/' ? 'All Materials' : name;
  loadFolders();
  loadFiles();
  toggleSidebar(false);
}

async function handleCreateFolder() {
  const name = document.getElementById("newFolderNameInput").value.trim();
  if (!name) return showToast("Folder name is required", "error");

  const formData = new FormData();
  formData.append("folder_name", name);

  try {
    const res = await fetch(`${API_BASE}/folders/create`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Failed to create folder");
    
    showToast("Folder created successfully!", "success");
    document.getElementById("newFolderNameInput").value = "";
    closeFolderModal();
    loadFolders();
  } catch(err) {
    showToast(err.message, "error");
  }
}

function openFolderModal() { document.getElementById("folderModal").classList.remove("hidden"); }
function closeFolderModal() { document.getElementById("folderModal").classList.add("hidden"); }

// --- File Storage & Upload Operations ---
function openUploadModal() { document.getElementById("uploadModal").classList.remove("hidden"); }
function closeUploadModal() { document.getElementById("uploadModal").classList.add("hidden"); }

async function handleFileUpload() {
  const fileInput = document.getElementById("slideFileInput");
  const folder = document.getElementById("uploadFolderSelect").value;
  if (!fileInput.files[0]) return showToast("Please select a file to upload", "error");

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("folder", folder);

  const btn = document.getElementById("uploadSubmitBtn");
  const text = document.getElementById("uploadBtnText");
  const spinner = document.getElementById("uploadSpinner");

  btn.disabled = true;
  text.classList.add("hidden");
  spinner.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/slides/upload`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Upload failed");
    
    showToast("Slide uploaded successfully!", "success");
    closeUploadModal();
    fileInput.value = "";
    loadFiles();
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false;
    text.classList.remove("hidden");
    spinner.classList.add("hidden");
  }
}

async function loadFiles() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/slides/list`);
    let files = await res.json();
    
    if (currentSelectedFolder !== '/') {
      files = files.filter(f => f.folder_path === currentSelectedFolder);
    }

    const container = document.getElementById("fileContainer");
    if (files.length === 0) {
      container.innerHTML = `<p class="text-slate-400 dark:text-slate-500 text-xs text-center py-6">No slides found in this folder.</p>`;
      return;
    }
    
    container.innerHTML = files.map(f => `
      <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 hover:border-indigo-500 transition">
        <div class="flex items-center gap-3 overflow-hidden">
          <input type="checkbox" data-id="${f.telegram_message_id}" data-name="${f.file_name}" class="file-checkbox rounded border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950">
          <i class="fa-solid fa-file-pdf text-rose-500 text-lg"></i>
          <span class="text-xs truncate font-medium text-slate-700 dark:text-slate-200 cursor-pointer hover:underline" onclick="openViewer(${f.telegram_message_id}, '${f.file_name}')">${f.file_name}</span>
        </div>
        <button onclick="openViewer(${f.telegram_message_id}, '${f.file_name}')" class="text-xs text-indigo-600 dark:text-indigo-400 hover:underline px-2 py-1">
          <i class="fa-solid fa-eye mr-1"></i> Preview
        </button>
      </div>
    `).join('');
  } catch(e) { console.error(e); }
}

function openViewer(id, name) {
  document.getElementById("previewFileName").innerText = name;
  document.getElementById("pdfFrame").src = `${API_BASE}/slides/stream/${id}`;
  document.getElementById("pdfModal").classList.remove("hidden");
}

function closeViewer() {
  document.getElementById("pdfModal").classList.add("hidden");
  document.getElementById("pdfFrame").src = "";
}

async function downloadSelectedZip() {
  const checked = document.querySelectorAll(".file-checkbox:checked");
  if (checked.length === 0) return showToast("Select at least one slide to download ZIP", "error");
  
  showToast("Packing ZIP archive...", "info");
  const zip = new JSZip();
  for (let box of checked) {
    const id = box.getAttribute("data-id");
    const name = box.getAttribute("data-name");
    const res = await fetch(`${API_BASE}/slides/stream/${id}`);
    const blob = await res.blob();
    zip.file(name, blob);
  }
  const zipBlob = await zip.generateAsync({type: "blob"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = "Course_Materials.zip";
  link.click();
  showToast("Download started!", "success");
}

// --- Live WebSockets Chat ---
function initWebSocket() {
  if (!currentUser) return;
  document.getElementById("chatInput").disabled = false;
  document.getElementById("chatSendBtn").disabled = false;

  fetch(`${API_BASE}/chat/history`)
    .then(res => res.json())
    .then(msgs => {
      document.getElementById("chatMessages").innerHTML = "";
      msgs.forEach(appendMessage);
    });

  const wsUrl = API_BASE.replace("https://", "wss://").replace("http://", "ws://") + "/ws/chat";
  ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => appendMessage(JSON.parse(e.data));
}

function appendMessage(msg) {
  const box = document.getElementById("chatMessages");
  const isMe = currentUser && currentUser.student_id === msg.student_id;
  const el = document.createElement("div");
  el.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
  el.innerHTML = `
    <span class="text-[9px] text-slate-400 mb-0.5">${msg.sender_name} (${msg.student_id})</span>
    <div class="px-3 py-1.5 rounded-2xl max-w-[85%] text-xs ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none'}">
      ${msg.message}
    </div>
  `;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function sendLiveMessage(e) {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  if (!input.value.trim() || !ws) return;
  ws.send(JSON.stringify({ student_id: currentUser.student_id, sender_name: currentUser.name, message: input.value.trim() }));
  input.value = "";
}

// --- Init ---
initTheme();
renderHeader();
loadFolders();
if (currentUser) {
  loadFiles();
  initWebSocket();
}
