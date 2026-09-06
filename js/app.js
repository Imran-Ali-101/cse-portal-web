const API_BASE = "https://varsity-portal-api.onrender.com";
let ws = null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentSelectedFolder = "/";
let allFiles = [];
let allFolders = [];
let activeContextItem = null;

// Modal Animation Helpers
function showAnimatedModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("modal-hidden");
}

function hideAnimatedModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("modal-hidden");
}

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

function isAdmin() {
  return currentUser && (currentUser.role === 'super_admin' || currentUser.student_id === '2510376101');
}

// Pure SPA/AJAX View Switcher
function renderPortalView() {
  const guestView = document.getElementById("guestLandingView");
  const authView = document.getElementById("authenticatedView");
  const adminDropzone = document.getElementById("adminDropzoneArea");
  const adminSidebar = document.getElementById("adminSidebarSection");
  const adminActionTrash = document.getElementById("adminActionTrashBtn");
  const adminToolbarTrash = document.getElementById("adminToolbarTrashBtn");
  const navAuth = document.getElementById("navAuthSection");
  const sidebarBtn = document.getElementById("sidebarToggleBtn");

  if (currentUser) {
    guestView.classList.add("hidden");
    authView.classList.remove("hidden");
    sidebarBtn.classList.remove("hidden");

    navAuth.innerHTML = `
      <span class="text-xs text-slate-500 hidden sm:inline font-mono">${currentUser.name}</span>
      <button onclick="handleLogout()" class="border border-rose-300 text-rose-600 hover:bg-rose-50 text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5">
        <i class="fa-solid fa-arrow-right-from-bracket"></i> Logout
      </button>
    `;

    if (isAdmin()) {
      adminDropzone.classList.remove("hidden");
      adminSidebar.classList.remove("hidden");
      adminActionTrash.classList.remove("hidden");
      adminToolbarTrash.classList.remove("hidden");
    } else {
      adminDropzone.classList.add("hidden");
      adminSidebar.classList.add("hidden");
      adminActionTrash.classList.add("hidden");
      adminToolbarTrash.classList.add("hidden");
    }

    loadFolders();
    loadFiles();
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
    toggleAuthForms(isRegister);
    showAnimatedModal("authModal");
  } else {
    hideAnimatedModal("authModal");
  }
}

function toggleAuthForms(showRegister) {
  document.getElementById("loginSection").classList.toggle("hidden", showRegister);
  document.getElementById("registerSection").classList.toggle("hidden", !showRegister);
}

// Pure AJAX Authentication
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
    if (!res.ok) {
      if (res.status === 400 && data.detail && data.detail.includes("already registered")) {
        throw new Error("This Student ID is already registered! Please login.");
      }
      throw new Error(data.detail || "Registration failed");
    }
    showToast("Registration Complete! Please Login", "success");
    toggleAuthForms(false);
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

// Load & Manage Folders
async function loadFolders() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/folders/list`);
    allFolders = await res.json();
    
    const moveSelect = document.getElementById("moveFolderSelect");
    moveSelect.innerHTML = `<option value="/">Home (/)</option>`;
    allFolders.forEach(f => {
      if(f.folder_name !== '/') {
        moveSelect.innerHTML += `<option value="${f.folder_name}">${f.folder_name}</option>`;
      }
    });
    renderFilesTable();
  } catch(e) { console.error(e); }
}

function selectFolder(path) {
  currentSelectedFolder = path;
  document.getElementById("breadcrumbPath").innerHTML = path === '/' ? '' : ` / <span class="text-slate-800 dark:text-white font-bold">${path}</span>`;
  document.getElementById("activeFolderBadge").innerText = `Folder: ${path}`;
  document.getElementById("dropzoneCurrentFolderLabel").innerText = path === '/' ? 'Home (/)' : path;
  renderFilesTable();
}

function openFolderModal() { 
  if (!isAdmin()) return showToast("Only Admin can create folders", "error");
  showAnimatedModal("folderModal"); 
}
function closeFolderModal() { hideAnimatedModal("folderModal"); }

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

// Upload with Progress Bar Modal (Subfolder Aware)
function uploadSelectedFile(input) {
  if (!isAdmin()) return showToast("Only Admin can upload files", "error");
  if (!input.files[0]) return;
  
  const file = input.files[0];
  const formData = new FormData();
  formData.append("file", file);
  formData.append("folder", currentSelectedFolder); // Correctly associates to active folder

  const progressBar = document.getElementById("uploadProgressBar");
  const progressText = document.getElementById("uploadProgressText");

  showAnimatedModal("uploadProgressModal");
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
    hideAnimatedModal("uploadProgressModal");
    input.value = "";
    if (xhr.status >= 200 && xhr.status < 300) {
      showToast("Uploaded successfully to " + (currentSelectedFolder === '/' ? 'Home' : currentSelectedFolder), "success");
      loadFiles();
    } else {
      showToast("Upload failed, please try again.", "error");
    }
  };

  xhr.onerror = () => {
    hideAnimatedModal("uploadProgressModal");
    showToast("Network error during upload", "error");
  };

  xhr.send(formData);
}

async function loadFiles() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/slides/list`);
    allFiles = await res.json();
    renderFilesTable();
  } catch(e) { console.error(e); }
}

// Render Folders & Files inside Main Table
function renderFilesTable() {
  const container = document.getElementById("fileTableContent");
  const filteredFiles = currentSelectedFolder === '/' 
    ? allFiles.filter(f => f.folder_path === '/' || !f.folder_path) 
    : allFiles.filter(f => f.folder_path === currentSelectedFolder);

  let foldersMarkup = "";
  if (currentSelectedFolder === '/') {
    const validFolders = allFolders.filter(f => f.folder_name !== '/');
    foldersMarkup = validFolders.map(f => `
      <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition border-b border-slate-100 dark:border-slate-800">
        <div onclick="selectFolder('${f.folder_name}')" class="col-span-8 md:col-span-9 flex items-center gap-3 overflow-hidden cursor-pointer">
          <i class="fa-solid fa-folder text-amber-500 text-base"></i>
          <span class="font-medium truncate text-slate-800 dark:text-slate-200 hover:text-blue-600">${f.folder_name}</span>
        </div>
        <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono text-[11px]">
          <span>Folder</span>
          <button onclick="openItemActionMenu(event, '${f.id}', null, '${f.folder_name}', true)" class="hover:text-slate-600 p-1">
            <i class="fa-solid fa-ellipsis-vertical"></i>
          </button>
        </div>
      </div>
    `).join('');
  }

  const filesMarkup = filteredFiles.map(f => `
    <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div class="col-span-8 md:col-span-9 flex items-center gap-3 overflow-hidden">
        <input type="checkbox" value="${f.id}" data-id="${f.telegram_message_id}" data-name="${f.file_name}" class="file-item-check rounded border-slate-300">
        <i class="fa-solid fa-file-lines text-slate-400 text-sm"></i>
        <span onclick="openPreview('${f.file_name}', ${f.telegram_message_id})" class="truncate cursor-pointer hover:text-blue-600 font-medium text-slate-700 dark:text-slate-200">${f.file_name}</span>
      </div>
      <div class="col-span-4 md:col-span-3 flex items-center justify-end gap-3 text-slate-400 font-mono">
        <span>${formatBytes(f.file_size)}</span>
        <button onclick="openItemActionMenu(event, '${f.id}', ${f.telegram_message_id}, '${f.file_name}', false)" class="hover:text-slate-600 p-1">
          <i class="fa-solid fa-ellipsis-vertical"></i>
        </button>
      </div>
    </div>
  `).join('');

  if (foldersMarkup === "" && filesMarkup === "") {
    container.innerHTML = `<div class="text-center py-10 text-slate-400">No files in this folder.</div>`;
  } else {
    container.innerHTML = foldersMarkup + filesMarkup;
  }
}

// 3-Dots Action Menu Handling (Files & Folders)
function openItemActionMenu(e, id, messageId, name, isFolder = false) {
  e.stopPropagation();
  activeContextItem = { id, messageId, name, isFolder };
  const menu = document.getElementById("itemActionMenu");

  const downloadBtn = document.getElementById("menuDownloadBtn");
  const shareBtn = document.getElementById("menuShareBtn");
  const moveBtn = document.getElementById("menuMoveBtn");
  const trashBtn = document.getElementById("menuTrashBtn");
  const delFolderBtn = document.getElementById("menuDeleteFolderBtn");

  if (isFolder) {
    downloadBtn.classList.add("hidden");
    shareBtn.classList.add("hidden");
    moveBtn.classList.add("hidden");
    trashBtn.classList.add("hidden");
    if (isAdmin()) delFolderBtn.classList.remove("hidden");
  } else {
    delFolderBtn.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
    shareBtn.classList.remove("hidden");
    if (isAdmin()) {
      moveBtn.classList.remove("hidden");
      trashBtn.classList.remove("hidden");
    } else {
      moveBtn.classList.add("hidden");
      trashBtn.classList.add("hidden");
    }
  }
  
  const rect = e.target.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  menu.style.left = `${Math.min(rect.left + window.scrollX - 120, window.innerWidth - 180)}px`;
  menu.classList.remove("hidden");
}

async function deleteCurrentFolder() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  if (!confirm(`Are you sure you want to delete "${activeContextItem.name}"? All files inside will be moved to Trash.`)) return;

  try {
    const res = await fetch(`${API_BASE}/folders/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_name: activeContextItem.name })
    });
    if (!res.ok) throw new Error("Could not delete folder");
    showToast("Folder deleted and files moved to Trash", "success");
    loadFolders();
    loadFiles();
  } catch(err) {
    showToast(err.message, "error");
  }
}

function triggerDownloadCurrentItem() {
  if (!activeContextItem) return;
  const a = document.createElement("a");
  a.href = `${API_BASE}/slides/stream/${activeContextItem.messageId}?filename=${encodeURIComponent(activeContextItem.name)}`;
  a.download = activeContextItem.name;
  a.click();
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function copyCurrentShareLink() {
  if (!activeContextItem) return;
  const link = `${API_BASE}/slides/stream/${activeContextItem.messageId}?filename=${encodeURIComponent(activeContextItem.name)}`;
  navigator.clipboard.writeText(link);
  showToast("Direct link copied to clipboard!", "success");
  document.getElementById("itemActionMenu").classList.add("hidden");
}

function openMoveModalForCurrentItem() {
  if (!activeContextItem) return;
  document.getElementById("moveTargetFileId").value = activeContextItem.id;
  document.getElementById("itemActionMenu").classList.add("hidden");
  showAnimatedModal("moveModal");
}

function closeMoveModal() { hideAnimatedModal("moveModal"); }

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
    loadFiles();
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
    loadFiles();
  } catch(err) { showToast(err.message, "error"); }
}

// Admin Trash Bin Modal
async function openAdminTrashModal() {
  if (!isAdmin()) return;
  showAnimatedModal("adminTrashModal");
  loadTrashFiles();
}

function closeAdminTrashModal() { hideAnimatedModal("adminTrashModal"); }

async function loadTrashFiles() {
  const container = document.getElementById("trashListContainer");
  try {
    const res = await fetch(`${API_BASE}/admin/trash/list`);
    const files = await res.json();

    if (files.length === 0) {
      container.innerHTML = `<p class="text-center py-10 text-slate-400">Trash is completely empty.</p>`;
      return;
    }

    container.innerHTML = files.map(f => `
      <div class="flex items-center justify-between py-3">
        <div class="flex items-center gap-2 truncate">
          <i class="fa-solid fa-file text-rose-400"></i>
          <span class="truncate font-medium">${f.file_name}</span>
          <span class="text-[10px] text-slate-400 font-mono">(${formatBytes(f.file_size)})</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="restoreTrashFile('${f.id}')" class="px-2.5 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium">Restore</button>
          <button onclick="permanentlyDeleteFile('${f.id}')" class="px-2.5 py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100 font-medium">Delete Forever</button>
        </div>
      </div>
    `).join('');
  } catch(e) { console.error(e); }
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
    loadFiles();
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

async function downloadSelectedZip() {
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("Select files to download", "error");

  showToast("Packing ZIP archive...", "info");
  const zip = new JSZip();
  for (let box of checked) {
    const id = box.getAttribute("data-id");
    const name = box.getAttribute("data-name");
    const res = await fetch(`${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}`);
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
  const streamUrl = `${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}`;
  document.getElementById("previewFrame").src = streamUrl;
  document.getElementById("previewDownloadDirect").href = streamUrl;
  showAnimatedModal("previewModal");
}

function closePreview() {
  hideAnimatedModal("previewModal");
  document.getElementById("previewFrame").src = "";
}

// Fullscreen Live Chat View Handlers
function openChatFullscreen() {
  if (!currentUser) return showToast("Please login first", "error");
  document.getElementById("chatModal").classList.remove("chat-closed");
  initWebSocket();
}

function closeChatFullscreen() { 
  document.getElementById("chatModal").classList.add("chat-closed"); 
}

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
    <div class="px-3.5 py-2 rounded-2xl max-w-[80%] text-xs shadow-xs ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none'}">
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

// Initial View Render
renderPortalView();
