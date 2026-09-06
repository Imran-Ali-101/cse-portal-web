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
    ${subtitle ? `<span class="text-[10px] text-slate-400 font-normal pl-5">${subtitle}</span>` : ''}
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
  const adminClearNotices = document.getElementById("adminClearNoticesBtn");
  const adminNoticeComposer = document.getElementById("adminNoticeComposer");

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
    checkUnseenNotices();
    loadDynamicTools();
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
  showAnimatedModal("settingsModal");
}

function closeSettingsModal() {
  hideAnimatedModal("settingsModal");
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
    { file: "cgpa.html", defaultTitle: "CGPA / GPA Suite" }
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
  try {
    const res = await fetch(`${API_BASE}/folders/list?t=${Date.now()}`);
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
  } catch(e) { console.error(e); }
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
      if (res.ok) {
        const jsonRes = await res.json();
        if (jsonRes.file) {
          const newF = jsonRes.file;
          newF.folder_path = (newF.folder_path && newF.folder_path.startsWith('/')) ? newF.folder_path : '/' + (newF.folder_path || '');
          allFiles.unshift(newF);
          renderFilesTable();
        }
        uploadedCount++;
      }
    } catch(err) {
      console.error(err);
    }
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
  try {
    const res = await fetch(`${API_BASE}/slides/list?t=${Date.now()}`);
    const data = await res.json();
    
    allFiles = data.map(f => {
      let p = f.folder_path || '/';
      if (!p.startsWith('/')) p = '/' + p;
      return { ...f, folder_path: p };
    });
  } catch(e) { console.error(e); }
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

  if (isFolder) {
    downloadBtn.classList.add("hidden");
    shareBtn.classList.add("hidden");
    moveBtn.classList.add("hidden");
    trashBtn.classList.add("hidden");
    downloadFolderBtn.classList.remove("hidden");
    
    if (isPrimarySuperAdmin()) {
      folderPermBtn.classList.remove("hidden");
    } else {
      folderPermBtn.classList.add("hidden");
    }

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
    folderPermBtn.classList.add("hidden");
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
    showToast("Error downloading file (Unauthorized)", "error");
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
      body: JSON.stringify({ 
        folder_id: activeContextItem.id, 
        folder_name: activeContextItem.name 
      })
    });
    if (!res.ok) throw new Error("Could not delete folder");
    showToast("Folder deleted and files moved to Trash", "success");
    await loadFolders();
    await loadFiles();
    sortFiles(currentSortMode);
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
              <span class="text-[11px] text-slate-500 font-mono truncate">${n.file_name || n.message || ''}</span>
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
    
    document.getElementById("ndFileName").innerText = n.file_name;
    document.getElementById("ndFolderPath").innerText = n.folder_path;
  } else {
    document.getElementById("ndFileBox").classList.add("hidden");
    document.getElementById("ndFolderBox").classList.add("hidden");
    document.getElementById("ndCustomMsgBox").classList.remove("hidden");
    document.getElementById("ndGoFolderBtn").classList.add("hidden");
    
    document.getElementById("ndCustomMsg").innerText = n.message;
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

async function openPreview(name, id) {
  document.getElementById("previewTitle").innerText = name;
  activePreviewItem = { name, id };
  const token = currentUser ? currentUser.token : '';
  const streamUrl = `${API_BASE}/slides/stream/${id}?filename=${encodeURIComponent(name)}&token=${token}`;

  const container = document.getElementById("previewContainer");
  const pageIndicator = document.getElementById("pdfPageIndicator");
  
  pageIndicator.classList.add("hidden");

  container.scrollTop = 0;
  container.style.justifyContent = "flex-start";
  container.innerHTML = `<div class="m-auto text-center text-slate-400 py-20 flex flex-col items-center gap-2"><span class="spinner"></span><span>Loading preview...</span></div>`;
  showAnimatedModal("previewModal");

  const lower = name.toLowerCase();

  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.ogg') || lower.endsWith('.mkv') || lower.endsWith('.mov')) {
    container.style.justifyContent = "center";
    container.innerHTML = `
      <div class="w-full max-w-4xl max-h-[85vh] flex items-center justify-center">
        <video controls autoplay playsinline class="w-full max-h-[80vh] rounded-xl shadow-2xl bg-black">
          <source src="${streamUrl}" type="video/mp4">
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
          <source src="${streamUrl}">
          Your browser does not support the audio tag.
        </audio>
      </div>
    `;
  }
  else if (lower.endsWith('.txt') || lower.endsWith('.json') || lower.endsWith('.csv') || lower.endsWith('.log') || lower.endsWith('.py') || lower.endsWith('.js') || lower.endsWith('.html')) {
    try {
      const res = await fetch(streamUrl);
      const textContent = await res.text();
      container.innerHTML = `
        <div class="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-xl p-4 text-left my-2">
          <pre class="text-xs text-slate-200 font-mono whitespace-pre-wrap break-all">${textContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
        </div>
      `;
      container.scrollTop = 0;
    } catch (e) {
      container.innerHTML = `<p class="m-auto text-xs text-rose-400">Failed to render text content.</p>`;
    }
  }
  else if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif') || lower.endsWith('.svg')) {
    container.style.justifyContent = "center";
    container.innerHTML = `<img src="${streamUrl}" alt="${name}" class="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl">`;
  }
  else if (lower.endsWith('.pdf')) {
    // Check if already cached
    if (pdfCache[id]) {
      container.innerHTML = "";
      for (let wrapper of pdfCache[id]) {
        container.appendChild(wrapper);
      }
      pageIndicator.innerText = `Page 1 of ${pdfCache[id].length}`;
      pageIndicator.classList.remove("hidden");
      container.scrollTop = 0;
      return;
    }

    try {
      const loadingTask = pdfjsLib.getDocument(streamUrl);
      currentPdfDoc = await loadingTask.promise;

      const firstPage = await currentPdfDoc.getPage(1);
      const unscaledViewport = firstPage.getViewport({ scale: 1.0 });

      const availableWidth = container.clientWidth > 40 ? (container.clientWidth - 32) : window.innerWidth;
      defaultFitScale = parseFloat((availableWidth / unscaledViewport.width).toFixed(2));
      currentPdfScale = defaultFitScale;

      await renderPdfPages(currentPdfScale, id);

    } catch(err) {
      container.style.justifyContent = "center";
      container.innerHTML = `
        <div class="text-center p-8 bg-slate-900 rounded-2xl border border-slate-800">
          <p class="text-xs text-rose-400 mb-3">Unable to preview PDF directly.</p>
          <button onclick="downloadActivePreviewFile()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2">
            <i class="fa-solid fa-download"></i> Download PDF
          </button>
        </div>
      `;
    }
  }
  else {
    const isPptx = lower.endsWith('.pptx') || lower.endsWith('.ppt');
    container.style.justifyContent = "center";
    container.innerHTML = `
      <div class="text-center p-8 bg-slate-900 border border-slate-800 rounded-2xl max-w-sm">
        <i class="fa-solid ${isPptx ? 'fa-file-powerpoint text-amber-500' : 'fa-file-lines text-slate-500'} text-4xl mb-3 block"></i>
        <h4 class="text-sm font-semibold text-slate-200 mb-1 break-all">${name}</h4>
        <p class="text-xs text-slate-400 mb-4">${isPptx ? 'PowerPoint Presentation' : 'Document File'}</p>
        <button onclick="downloadActivePreviewFile()" class="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2">
          <i class="fa-solid fa-download"></i> Download File
        </button>
      </div>
    `;
  }
}

async function renderPdfPages(scale) {
  if (!currentPdfDoc) return;
  const container = document.getElementById("previewContainer");
  const pageIndicator = document.getElementById("pdfPageIndicator");

  container.innerHTML = "";
  pageIndicator.innerText = `Page 1 of ${currentPdfDoc.numPages}`;
  pageIndicator.classList.remove("hidden");

  const dpr = window.devicePixelRatio || 1;
  const totalPages = currentPdfDoc.numPages;
  const renderedPages = new Set();
  const pageWrappers = [];

  // Create placeholder divs for all pages first
  const firstPage = await currentPdfDoc.getPage(1);
  const firstViewport = firstPage.getViewport({ scale: scale * dpr });
  const pageWidth = firstViewport.width / dpr;
  const pageHeight = firstViewport.height / dpr;

  for (let i = 1; i <= totalPages; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page-canvas";
    wrapper.setAttribute("data-page-number", i);
    wrapper.style.width = pageWidth + "px";
    wrapper.style.height = pageHeight + "px";
    wrapper.style.backgroundColor = "#fff";
    wrapper.style.marginBottom = "16px";
    wrapper.style.borderRadius = "6px";
    wrapper.style.boxShadow = "0 4px 14px rgba(0,0,0,0.2)";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";
    wrapper.innerHTML = `<span style="color:#94a3b8;font-size:11px;">Page ${i}</span>`;
    container.appendChild(wrapper);
    pageWrappers.push(wrapper);
  }

  // Function to render a single page
  async function renderPage(pageNum) {
    if (renderedPages.has(pageNum)) return;
    renderedPages.add(pageNum);

    const wrapper = pageWrappers[pageNum - 1];
    const page = await currentPdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: scale * dpr });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = (viewport.width / dpr) + "px";
    canvas.style.height = (viewport.height / dpr) + "px";
    canvas.style.display = "block";

    wrapper.innerHTML = "";
    wrapper.style.height = "auto";
    wrapper.appendChild(canvas);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  }

  // Render first 3 pages immediately
  for (let i = 1; i <= Math.min(3, totalPages); i++) {
    await renderPage(i);
  }

  container.scrollTop = 0;

  // Render nearby pages on scroll
  container.onscroll = () => {
    const containerTop = container.getBoundingClientRect().top;
    const containerHeight = container.clientHeight;

    for (let wrapper of pageWrappers) {
      const rect = wrapper.getBoundingClientRect();
      const pageNum = parseInt(wrapper.getAttribute("data-page-number"));

      // Render pages that are visible or nearby
      if (rect.top < containerTop + containerHeight + 1000 && rect.bottom > containerTop - 500) {
        renderPage(pageNum);

        // Update page indicator
        if (rect.top - containerTop <= 160 && rect.bottom - containerTop > 40) {
          pageIndicator.innerText = `Page ${pageNum} of ${totalPages}`;
        }
      }
    }
  };

  // Save rendered wrappers to cache
  if (cacheId) {
    pdfCache[cacheId] = pageWrappers;
  }
}

function closePreview() {
  hideAnimatedModal("previewModal");
  document.getElementById("previewContainer").innerHTML = "";
  document.getElementById("pdfPageIndicator").classList.add("hidden");
  currentPdfDoc = null;
  activePreviewItem = null;
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
  if (!isApproved()) return showToast("Account is pending approval. You cannot chat yet.", "error");

  const input = document.getElementById("chatInput");
  if (!input.value.trim() || !ws) return;
  ws.send(JSON.stringify({ student_id: currentUser.student_id, sender_name: currentUser.name, message: input.value.trim() }));
  input.value = "";
}

function restoreFolderFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const folder = params.get('folder') || '/';
  currentSelectedFolder = folder;
  history.replaceState({ folder }, '', folder === '/' ? '/' : '/?folder=' + encodeURIComponent(folder));
}

window.addEventListener('popstate', (e) => {
  if (!currentUser) return;
  const folder = e.state?.folder || '/';
  currentSelectedFolder = folder;
  document.getElementById("activeFolderPathText").innerText = `Folder: ${currentSelectedFolder}`;
  renderFilesTable();
});

renderPortalView();
