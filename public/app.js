// ---- tiny API client -------------------------------------------------------
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.status === 204 ? null : res.json();
  },
  get: (u) => api.req("GET", u),
  post: (u, b) => api.req("POST", u, b),
  put: (u, b) => api.req("PUT", u, b),
  del: (u) => api.req("DELETE", u),
};

// ---- app state -------------------------------------------------------------
const state = {
  view: "all", // "all" | "trash" | "notebook" | "tag"
  notebookId: null,
  tag: null,
  search: "",
  notes: [],
  notebooks: [],
  currentNote: null,
  saveTimer: null,
};

// ---- DOM refs --------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const el = {
  notebookList: $("notebookList"),
  tagList: $("tagList"),
  notesContainer: $("notesContainer"),
  notelistTitle: $("notelistTitle"),
  searchInput: $("searchInput"),
  emptyState: $("emptyState"),
  editorInner: $("editorInner"),
  titleInput: $("titleInput"),
  contentArea: $("contentArea"),
  notebookSelect: $("notebookSelect"),
  tagChips: $("tagChips"),
  tagInput: $("tagInput"),
  editorStatus: $("editorStatus"),
  pinBtn: $("pinBtn"),
  trashBtn: $("trashBtn"),
  restoreBtn: $("restoreBtn"),
  deleteBtn: $("deleteBtn"),
};

// ---- rendering -------------------------------------------------------------
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T") + "Z");
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function stripHtml(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  return tmp.textContent || "";
}

function setActiveNav() {
  document.querySelectorAll(".nav-item").forEach((n) =>
    n.classList.toggle("active", state.view === n.dataset.view)
  );
  el.notebookList.querySelectorAll("li").forEach((li) =>
    li.classList.toggle("active", state.view === "notebook" && +li.dataset.id === state.notebookId)
  );
  el.tagList.querySelectorAll("li").forEach((li) =>
    li.classList.toggle("active", state.view === "tag" && li.dataset.tag === state.tag)
  );
}

async function loadSidebar() {
  state.notebooks = await api.get("/api/notebooks");
  el.notebookList.innerHTML = "";
  for (const nb of state.notebooks) {
    const li = document.createElement("li");
    li.dataset.id = nb.id;
    li.innerHTML = `<span>📔 ${escapeHtml(nb.name)}</span><span class="count">${nb.note_count}</span>`;
    li.onclick = () => selectView("notebook", { notebookId: nb.id, title: nb.name });
    el.notebookList.appendChild(li);
  }

  const tags = await api.get("/api/tags");
  el.tagList.innerHTML = "";
  for (const t of tags) {
    const li = document.createElement("li");
    li.dataset.tag = t.name;
    li.innerHTML = `<span># ${escapeHtml(t.name)}</span><span class="count">${t.note_count}</span>`;
    li.onclick = () => selectView("tag", { tag: t.name, title: "# " + t.name });
    el.tagList.appendChild(li);
  }

  el.notebookSelect.innerHTML = `<option value="">노트북 없음</option>`;
  for (const nb of state.notebooks) {
    const opt = document.createElement("option");
    opt.value = nb.id;
    opt.textContent = nb.name;
    el.notebookSelect.appendChild(opt);
  }
  setActiveNav();
}

async function loadNotes() {
  const params = new URLSearchParams();
  if (state.view === "trash") params.set("trashed", "1");
  if (state.view === "notebook") params.set("notebook", state.notebookId);
  if (state.view === "tag") params.set("tag", state.tag);
  if (state.search) params.set("q", state.search);

  state.notes = await api.get("/api/notes?" + params.toString());
  renderNotes();
}

function renderNotes() {
  el.notesContainer.innerHTML = "";
  if (state.notes.length === 0) {
    el.notesContainer.innerHTML = `<li style="padding:24px;color:var(--muted);font-size:13px">노트가 없습니다.</li>`;
    return;
  }
  for (const note of state.notes) {
    const li = document.createElement("li");
    li.className = "note-card" + (state.currentNote?.id === note.id ? " active" : "");
    li.onclick = () => openNote(note.id);
    const preview = stripHtml(note.content).slice(0, 120);
    li.innerHTML = `
      <h3>${note.is_pinned ? '<span class="pin">📌</span> ' : ""}${escapeHtml(note.title) || "제목 없음"}</h3>
      <div class="preview">${escapeHtml(preview)}</div>
      <div class="meta">${fmtDate(note.updated_at)}${
      note.tags?.length ? " · " + note.tags.map((t) => "#" + escapeHtml(t)).join(" ") : ""
    }</div>`;
    el.notesContainer.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- view switching --------------------------------------------------------
function selectView(view, { notebookId = null, tag = null, title } = {}) {
  state.view = view;
  state.notebookId = notebookId;
  state.tag = tag;
  el.notelistTitle.textContent = title || "모든 노트";
  setActiveNav();
  loadNotes();
}

// ---- editor ----------------------------------------------------------------
function showEditor(show) {
  el.editorInner.classList.toggle("hidden", !show);
  el.emptyState.classList.toggle("hidden", show);
}

async function openNote(id) {
  state.currentNote = await api.get("/api/notes/" + id);
  renderEditor();
  renderNotes(); // refresh active highlight
}

function renderEditor() {
  const n = state.currentNote;
  if (!n) return showEditor(false);
  showEditor(true);
  el.titleInput.value = n.title || "";
  el.contentArea.innerHTML = n.content || "";
  el.notebookSelect.value = n.notebook_id || "";
  el.pinBtn.classList.toggle("active", !!n.is_pinned);
  renderTagChips();

  const trashed = !!n.is_trashed;
  el.trashBtn.classList.toggle("hidden", trashed);
  el.pinBtn.classList.toggle("hidden", trashed);
  el.restoreBtn.classList.toggle("hidden", !trashed);
  el.deleteBtn.classList.toggle("hidden", !trashed);
  el.editorStatus.textContent = `생성: ${fmtDate(n.created_at)} · 수정: ${fmtDate(n.updated_at)}`;
}

function renderTagChips() {
  el.tagChips.innerHTML = "";
  for (const t of state.currentNote.tags || []) {
    const chip = document.createElement("div");
    chip.className = "tag-chip";
    chip.innerHTML = `#${escapeHtml(t)} <span title="제거">×</span>`;
    chip.querySelector("span").onclick = () => {
      state.currentNote.tags = state.currentNote.tags.filter((x) => x !== t);
      renderTagChips();
      scheduleSave();
    };
    el.tagChips.appendChild(chip);
  }
}

function scheduleSave() {
  if (!state.currentNote) return;
  el.editorStatus.textContent = "저장 중…";
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveNote, 600);
}

async function saveNote() {
  if (!state.currentNote) return;
  const n = state.currentNote;
  const payload = {
    title: el.titleInput.value,
    content: el.contentArea.innerHTML,
    notebook_id: el.notebookSelect.value ? +el.notebookSelect.value : null,
    is_pinned: n.is_pinned ? 1 : 0,
    tags: n.tags || [],
  };
  state.currentNote = await api.put("/api/notes/" + n.id, payload);
  el.editorStatus.textContent = `저장됨 · ${fmtDate(state.currentNote.updated_at)}`;
  await loadSidebar();
  await loadNotes();
}

// ---- event wiring ----------------------------------------------------------
$("newNoteBtn").onclick = async () => {
  const note = await api.post("/api/notes", {
    title: "",
    content: "",
    notebook_id: state.view === "notebook" ? state.notebookId : null,
    tags: state.view === "tag" ? [state.tag] : [],
  });
  await loadSidebar();
  if (state.view === "trash") selectView("all", { title: "모든 노트" });
  await loadNotes();
  await openNote(note.id);
  el.titleInput.focus();
};

$("addNotebookBtn").onclick = async () => {
  const name = prompt("새 노트북 이름:");
  if (name && name.trim()) {
    await api.post("/api/notebooks", { name: name.trim() });
    await loadSidebar();
  }
};

document.querySelectorAll(".nav-item").forEach((n) => {
  n.onclick = () =>
    selectView(n.dataset.view, { title: n.dataset.view === "trash" ? "휴지통" : "모든 노트" });
});

el.searchInput.oninput = (e) => {
  state.search = e.target.value.trim();
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadNotes, 250);
};

el.titleInput.oninput = scheduleSave;
el.contentArea.oninput = scheduleSave;
el.notebookSelect.onchange = scheduleSave;

el.tagInput.onkeydown = (e) => {
  if (e.key === "Enter" && e.target.value.trim()) {
    e.preventDefault();
    const t = e.target.value.trim();
    state.currentNote.tags = state.currentNote.tags || [];
    if (!state.currentNote.tags.includes(t)) state.currentNote.tags.push(t);
    e.target.value = "";
    renderTagChips();
    scheduleSave();
  }
};

// Rich-text toolbar
document.querySelectorAll(".tool[data-cmd]").forEach((btn) => {
  btn.onmousedown = (e) => {
    e.preventDefault(); // keep selection in the editor
    const cmd = btn.dataset.cmd;
    if (cmd === "formatBlock") {
      const tag = btn.dataset.value;
      // toggle back to <div> if already applied
      const cur = document.queryCommandValue("formatBlock");
      document.execCommand("formatBlock", false, cur === tag ? "div" : tag);
    } else {
      document.execCommand(cmd, false, null);
    }
    el.contentArea.focus();
    scheduleSave();
  };
});

el.pinBtn.onclick = () => {
  state.currentNote.is_pinned = state.currentNote.is_pinned ? 0 : 1;
  el.pinBtn.classList.toggle("active", !!state.currentNote.is_pinned);
  saveNote();
};

el.trashBtn.onclick = async () => {
  await api.put("/api/notes/" + state.currentNote.id, { is_trashed: 1 });
  state.currentNote = null;
  showEditor(false);
  await loadSidebar();
  await loadNotes();
};

el.restoreBtn.onclick = async () => {
  await api.put("/api/notes/" + state.currentNote.id, { is_trashed: 0 });
  state.currentNote = null;
  showEditor(false);
  await loadSidebar();
  await loadNotes();
};

el.deleteBtn.onclick = async () => {
  if (!confirm("이 노트를 완전히 삭제할까요? 되돌릴 수 없습니다.")) return;
  await api.del("/api/notes/" + state.currentNote.id);
  state.currentNote = null;
  showEditor(false);
  await loadSidebar();
  await loadNotes();
};

// Right-click a notebook to rename / delete
el.notebookList.oncontextmenu = async (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  e.preventDefault();
  const id = li.dataset.id;
  const action = prompt('"r" = 이름 변경, "d" = 삭제', "r");
  if (action === "r") {
    const name = prompt("새 이름:");
    if (name && name.trim()) await api.put("/api/notebooks/" + id, { name: name.trim() });
  } else if (action === "d") {
    if (confirm("노트북을 삭제할까요? (노트는 유지됩니다)")) await api.del("/api/notebooks/" + id);
  }
  await loadSidebar();
  await loadNotes();
};

// ---- boot ------------------------------------------------------------------
(async function init() {
  await loadSidebar();
  await loadNotes();
})();
