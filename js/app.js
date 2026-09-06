const API_BASE = "https://varsity-portal-api.onrender.com";
let ws = null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentSelectedFolder = "/";
let allFiles = [];
let allFolders = [];
let activeContextItem = null;

function showToast(message, type = "info") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  let border = type === "success" ? "border-emerald-500 text-emerald-500" : (type === "error" ? "border-rose-500 text-rose-500" : "border-blue-500 text-blue-500");
  toast.className = `flex items-center gap-2 px-4 py-3 rounded-xl border bg-white dark:bg-slate-900 shadow-xl text-xs font-medium ${border}`;
  toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-check' : (type === 'error' ? 'fa-exclamation' : 'fa-info')}"></i> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 KB';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderHeader() {
  const el = document.getElementById("navAuthSection");
  if (currentUser) {
    el.innerHTML = `
      <span class="text-xs text-slate-500 hidden sm:inline font-mono">${currentUser.name}</span>
      <button onclick="handleLogout()" class="border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
        <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
      </button>
    `;
  } else {
    el.innerHTML = `
      <button onclick="toggleAuthModal(true)" class="bg-blue-600 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
        Login
      </button>
    `;
  }
}

function toggleAuthModal(show) { document.getElementById("authModal").classList.toggle("hidden", !show); }
function toggleAuthForms(showRegister) {
  document.getElementById("loginSection").classList.toggle("hidden", showRegister);
  document.getElementById("registerSection").classList.toggle("hidden", !showRegister);
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
    localStorage.setItem("user", JSON.stringify(data));
    location.reload();
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false; text.classList.remove("hidden"); spin.classList.add("hidden");
  }
}

async function handleRegister() {
  const name = document.getElementById("regName").value.trim();
  const student_id = document.getElementById("regId").value.trim();
  const password = document.getElementById("regPass").value.trim();
  const q1 = document.getElementById("secQ1").value.trim();
  const a1 = document.getElementById("secA1").value.trim();

  if (!name || !student_id || !password || !q1 || !a1) return showToast("Fill all fields", "error");

  const btn = document.getElementById("regSubmitBtn");
  const text = document.getElementById("regText");
  const spin = document.getElementById("regSpin");
  btn.disabled = true; text.classList.add("hidden"); spin.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, student_id, password, security_questions: [{question: q1, answer: a1}] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Registration failed");
    showToast("Registration Complete! Please Login", "success");
    toggleAuthForms(false);
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btn.disabled = false; text.classList.remove("hidden"); spin.classList.add("hidden");
  }
}

function handleLogout() {
  localStorage.removeItem("user");
  location.reload();
}

function toggleSidebar(show) { document.getElementById("sideDrawer").classList.toggle("hidden", !show); }
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

async function loadFolders() {
  try {
    const res = await fetch(`${API_BASE}/folders/list`);
    allFolders = await res.json();
    const container = document.getElementById("drawerFolderList");
    const moveSelect = document.getElementById("moveFolderSelect");
    
    container.innerHTML = `<div onclick="selectFolder('/')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${currentSelectedFolder === '/' ? 'font-bold text-blue-600' : ''}"><i class="fa-solid fa-house mr-2"></i>Home</div>`;
    moveSelect.innerHTML = `<option value="/">Home (/)</option>`;

    allFolders.forEach(f => {
      if(f.folder_name !== '/') {
        container.innerHTML += `
          <div onclick="selectFolder('${f.folder_name}')" class="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer ${currentSelectedFolder === f.folder_name ? 'font-bold text-blue-600' : ''}">
            <i class="fa-regular fa-folder text-amber-500 mr-2"></i>${f.folder_name}
          </div>
        `;
        moveSelect.innerHTML += `<option value="${f.folder_name}">${f.folder_name}</option>`;
      }
    });
  } catch(e) { console.error(e); }
}

function selectFolder(path) {
  currentSelectedFolder = path;
  document.getElementById("breadcrumbPath").innerHTML = path === '/' ? '' : ` / <span class="text-slate-800 dark:text-white">${path}</span>`;
  loadFolders();
  renderFilesTable();
}

function openFolderModal() { document.getElementById("folderModal").classList.remove("hidden"); }
function closeFolderModal() { document.getElementById("folderModal").classList.add("hidden"); }

async function handleCreateFolder() {
  const name = document.getElementById("newFolderName").value.trim();
  if (!name) return showToast("Enter folder name", "error");
  const formData = new FormData();
  formData.append("folder_name", name);
  try {
    const res = await fetch(`${API_BASE}/folders/create`, { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);
    showToast("Folder created!", "success");
    closeFolderModal();
    document.getElementById("newFolderName").value = "";
    loadFolders();
  } catch(err) {
    showToast(err.message, "error");
  }
}

// Upload with Progress Bar Modal
function uploadSelectedFile(input) {
  if (!currentUser) return toggleAuthModal(true);
  if (!input.files[0]) return;
  
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", currentSelectedFolder);

  const progressModal = document.getElementById("uploadProgressModal");
  const progressBar = document.getElementById("uploadProgressBar");
  const progressText = document.getElementById("uploadProgressText");

  progressModal.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressText.innerText = `0 KB / ${formatBytes(file.size)}`;

  const xhr = new XMLHttpRequest();
  xhr.open("POST", `${API_BASE}/slides/upload`, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = `${percent}%`;
      progressText.innerText = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
    }
  };

  xhr.onload = () => {
    progressModal.classList.add("hidden");
    input.value = "";
    if (xhr.status >= 200 && xhr.status < 300) {
      showToast("Uploaded successfully to cloud storage!", "success");
      loadFiles();
    } else {
      showToast("Upload failed, please try again.", "error");
    }
  };

  xhr.onerror = () => {
    progressModal.classList.add("hidden");
    showToast("Network error during upload", "error");
  };

  xhr.send(formData);
}

async function loadFiles() {
  try {
    const res = await fetch(`${API_BASE}/slides/list`);
    allFiles = await res.json();
    renderFilesTable();
  } catch(e) { console.error(e); }
}

function renderFilesTable() {
  const container = document.getElementById("fileTableContent");
  const filtered = currentSelectedFolder === '/' ? allFiles : allFiles.filter(f => f.folder_path === currentSelectedFolder);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-10 text-slate-400">No files in this folder.</div>`;
    return;
  }

  container.innerHTML = filtered.map(f => `
    <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div class="col-span-8 md:col-span-9 flex items-center gap-3 overflow-hidden">
        <input type="checkbox" value="${f.id}" data-id="${f.telegram_message_id}" data-name="${f.file_name}" class="file-item-check rounded border-slate-300">
        <i class="fa-solid fa-file-lines text-slate-400 text-sm"></i>
        <span onclick="openPreview('${f.file_name}', ${f.telegram_message_id})" class="truncate cursor-pointer hover:text-blue-600 font-medium">${f.file_name}</span>
      </div>
      <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono">
        <span>${formatBytes(f.file_size)}</span>
        <button onclick="openItemActionMenu(event, '${f.id}', ${f.telegram_message_id}, '${f.file_name}')" class="hover:text-slate-600 p-1">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </div>
    </div>
  `).join('');
}

// 3-Dots Action Menu Handling
function openItemActionMenu(e, id, messageId, name) {
  e.stopPropagation();
  activeContextItem = { id, messageId, name };
  const menu = document.getElementById("itemActionMenu");
  
  const rect = e.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX - 120, window.innerWidth - 180)}px`;
  menu.classList.remove("hidden");
}

function triggerDownloadCurrentItem() {
  if (!activeContextItem) return;
  const a = document.createElement("a");
  a.href = `${API_BASE}/slides/stream/${activeContextItem.messageId}`;
  a.download = activeContextItem.name;
  a.click();
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function copyCurrentShareLink() {
  if (!activeContextItem) return;
  const link = `${API_BASE}/slides/stream/${activeContextItem.messageId}`;
  navigator.clipboard.writeText(link);
  showToast("Direct download link copied to clipboard!", "success");
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function openMoveModalForCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("moveTargetFileId").value = activeContextItem.id;
  document.getElementById("itemActionMenu").classList.add("hidden");
  document.getElementById("moveModal").classList.remove("hidden");
}

function closeMoveModal() {
  document.getElementById("moveModal").classList.add("hidden");
}

async function executeMoveFile() {
  const fileId = document.getElementById("moveTargetFileId").value;
  const target = document.getElementById("moveFolderSelect").value;
  try {
    const res = await fetch(`${API_BASE}/slides/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId, target_folder: target })
    });
    if (!res.ok) throw new Error("Move failed");
    showToast(`Moved to ${target}`, "success");
    closeMoveModal();
    loadFiles();
  } catch(err) {
    showToast(err.message, "error");
  }
}

async function deleteCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  try {
    const res = await fetch(`${API_BASE}/slides/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_ids: [activeContextItem.id] })
    });
    if (!res.ok) throw new Error("Delete failed");
    showToast("File deleted", "success");
    loadFiles();
  } catch(err) {
    showToast(err.message, "error");
  }
}

function toggleSelectAll(el) {
  document.querySelectorAll(".file-item-check").forEach(cb => cb.checked = el.checked);
}

function sortFiles(type) {
  const label = document.getElementById("currentSortLabel");
  if (type === 'name_asc') { allFiles.sort((a,b) => a.file_name.localeCompare(b.file_name)); label.innerText = "Name A - Z"; }
  if (type === 'name_desc') { allFiles.sort((a,b) => b.file_name.localeCompare(a.file_name)); label.innerText = "Name Z - A"; }
  if (type === 'newest') { allFiles.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)); label.innerText = "Newest"; }
  if (type === 'oldest') { allFiles.sort((a,b) => new Date(a.created_at) - new Date(b.created_at)); label.innerText = "Oldest"; }
  if (type === 'largest') { allFiles.sort((a,b) => (b.file_size || 0) - (a.file_size || 0)); label.innerText = "Largest"; }
  if (type === 'smallest') { allFiles.sort((a,b) => (a.file_size || 0) - (b.file_size || 0)); label.innerText = "Smallest"; }
  renderFilesTable();
}

async function deleteSelected() {
  if (!currentUser) return toggleAuthModal(true);
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("No files selected", "error");

  const ids = Array.from(checked).map(c => c.value);
  try {
    const res = await fetch(`${API_BASE}/slides/delete`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ file_ids: ids })
    });
    if(!res.ok) throw new Error("Delete failed");
    showToast("Files deleted", "success");
    loadFiles();
  } catch(err) { showToast(err.message, "error"); }
}

async function downloadSelectedZip() {
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("Select files to download", "error");

  showToast("Packing ZIP archive...", "info");
  const zip = new JSZip();
  for (let box of checked) {
    const id = box.getAttribute("data-id");
    const name = box.getAttribute("data-name");
    const res = await fetch(`${API_BASE}/slides/stream/${id}`);
    const blob = await res.blob();
    zip.file(name, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = "downloaded_files.zip";
  link.click();
  showToast("ZIP download started!", "success");
}

function openPreview(name, id) {
  document.getElementById("previewTitle").innerText = name;
  document.getElementById("previewFrame").src = `${API_BASE}/slides/stream/${id}`;
  document.getElementById("previewDownloadDirect").href = `${API_BASE}/slides/stream/${id}`;
  document.getElementById("previewModal").classList.remove("hidden");
}
function closePreview() {
  document.getElementById("previewModal").classList.add("hidden");
  document.getElementById("previewFrame").src = "";
}

// Live Chat Handlers
function openChatWindow() {
  if (!currentUser) return toggleAuthModal(true);
  document.getElementById("chatModal").classList.remove("hidden");
  initWebSocket();
}
function closeChatWindow() { document.getElementById("chatModal").classList.add("hidden"); }

function initWebSocket() {
  fetch(`${API_BASE}/chat/history`)
    .then(res => res.json())
    .then(msgs => {
      const box = document.getElementById("chatMessages");
      box.innerHTML = "";
      msgs.forEach(appendMessage);
    });

  if (!ws) {
    const wsUrl = API_BASE.replace("https://", "wss://").replace("http://", "ws://") + "/ws/chat";
    ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => appendMessage(JSON.parse(e.data));
  }
}

function appendMessage(msg) {
  const box = document.getElementById("chatMessages");
  const isMe = currentUser && currentUser.student_id === msg.student_id;
  const el = document.createElement("div");
  el.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
  el.innerHTML = `
    <span class="text-[9px] text-slate-400 mb-0.5">${msg.sender_name} (${msg.student_id})</span>
    <div class="px-3 py-1.5 rounded-2xl max-w-[80%] text-xs ${isMe ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200'}">
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

// App Launch
renderHeader();
loadFolders();
loadFiles();
