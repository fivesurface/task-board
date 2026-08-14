import { config, SITE_PASSPHRASE, isUnlocked, unlock } from './config.js';
import { getJsonFile, putJsonFile, putImageFile, fileToBase64, dispatchWorkflow } from './github.js';

const TASKS_PATH = 'data/tasks.json';
const WORKFLOW_FILE = 'daily-digest.yml';

const state = {
  tasks: [],
  sha: null,
  filters: { search: '', project: '', urgency: null },
  editingScreenshots: [],
  editingLabels: [],
};

const $ = (sel) => document.querySelector(sel);
const todayStr = () => new Date().toISOString().slice(0, 10);
const urgencyLabel = { urgent: '🔴 Urgent', moyen: '🟡 Moyen', faible: '🟢 Faible' };
const urgencyOrder = { urgent: 0, moyen: 1, faible: 2 };

// ---------------------------------------------------------------------
// Verrou léger
// ---------------------------------------------------------------------
function initLock() {
  if (isUnlocked()) return start();
  $('#lock-screen').classList.remove('hidden');
  $('#lock-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = $('#lock-input').value;
    if (val === SITE_PASSPHRASE) {
      unlock();
      $('#lock-screen').classList.add('hidden');
      start();
    } else {
      $('#lock-error').classList.remove('hidden');
    }
  });
}

// ---------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------
function start() {
  $('#app').classList.remove('hidden');
  bindGlobalEvents();
  if (!config.isComplete()) {
    setSyncStatus('Configuration requise', 'error');
    openSettingsModal(true);
    return;
  }
  loadTasks();
}

async function loadTasks() {
  setSyncStatus('Chargement…', 'saving');
  try {
    const { data, sha } = await getJsonFile(config.owner, config.repo, TASKS_PATH, config.token);
    state.tasks = data?.tasks || [];
    state.sha = sha;
    setSyncStatus('À jour');
    render();
  } catch (e) {
    setSyncStatus('Erreur de chargement', 'error');
    console.error(e);
    alert("Impossible de charger les tâches depuis GitHub :\n" + e.message);
  }
}

async function saveTasks(commitMessage) {
  setSyncStatus('Sauvegarde…', 'saving');
  try {
    // On relit le sha juste avant d'écrire pour éviter les conflits.
    const { sha: freshSha } = await getJsonFile(config.owner, config.repo, TASKS_PATH, config.token);
    const result = await putJsonFile(
      config.owner, config.repo, TASKS_PATH, config.token,
      { tasks: state.tasks }, freshSha || state.sha, commitMessage
    );
    state.sha = result.content.sha;
    setSyncStatus('Enregistré ✓');
  } catch (e) {
    setSyncStatus('Erreur de sauvegarde', 'error');
    console.error(e);
    alert("Impossible d'enregistrer sur GitHub :\n" + e.message);
    throw e;
  }
}

function setSyncStatus(text, kind) {
  const el = $('#sync-status');
  el.textContent = text;
  el.className = 'sync-status' + (kind ? ' ' + kind : '');
}

// ---------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------
function getFilteredTasks() {
  const { search, project, urgency } = state.filters;
  return state.tasks.filter((t) => {
    if (search && !(`${t.title} ${t.project} ${t.description || ''} ${(t.labels || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (project && t.project !== project) return false;
    if (urgency && t.urgency !== urgency) return false;
    return true;
  });
}

function render() {
  renderProjectFilter();
  renderBoard();
  renderSidebar();
}

function renderProjectFilter() {
  const select = $('#project-filter');
  const current = select.value;
  const projects = [...new Set(state.tasks.map((t) => t.project).filter(Boolean))].sort();
  select.innerHTML = '<option value="">Tous les projets</option>' +
    projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  select.value = projects.includes(current) ? current : '';

  const datalist = $('#project-list');
  datalist.innerHTML = projects.map((p) => `<option value="${escapeHtml(p)}">`).join('');
}

function renderBoard() {
  const filtered = getFilteredTasks();
  for (const status of ['todo', 'doing', 'done']) {
    const list = $(`.card-list[data-status="${status}"]`);
    const tasks = filtered.filter((t) => t.status === status);
    $(`#count-${status}`).textContent = tasks.length;
    list.innerHTML = '';
    for (const task of tasks) list.appendChild(renderCard(task));
  }
}

function renderCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.urgency}`;
  card.draggable = true;
  card.dataset.id = task.id;

  const overdue = task.dueDate && task.dueDate < todayStr() && task.status !== 'done';
  const labels = task.labels || [];
  card.innerHTML = `
    <div class="task-card-title">${escapeHtml(task.title)}</div>
    <div class="task-card-meta">
      ${task.project ? `<span class="task-project-chip">${escapeHtml(task.project)}</span>` : ''}
      ${task.dueDate ? `<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? '⚠️ ' : '📅 '}${task.dueDate}</span>` : ''}
      ${task.screenshots?.length ? `<span class="task-shots">🖼️ ${task.screenshots.length}</span>` : ''}
    </div>
    ${labels.length ? `<div class="task-labels">${labels.map((l) => `<span class="label-chip">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
  `;

  card.addEventListener('click', () => openTaskModal(task));
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}

function renderSidebar() {
  const remaining = state.tasks.filter((t) => t.status !== 'done');
  const today = todayStr();

  const byUrgency = { urgent: 0, moyen: 0, faible: 0 };
  for (const t of remaining) byUrgency[t.urgency] = (byUrgency[t.urgency] || 0) + 1;

  $('#stat-grid').innerHTML = `
    <div class="stat-tile stat-tile-total">
      <div class="stat-tile-value">${remaining.length}</div>
      <div class="stat-tile-label">tâche(s) restante(s)</div>
    </div>
    <div class="stat-tile small urgent">
      <div class="stat-tile-icon">🔴</div>
      <div class="stat-tile-value">${byUrgency.urgent || 0}</div>
      <div class="stat-tile-label">Urgent</div>
    </div>
    <div class="stat-tile small moyen">
      <div class="stat-tile-icon">🟡</div>
      <div class="stat-tile-value">${byUrgency.moyen || 0}</div>
      <div class="stat-tile-label">Moyen</div>
    </div>
    <div class="stat-tile small faible" style="grid-column: span 2;">
      <div class="stat-tile-icon">🟢</div>
      <div class="stat-tile-value">${byUrgency.faible || 0}</div>
      <div class="stat-tile-label">Faible</div>
    </div>
  `;

  // "À traiter aujourd'hui / en retard" : tâches urgentes (peu importe la date)
  // + tâches dont l'échéance est aujourd'hui ou dépassée.
  const attention = remaining
    .filter((t) => t.urgency === 'urgent' || (t.dueDate && t.dueDate <= today))
    .sort((a, b) => {
      const rankDiff = (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });

  const list = $('#attention-list');
  if (attention.length === 0) {
    list.innerHTML = '<p class="attention-empty">Rien d\'urgent ni en retard.</p>';
  } else {
    list.innerHTML = attention.map((t) => {
      const overdue = t.dueDate && t.dueDate < today;
      return `
        <div class="attention-item ${t.urgency} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
          <div class="attention-item-title">${escapeHtml(t.title)}</div>
          <span class="muted">${t.dueDate ? (overdue ? '⚠️ ' + t.dueDate : t.dueDate) : urgencyLabel[t.urgency]}${t.project ? ' · ' + escapeHtml(t.project) : ''}</span>
        </div>
      `;
    }).join('');
  }

  list.querySelectorAll('.attention-item').forEach((item) => {
    item.addEventListener('click', () => {
      const task = state.tasks.find((t) => t.id === item.dataset.id);
      if (task) openTaskModal(task);
    });
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Glisser-déposer entre colonnes
// ---------------------------------------------------------------------
function bindDragAndDrop() {
  document.querySelectorAll('.card-list').forEach((list) => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = state.tasks.find((t) => t.id === id);
      const newStatus = list.dataset.status;
      if (task && task.status !== newStatus) {
        task.status = newStatus;
        task.updatedAt = new Date().toISOString();
        render();
        await saveTasks(`Déplacer "${task.title}" vers ${newStatus}`);
      }
    });
  });
}

// ---------------------------------------------------------------------
// Étiquettes (tags)
// ---------------------------------------------------------------------
function renderTagChips() {
  const el = $('#tag-chips');
  el.innerHTML = state.editingLabels.map((label, i) => `
    <span class="tag-chip">${escapeHtml(label)}<button type="button" data-idx="${i}">✕</button></span>
  `).join('');
  el.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingLabels.splice(Number(btn.dataset.idx), 1);
      renderTagChips();
    });
  });
}

function addLabelFromInput() {
  const input = $('#task-label-input');
  const value = input.value.trim();
  if (value && !state.editingLabels.includes(value)) {
    state.editingLabels.push(value);
    renderTagChips();
  }
  input.value = '';
}

// ---------------------------------------------------------------------
// Modale tâche
// ---------------------------------------------------------------------
function openTaskModal(task) {
  const isNew = !task;
  $('#task-modal-title').textContent = isNew ? 'Nouvelle tâche' : 'Modifier la tâche';
  $('#task-id').value = task?.id || '';
  $('#task-title').value = task?.title || '';
  $('#task-project').value = task?.project || '';
  $('#task-description').value = task?.description || '';
  $('#task-urgency').value = task?.urgency || 'moyen';
  $('#task-status').value = task?.status || 'todo';
  $('#task-due').value = task?.dueDate || '';
  $('#task-reminder').value = task?.reminderDate || '';
  $('#task-delete-btn').classList.toggle('hidden', isNew);
  $('#task-error').classList.add('hidden');
  $('#task-screenshots-input').value = '';
  $('#task-label-input').value = '';
  state.editingScreenshots = task?.screenshots ? [...task.screenshots] : [];
  state.editingLabels = task?.labels ? [...task.labels] : [];
  renderScreenshotsList();
  renderTagChips();
  $('#task-modal').classList.remove('hidden');
  $('#task-title').focus();
}

function closeTaskModal() {
  $('#task-modal').classList.add('hidden');
}

function renderScreenshotsList() {
  const el = $('#task-screenshots-list');
  el.innerHTML = state.editingScreenshots.map((url, i) => `
    <div class="screenshot-thumb">
      <img src="${url}" loading="lazy" />
      <button type="button" class="screenshot-remove" data-idx="${i}">✕</button>
    </div>
  `).join('');
  el.querySelectorAll('.screenshot-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.editingScreenshots.splice(Number(btn.dataset.idx), 1);
      renderScreenshotsList();
    });
  });
}

async function handleScreenshotUpload(files) {
  if (!files.length) return;
  setSyncStatus('Envoi image…', 'saving');
  const taskId = $('#task-id').value || 'new-' + Date.now();
  try {
    for (const file of files) {
      const base64 = await fileToBase64(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `data/images/${taskId}-${Date.now()}-${safeName}`;
      const url = await putImageFile(config.owner, config.repo, path, config.token, base64, `Ajouter capture pour ${taskId}`);
      state.editingScreenshots.push(url);
    }
    renderScreenshotsList();
    setSyncStatus('Image envoyée ✓');
  } catch (e) {
    setSyncStatus('Erreur upload', 'error');
    alert("Échec de l'envoi de l'image :\n" + e.message);
  }
}

async function handleTaskSubmit(e) {
  e.preventDefault();
  const id = $('#task-id').value || crypto.randomUUID();
  const existing = state.tasks.find((t) => t.id === id);
  const now = new Date().toISOString();

  const task = {
    id,
    title: $('#task-title').value.trim(),
    project: $('#task-project').value.trim(),
    labels: [...state.editingLabels],
    description: $('#task-description').value.trim(),
    urgency: $('#task-urgency').value,
    status: $('#task-status').value,
    dueDate: $('#task-due').value || null,
    reminderDate: $('#task-reminder').value || null,
    screenshots: [...state.editingScreenshots],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (!task.title) {
    $('#task-error').textContent = 'Le titre est obligatoire.';
    $('#task-error').classList.remove('hidden');
    return;
  }

  if (existing) {
    Object.assign(existing, task);
  } else {
    state.tasks.push(task);
  }

  try {
    closeTaskModal();
    render();
    await saveTasks(existing ? `Modifier "${task.title}"` : `Ajouter "${task.title}"`);
  } catch { /* déjà notifié dans saveTasks */ }
}

async function handleTaskDelete() {
  const id = $('#task-id').value;
  if (!id) return;
  if (!confirm('Supprimer cette tâche définitivement ?')) return;
  const task = state.tasks.find((t) => t.id === id);
  state.tasks = state.tasks.filter((t) => t.id !== id);
  closeTaskModal();
  render();
  await saveTasks(`Supprimer "${task?.title || id}"`);
}

// ---------------------------------------------------------------------
// Envoi Discord à la demande
// ---------------------------------------------------------------------
async function handleDiscordNow() {
  const btn = $('#discord-now-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Envoi…';
  try {
    await dispatchWorkflow(config.owner, config.repo, config.token, WORKFLOW_FILE);
    btn.textContent = 'Envoyé ✓';
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2500);
  } catch (e) {
    alert("Impossible de déclencher l'envoi Discord :\n" + e.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Modale paramètres
// ---------------------------------------------------------------------
function openSettingsModal(forced = false) {
  $('#cfg-owner').value = config.owner;
  $('#cfg-repo').value = config.repo;
  $('#cfg-token').value = config.token;
  $('#settings-error').classList.add('hidden');
  $('#settings-modal').classList.remove('hidden');
  $('#settings-modal').dataset.forced = forced ? '1' : '';
}

function closeSettingsModal() {
  if ($('#settings-modal').dataset.forced === '1' && !config.isComplete()) return;
  $('#settings-modal').classList.add('hidden');
}

function handleSettingsSubmit(e) {
  e.preventDefault();
  config.owner = $('#cfg-owner').value.trim();
  config.repo = $('#cfg-repo').value.trim();
  config.token = $('#cfg-token').value.trim();
  $('#settings-modal').classList.add('hidden');
  loadTasks();
}

// ---------------------------------------------------------------------
// Événements globaux
// ---------------------------------------------------------------------
function bindGlobalEvents() {
  bindDragAndDrop();

  $('#new-task-btn').addEventListener('click', () => openTaskModal(null));
  $('#task-modal-close').addEventListener('click', closeTaskModal);
  $('#task-cancel-btn').addEventListener('click', closeTaskModal);
  $('#task-form').addEventListener('submit', handleTaskSubmit);
  $('#task-delete-btn').addEventListener('click', handleTaskDelete);
  $('#task-screenshots-input').addEventListener('change', (e) => handleScreenshotUpload([...e.target.files]));

  const dropzone = $('#screenshot-dropzone');
  dropzone.addEventListener('click', () => $('#task-screenshots-input').click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    handleScreenshotUpload(files);
  });

  $('#task-label-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addLabelFromInput();
    }
  });
  $('#task-label-input').addEventListener('blur', addLabelFromInput);

  $('#discord-now-btn').addEventListener('click', handleDiscordNow);

  $('#settings-btn').addEventListener('click', () => openSettingsModal(false));
  $('#settings-modal-close').addEventListener('click', closeSettingsModal);
  $('#settings-form').addEventListener('submit', handleSettingsSubmit);

  $('#search-input').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    renderBoard();
  });
  $('#project-filter').addEventListener('change', (e) => {
    state.filters.project = e.target.value;
    renderBoard();
  });
  document.querySelectorAll('#urgency-filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const u = chip.dataset.urgency;
      state.filters.urgency = state.filters.urgency === u ? null : u;
      document.querySelectorAll('#urgency-filters .chip').forEach((c) => c.classList.toggle('active', c.dataset.urgency === state.filters.urgency));
      renderBoard();
    });
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        if (overlay.id === 'task-modal') closeTaskModal();
        if (overlay.id === 'settings-modal') closeSettingsModal();
      }
    });
  });
}

initLock();
