const API_BASE = "https://varsity-portal-api.onrender.com";
let ws = null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");
let currentSelectedFolder = "/";
let allFiles = [];
let allFolders = [];
let allNotices = [];
let activeContextItem = null;
let activePreviewItem = null;
let activeNoticeTarget = null;

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
    ${subtitle ? `<span class="text-[10px] text-slate-400 font-normal pl-5">${subtitle}</span>` : ''}
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
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

function isFileBanned() {
  if (!currentUser || !currentUser.file_banned_until) return false;
  return new Date() < new Date(currentUser.file_banned_until);
}

// Generates secured media stream URL with token parameter
function getSecuredStreamUrl(messageId, fileName) {
  const token = currentUser ? currentUser.token : '';
  return `${API_BASE}/slides/stream/${message_id}?filename=${encodeURIComponent(fileName)}&token=${token}`;
}

async function syncUserRole() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/auth/check-role/${currentUser.student_id}`);
    if (res.ok) {
      const data = await res.json();
      currentUser.role = data.role;
      currentUser.chat_banned_until = data.chat_banned_until;
      currentUser.file_banned_until = data.file_banned_until;
      localStorage.setItem("user", JSON.stringify(currentUser));
    }
  } catch(e) {}
}

// Pure SPA View Switcher
async function renderPortalView() {
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
    } else {
      adminDropzone.classList.add("hidden");
      adminSidebar.classList.add("hidden");
      adminActionTrash.classList.add("hidden");
      adminToolbarTrash.classList.add("hidden");
    }

    if (isPrimarySuperAdmin()) {
      clearChatBtn.classList.remove("hidden");
    } else {
      clearChatBtn.classList.add("hidden");
    }

    loadFolders();
    loadFiles();
    initWebSocket();
    checkUnseenNotices();
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

// Authentication Handlers
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
        throw new Error("Student ID already registered! Please login.");
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

// Folders Management
async function loadFolders() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/folders/list`);
    allFolders = await res.json();
    
    allFolders = allFolders.map(f => {
      let n = f.folder_name;
      if (!n.startsWith('/')) n = '/' + n;
      return { ...f, folder_name: n };
    });

    const moveSelect = document.getElementById("moveFolderSelect");
    moveSelect.innerHTML = `<option value="/">Home (/)</option>`;
    allFolders.forEach(f => {
      if (f.folder_name !== '/') {
        moveSelect.innerHTML += `<option value="${f.folder_name}">${f.folder_name}</option>`;
      }
    });
    renderFilesTable();
  } catch(e) { console.error(e); }
}

function selectFolder(path) {
  currentSelectedFolder = path.startsWith('/') ? path : '/' + path;
  if (currentSelectedFolder !== '/' && currentSelectedFolder.endsWith('/')) {
    currentSelectedFolder = currentSelectedFolder.slice(0, -1);
  }
  document.getElementById("activeFolderPathText").innerText = `Folder: ${currentSelectedFolder}`;
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
    loadFolders();
  } catch(err) {
    showToast(err.message, "error");
  }
}

// Robust Multiple Uploads Handler
async function uploadSelectedFiles(input) {
  if (!isAdmin()) return showToast("Only Admin can upload files", "error");
  if (!input.files || input.files.length === 0) return;
  
  const filesList = Array.from(input.files);
  const totalFiles = filesList.length;

  const progressBar = document.getElementById("uploadProgressBar");
  const progressText = document.getElementById("uploadProgressText");

  showAnimatedModal("uploadProgressModal");

  let uploadedCount = 0;
  for (let i = 0; i < totalFiles; i++) {
    const file = filesList[i];
    progressText.innerText = `Uploading (${i + 1}/${totalFiles}): ${file.name}`;
    progressBar.style.width = `${Math.round(((i) / totalFiles) * 100)}%`;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", currentSelectedFolder);
    formData.append("uploader_name", currentUser ? currentUser.name : "Admin");

    try {
      const res = await fetch(`${API_BASE}/slides/upload`, {
        method: "POST",
        body: formData
      });
      if (res.ok) uploadedCount++;
    } catch(err) {
      console.error(err);
    }
  }

  progressBar.style.width = "100%";
  hideAnimatedModal("uploadProgressModal");
  input.value = "";
  showToast(`Successfully uploaded ${uploadedCount} of ${totalFiles} files!`, "success");
  loadFiles();
}

async function loadFiles() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API_BASE}/slides/list`);
    allFiles = await res.json();
    
    allFiles = allFiles.map(f => {
      let p = f.folder_path || '/';
      if (!p.startsWith('/')) p = '/' + p;
      return { ...f, folder_path: p };
    });

    renderFilesTable();
  } catch(e) { console.error(e); }
}

// Render Files & Folders Table (Full name shown without truncate)
function renderFilesTable() {
  const container = document.getElementById("fileTableContent");
  
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
    const remainder = f.folder_name.slice(currentPrefix.length);
    return remainder.length > 0 && !remainder.includes('/');
  });

  const foldersMarkup = childFolders.map(f => {
    const displayName = f.folder_name.split('/').filter(Boolean).pop();
    return `
      <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/60 transition border-b border-slate-100 dark:border-slate-800">
        <div onclick="selectFolder('${f.folder_name}')" class="col-span-8 md:col-span-9 flex items-center gap-3 cursor-pointer">
          <i class="fa-solid fa-folder text-amber-500 text-base"></i>
          <span class="font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 break-all">${displayName}</span>
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

  const filteredFiles = allFiles.filter(f => f.folder_path === currentSelectedFolder);
  const filesMarkup = filteredFiles.map(f => `
    <div class="grid grid-cols-12 px-4 py-3 items-center hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div class="col-span-8 md:col-span-9 flex items-center gap-3">
        <input type="checkbox" value="${f.id}" data-id="${f.telegram_message_id}" data-name="${f.file_name}" class="file-item-check rounded border-slate-300">
        <i class="fa-solid fa-file-lines text-slate-400 text-sm"></i>
        <span onclick="openPreview('${f.file_name}', ${f.telegram_message_id})" class="cursor-pointer hover:text-blue-600 font-medium text-slate-700 dark:text-slate-200 break-all">${f.file_name}</span>
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

// 3-Dots Action Menu Handling
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

  if (isFolder) {
    downloadBtn.classList.add("hidden");
    shareBtn.classList.add("hidden");
    moveBtn.classList.add("hidden");
    trashBtn.classList.add("hidden");
    downloadFolderBtn.classList.remove("hidden");
    
    if (isAdmin()) {
      delFolderBtn.classList.remove("hidden");
      renameBtn.classList.remove("hidden");
    } else {
      delFolderBtn.classList.add("hidden");
      renameBtn.classList.add("hidden");
    }
  } else {
    delFolderBtn.classList.add("hidden");
    downloadFolderBtn.classList.add("hidden");
    downloadBtn.classList.remove("hidden");
    shareBtn.classList.remove("hidden");

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
  const menuWidth = 200;
  const menuHeight = isFolder ? 110 : 190;

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

// Rename Handler (File & Folder)
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
    loadFolders();
    loadFiles();
  } catch(err) {
    showToast(err.message, "error");
  }
}

// Direct File Download via Blob (With Auth Token Attached)
async function downloadDirectFile(messageId, fileName) {
  showToast(`Downloading ${fileName}...`, "info");
  try {
    const token = currentUser ? currentUser.token : '';
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
    showToast("Download completed!", "success");
  } catch(err) {
    showToast("Error downloading file (Login required)", "error");
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

// Download Target Folder in Hierarchical ZIP
async function triggerDownloadTargetFolder() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");

  const targetPath = activeContextItem.name;
  const filesToPack = allFiles.filter(f => f.folder_path === targetPath || f.folder_path.startsWith(targetPath + '/'));

  if (filesToPack.length === 0) return showToast("This folder is empty, nothing to download", "error");

  showToast(`Packing full folder into ZIP...`, "info");
  const zip = new JSZip();
  const token = currentUser ? currentUser.token : '';

  for (let f of filesToPack) {
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

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const folderName = targetPath.split('/').filter(Boolean).pop() || "Folder";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(zipBlob);
  link.download = `${folderName}.zip`;
  link.click();
  showToast(`Folder ${folderName}.zip download complete!`, "success");
}

async function deleteCurrentFolder() {
  if (!activeContextItem || !activeContextItem.isFolder) return;
  document.getElementById("itemActionMenu").classList.add("hidden");
  if (!confirm(`Delete "${activeContextItem.name}"? Files inside will be moved to Trash.`)) return;

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

function copyCurrentShareLink() {
  if (!activeContextItem) return;
  const token = currentUser ? currentUser.token : '';
  const link = `${API_BASE}/slides/stream/${activeContextItem.messageId}?filename=${encodeURIComponent(activeContextItem.name)}&token=${token}`;
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

// Notice Board Operations & Tracking
async function checkUnseenNotices() {
  try {
    const res = await fetch(`${API_BASE}/notices/list`);
    allNotices = await res.json();
    if (allNotices.length === 0) return;

    const lastSeenId = localStorage.getItem("last_seen_notice_id");
    const latestNotice = allNotices[0];

    if (latestNotice.id !== lastSeenId) {
      document.getElementById("headerUnseenNoticeDot").classList.remove("hidden");
      document.getElementById("noticeBadgeCount").classList.remove("hidden");
      
      const timeFormatted = new Date(latestNotice.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
      });
      showToast(latestNotice.title, "info", `${latestNotice.file_name} • ${timeFormatted}`);
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
    const res = await fetch(`${API_BASE}/notices/list`);
    allNotices = await res.json();

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
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-500 flex items-center justify-center">
              <i class="fa-solid fa-bullhorn text-xs"></i>
            </div>
            <div>
              <span class="font-bold text-slate-800 dark:text-slate-100 block">${n.title}</span>
              <span class="text-[11px] text-slate-500 font-mono">${n.file_name}</span>
            </div>
          </div>
          <span class="text-[10px] text-slate-400 font-mono whitespace-nowrap">${timeFormatted}</span>
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
}

function openNoticeDetails(noticeId) {
  const n = allNotices.find(x => x.id === noticeId);
  if (!n) return;

  activeNoticeTarget = n;
  const timeFormatted = new Date(n.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
  });

  document.getElementById("ndFileName").innerText = n.file_name;
  document.getElementById("ndFolderPath").innerText = n.folder_path;
  document.getElementById("ndUploader").innerText = n.uploaded_by || "Administrator";
  document.getElementById("ndTime").innerText = timeFormatted;

  closeNoticeBoardModal();
  showAnimatedModal("noticeDetailsModal");
}

function closeNoticeDetailsModal() { hideAnimatedModal("noticeDetailsModal"); }

function goToNoticeFolder() {
  if (!activeNoticeTarget) return;
  closeNoticeDetailsModal();
  selectFolder(activeNoticeTarget.folder_path);
}

// User & Role Management
async function openUserManagementModal() {
  if (!isAdmin()) return;
  showAnimatedModal("userManagementModal");
  loadUsersList();
}

function closeUserManagementModal() { hideAnimatedModal("userManagementModal"); }

async function loadUsersList() {
  const container = document.getElementById("usersListContainer");
  try {
    const res = await fetch(`${API_BASE}/admin/users/list`);
    const users = await res.json();

    if (users.length === 0) {
      container.innerHTML = `<p class="text-center py-10 text-slate-400">No users found.</p>`;
      return;
    }

    container.innerHTML = users.map(u => {
      const isSuper = u.student_id === '2510376101';
      const isUserAdmin = u.role === 'super_admin';
      const chatBanned = u.chat_banned_until && new Date() < new Date(u.chat_banned_until);
      const fileBanned = u.file_banned_until && new Date() < new Date(u.file_banned_until);

      return `
        <div class="flex flex-col md:flex-row md:items-center justify-between py-3 gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800 dark:text-slate-100">${u.name}</span>
              <span class="font-mono text-[10px] text-slate-400">(${u.student_id})</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${isUserAdmin ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}">${u.role}</span>
            </div>
            <div class="flex gap-2 text-[10px] text-slate-400 mt-1 font-mono">
              <span>Chat: ${chatBanned ? '<b class="text-rose-500">Banned</b>' : 'Allowed'}</span>
              <span>•</span>
              <span>Files: ${fileBanned ? '<b class="text-rose-500">Banned</b>' : 'Allowed'}</span>
            </div>
          </div>

          ${isSuper ? '<span class="text-emerald-500 font-bold text-xs">Primary Super Admin</span>' : `
            <div class="flex flex-wrap items-center gap-1.5">
              <button onclick="toggleUserRole('${u.student_id}', '${isUserAdmin ? 'student' : 'super_admin'}')" class="px-2.5 py-1 rounded text-xs font-semibold ${isUserAdmin ? 'bg-slate-200 text-slate-700 hover:bg-slate-300' : 'bg-indigo-600 text-white hover:bg-indigo-500'}">
                ${isUserAdmin ? 'Demote to Student' : 'Make Admin'}
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

// Download Checked Items ZIP
async function downloadSelectedZip() {
  const checked = document.querySelectorAll(".file-item-check:checked");
  if (checked.length === 0) return showToast("Select files to download", "error");

  showToast("Packing selected files into ZIP...", "info");
  const zip = new JSZip();
  const token = currentUser ? currentUser.token : '';

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

// Universal In-Browser Preview using Mozilla PDF.js & Live Page Tracking
async function openPreview(name, id) {
  document.getElementById("previewTitle").innerText = name;
  activePreviewItem = { name, id };
  const token = currentUser ? currentUser.token : '';
  const streamUrl = `${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}&token=${token}`;

  const container = document.getElementById("previewContainer");
  const pageIndicator = document.getElementById("pdfPageIndicator");
  pageIndicator.classList.add("hidden");

  container.innerHTML = `<div class="text-center text-slate-400 py-20 flex flex-col items-center gap-2"><span class="spinner"></span><span>Loading document...</span></div>`;
  showAnimatedModal("previewModal");

  const lower = name.toLowerCase();

  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
    container.innerHTML = `<img src="${streamUrl}" alt="${name}" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl">`;
  } else if (lower.endsWith('.pdf')) {
    try {
      const loadingTask = pdfjsLib.getDocument(streamUrl);
      const pdf = await loadingTask.promise;
      container.innerHTML = "";

      pageIndicator.innerText = `Page 1 of ${pdf.numPages}`;
      pageIndicator.classList.remove("hidden");

      const pageCanvases = [];

      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.35 });

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-page-canvas";
        canvas.setAttribute("data-page-number", pageNum);
        const ctx = canvas.getContext("2d");
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        container.appendChild(canvas);
        pageCanvases.push(canvas);

        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      }

      // Live page scrolling observer
      container.onscroll = () => {
        const containerTop = container.getBoundingClientRect().top;
        for (let canvas of pageCanvases) {
          const rect = canvas.getBoundingClientRect();
          if (rect.top - containerTop <= 150 && rect.bottom - containerTop > 50) {
            const currentNum = canvas.getAttribute("data-page-number");
            pageIndicator.innerText = `Page ${currentNum} of ${pdf.numPages}`;
            break;
          }
        }
      };

    } catch(err) {
      container.innerHTML = `
        <div class="text-center p-8 bg-slate-900 rounded-2xl border border-slate-800">
          <p class="text-xs text-rose-400 mb-3">Unable to preview PDF directly.</p>
          <button onclick="downloadActivePreviewFile()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2">
            <i class="fa-solid fa-download"></i> Download PDF
          </button>
        </div>
      `;
    }
  } else {
    container.innerHTML = `
      <div class="text-center p-8 bg-slate-900 rounded-2xl border border-slate-800">
        <i class="fa-solid fa-file-lines text-4xl text-slate-500 mb-3 block"></i>
        <p class="text-sm font-medium text-slate-300 mb-4">No direct preview available for this file type.</p>
        <button onclick="downloadActivePreviewFile()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2">
          <i class="fa-solid fa-download"></i> Download File
        </button>
      </div>
    `;
  }
}

function closePreview() {
  hideAnimatedModal("previewModal");
  document.getElementById("previewContainer").innerHTML = "";
  document.getElementById("pdfPageIndicator").classList.add("hidden");
  activePreviewItem = null;
}

// Fullscreen Live Chat View Handlers
function openChatFullscreen() {
  if (!currentUser) return showToast("Please login first", "error");
  document.getElementById("chatModal").classList.remove("chat-closed");
}

function closeChatFullscreen() { 
  document.getElementById("chatModal").classList.add("chat-closed"); 
}

// Primary Super Admin Clear Chat Handler
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
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "notice") {
        // Handle Live Upload Notice Broadcast
        document.getElementById("headerUnseenNoticeDot").classList.remove("hidden");
        document.getElementById("noticeBadgeCount").classList.remove("hidden");
        showToast(data.title, "info", `${data.file_name} • ${data.time}`);
        loadFiles();
      } else if (data.type === "chat_event" && data.cleared) {
        document.getElementById("chatMessages").innerHTML = "";
        showToast(data.message, "info");
      } else if (data.system) {
        showToast(data.message, "error");
      } else {
        appendMessage(data);
      }
    };
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

// App Launch
renderPortalView();
