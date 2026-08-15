import { config, SITE_PASSPHRASE, isUnlocked, unlock } from './config.js';
import { getJsonFile, putJsonFile, putImageFile, fileToBase64, dispatchWorkflow } from './github.js';

const TASKS_PATH = 'data/tasks.json';
const IDEAS_PATH = 'data/ideas.json';
const MEMBERS_PATH = 'data/members.json';
const WORKFLOW_FILE = 'daily-digest.yml';
const IDEA_COLORS = ['#3d7fe0', '#34d399', '#f0b429', '#ff5c5c', '#a78bfa', '#f472b6', '#22d3ee'];

const state = {
  tasks: [],
  sha: null,
  ideas: [],
  ideasSha: null,
  currentIdeaProject: null,
  members: [],
  membersSha: null,
  editingMemberId: null,
  filters: { search: '', project: '', urgency: null, assignee: '' },
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
  loadIdeas();
  loadMembers();
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

async function loadIdeas() {
  try {
    const { data, sha } = await getJsonFile(config.owner, config.repo, IDEAS_PATH, config.token);
    state.ideas = data?.ideas || [];
    state.ideasSha = sha;
    renderProjectPills();
  } catch (e) {
    console.error("Impossible de charger les idées :", e);
  }
}

async function saveIdeas(commitMessage) {
  try {
    const { sha: freshSha } = await getJsonFile(config.owner, config.repo, IDEAS_PATH, config.token);
    const result = await putJsonFile(
      config.owner, config.repo, IDEAS_PATH, config.token,
      { ideas: state.ideas }, freshSha || state.ideasSha, commitMessage
    );
    state.ideasSha = result.content.sha;
  } catch (e) {
    console.error(e);
    alert("Impossible d'enregistrer les idées sur GitHub :\n" + e.message);
    throw e;
  }
}

async function loadMembers() {
  try {
    const { data, sha } = await getJsonFile(config.owner, config.repo, MEMBERS_PATH, config.token);
    state.members = data?.members || [];
    state.membersSha = sha;
    renderMemberList();
    populateAssigneeSelects();
  } catch (e) {
    console.error("Impossible de charger l'équipe :", e);
  }
}

async function saveMembers(commitMessage) {
  try {
    const { sha: freshSha } = await getJsonFile(config.owner, config.repo, MEMBERS_PATH, config.token);
    const result = await putJsonFile(
      config.owner, config.repo, MEMBERS_PATH, config.token,
      { members: state.members }, freshSha || state.membersSha, commitMessage
    );
    state.membersSha = result.content.sha;
  } catch (e) {
    console.error(e);
    alert("Impossible d'enregistrer l'équipe sur GitHub :\n" + e.message);
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
  const { search, project, urgency, assignee } = state.filters;
  return state.tasks.filter((t) => {
    if (search && !(`${t.title} ${t.project} ${t.description || ''} ${(t.labels || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))) return false;
    if (project && t.project !== project) return false;
    if (urgency && t.urgency !== urgency) return false;
    if (assignee && t.assigneeId !== assignee) return false;
    return true;
  });
}

function render() {
  renderProjectFilter();
  renderAssigneeFilter();
  renderBoard();
  renderSidebar();
  renderProjectPills();
}

function renderAssigneeFilter() {
  const select = $('#assignee-filter');
  const current = select.value;
  select.innerHTML = '<option value="">Tous les membres</option>' +
    state.members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  select.value = state.members.some((m) => m.id === current) ? current : '';
  select._customSelectRefresh?.();
}

function getKnownProjects() {
  return [...new Set(state.tasks.map((t) => t.project).filter(Boolean))].sort();
}

function renderProjectFilter() {
  const select = $('#project-filter');
  const current = select.value;
  const projects = getKnownProjects();
  select.innerHTML = '<option value="">Tous les projets</option>' +
    projects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  select.value = projects.includes(current) ? current : '';
  select._customSelectRefresh?.();
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

function daysBetween(dateStr, todayIso) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(todayIso + 'T00:00:00');
  return Math.round((t - d) / 86400000);
}

// Escalade : signale les tâches en retard depuis longtemps, ou qui traînent
// sans date depuis trop longtemps, pour qu'elles ne passent pas inaperçues.
function computeEscalation(task) {
  if (task.status === 'done') return null;
  const today = todayStr();
  if (task.dueDate) {
    const overdueDays = daysBetween(task.dueDate, today);
    if (overdueDays >= 3) return { text: `🔥 En retard depuis ${overdueDays} j`, cls: 'critical' };
    if (overdueDays >= 1) return { text: `⚠️ En retard depuis ${overdueDays} j`, cls: 'warning' };
    return null;
  }
  if (task.createdAt) {
    const openDays = Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86400000);
    if (openDays >= 5) return { text: `⏳ En attente depuis ${openDays} j`, cls: 'stale' };
  }
  return null;
}

function renderCard(task) {
  const card = document.createElement('div');
  const escalation = computeEscalation(task);
  card.className = `task-card ${task.urgency}${escalation?.cls === 'critical' ? ' critical' : ''}`;
  card.draggable = true;
  card.dataset.id = task.id;

  const overdue = task.dueDate && task.dueDate < todayStr() && task.status !== 'done';
  const labels = task.labels || [];
  const assignee = task.assigneeId ? state.members.find((m) => m.id === task.assigneeId) : null;
  card.innerHTML = `
    <div class="task-card-title">${escapeHtml(task.title)}</div>
    <div class="task-card-meta">
      ${task.project ? `<button type="button" class="task-project-chip" data-project="${escapeHtml(task.project)}">${escapeHtml(task.project)}</button>` : ''}
      ${task.dueDate ? `<span class="task-due ${overdue ? 'overdue' : ''}">${overdue ? '⚠️ ' : '📅 '}${task.dueDate}</span>` : ''}
      ${task.screenshots?.length ? `<span class="task-shots">🖼️ ${task.screenshots.length}</span>` : ''}
      ${assignee ? `<span class="assignee-chip"><span class="assignee-chip-avatar">${escapeHtml(assignee.name[0] || '?').toUpperCase()}</span>${escapeHtml(assignee.name)}</span>` : ''}
    </div>
    ${labels.length ? `<div class="task-labels">${labels.map((l) => `<span class="label-chip">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
    ${escalation ? `<div class="escalation ${escalation.cls}">${escalation.text}</div>` : ''}
  `;

  card.addEventListener('click', () => openTaskModal(task));
  const projectChip = card.querySelector('.task-project-chip');
  if (projectChip) {
    projectChip.addEventListener('click', (e) => {
      e.stopPropagation();
      openIdeaBoard(projectChip.dataset.project);
    });
  }
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

  // Toutes les tâches restantes, triées par urgence puis par échéance
  // (les plus urgentes / les plus proches en premier).
  const attention = remaining
    .slice()
    .sort((a, b) => {
      const rankDiff = (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });

  const list = $('#attention-list');
  if (attention.length === 0) {
    list.innerHTML = '<p class="attention-empty">Rien à faire pour l\'instant 🎉</p>';
  } else {
    list.innerHTML = attention.map((t) => {
      const overdue = t.dueDate && t.dueDate < today;
      const escalation = computeEscalation(t);
      return `
        <div class="attention-item ${t.urgency} ${overdue ? 'overdue' : ''}" data-id="${t.id}">
          <div class="attention-item-title">${escapeHtml(t.title)}</div>
          <span class="muted">${t.dueDate ? (overdue ? '⚠️ ' + t.dueDate : t.dueDate) : urgencyLabel[t.urgency]}${t.project ? ' · ' + escapeHtml(t.project) : ''}</span>
          ${escalation ? `<div class="escalation ${escalation.cls}">${escalation.text}</div>` : ''}
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

// ---------------------------------------------------------------------
// Tableau d'idées par projet
// ---------------------------------------------------------------------
function renderProjectPills() {
  const el = $('#project-pills');
  if (!el) return;
  const projects = [...new Set([
    ...state.tasks.map((t) => t.project).filter(Boolean),
    ...state.ideas.map((i) => i.project).filter(Boolean),
  ])].sort();

  $('#project-pills-empty').classList.toggle('hidden', projects.length > 0);
  el.innerHTML = projects.map((p) => {
    const count = state.ideas.filter((i) => i.project === p).length;
    return `
      <button type="button" class="project-pill" data-project="${escapeHtml(p)}">
        <span class="project-pill-icon">💡</span>
        <span>${escapeHtml(p)}</span>
        ${count ? `<span class="project-pill-count">${count}</span>` : ''}
      </button>
    `;
  }).join('');

  el.querySelectorAll('.project-pill').forEach((btn) => {
    btn.addEventListener('click', () => openIdeaBoard(btn.dataset.project));
  });
}

function colorForId(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return IDEA_COLORS[hash % IDEA_COLORS.length];
}

function openIdeaBoard(project) {
  state.currentIdeaProject = project;
  $('#idea-modal-title').textContent = `💡 Idées — ${project}`;
  $('#idea-input').value = '';
  renderIdeaGrid();
  $('#idea-modal').classList.remove('hidden');
  $('#idea-input').focus();
}

function closeIdeaModal() {
  $('#idea-modal').classList.add('hidden');
}

function renderIdeaGrid() {
  const grid = $('#idea-grid');
  const ideas = state.ideas
    .filter((i) => i.project === state.currentIdeaProject)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  if (ideas.length === 0) {
    grid.innerHTML = '<p class="idea-empty">Aucune idée pour l\'instant — note tout ce qui te passe par la tête.</p>';
    return;
  }

  grid.innerHTML = ideas.map((idea) => `
    <div class="idea-card" style="border-left-color:${colorForId(idea.id)}" data-id="${idea.id}">
      <div class="idea-card-text">${escapeHtml(idea.text)}</div>
      <div class="idea-card-footer">
        <span class="idea-card-date">${new Date(idea.createdAt).toLocaleDateString('fr-FR')}</span>
        <button type="button" class="idea-card-delete" data-id="${idea.id}">✕ Supprimer</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.idea-card-delete').forEach((btn) => {
    btn.addEventListener('click', () => handleIdeaDelete(btn.dataset.id));
  });
}

async function handleIdeaSubmit(e) {
  e.preventDefault();
  const input = $('#idea-input');
  const text = input.value.trim();
  if (!text) return;
  const idea = {
    id: crypto.randomUUID(),
    project: state.currentIdeaProject,
    text,
    createdAt: new Date().toISOString(),
  };
  state.ideas.push(idea);
  input.value = '';
  renderIdeaGrid();
  renderProjectPills();
  try {
    await saveIdeas(`Ajouter une idée pour "${state.currentIdeaProject}"`);
  } catch { /* déjà notifié dans saveIdeas */ }
}

async function handleIdeaDelete(id) {
  state.ideas = state.ideas.filter((i) => i.id !== id);
  renderIdeaGrid();
  renderProjectPills();
  await saveIdeas('Supprimer une idée');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------
// Menus déroulants personnalisés (remplacent les <select> natifs)
// ---------------------------------------------------------------------
function enhanceSelect(selectEl, extraClass) {
  selectEl.style.display = 'none';
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select' + (extraClass ? ' ' + extraClass : '');
  wrapper.innerHTML = `
    <button type="button" class="custom-select-trigger">
      <span class="custom-select-label"></span>
      <span class="custom-select-arrow">▾</span>
    </button>
    <div class="custom-select-menu hidden"></div>
  `;
  selectEl.insertAdjacentElement('afterend', wrapper);

  const trigger = wrapper.querySelector('.custom-select-trigger');
  const label = wrapper.querySelector('.custom-select-label');
  const menu = wrapper.querySelector('.custom-select-menu');

  function build() {
    label.textContent = selectEl.options[selectEl.selectedIndex]?.textContent || '';
    menu.innerHTML = [...selectEl.options].map((o) => `
      <div class="custom-select-option ${o.value === selectEl.value ? 'active' : ''}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</div>
    `).join('');
  }
  build();
  selectEl._customSelectRefresh = build;

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.custom-select-menu').forEach((m) => { if (m !== menu) m.classList.add('hidden'); });
    document.querySelectorAll('.autocomplete-menu').forEach((m) => m.classList.add('hidden'));
    menu.classList.toggle('hidden');
    wrapper.classList.toggle('open', !menu.classList.contains('hidden'));
  });

  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.custom-select-option');
    if (!opt) return;
    selectEl.value = opt.dataset.value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    build();
    menu.classList.add('hidden');
    wrapper.classList.remove('open');
  });
}

function bindProjectAutocomplete() {
  const input = $('#task-project');
  const menu = $('#project-autocomplete-menu');

  function show() {
    const query = input.value.trim().toLowerCase();
    const projects = getKnownProjects().filter((p) => !query || p.toLowerCase().includes(query));
    menu.innerHTML = projects.length
      ? projects.map((p) => `<div class="autocomplete-option" data-value="${escapeHtml(p)}">${escapeHtml(p)}</div>`).join('')
      : '<div class="autocomplete-empty">Aucun projet existant — tape pour en créer un nouveau.</div>';
    menu.classList.remove('hidden');
  }

  input.addEventListener('focus', show);
  input.addEventListener('input', show);
  menu.addEventListener('click', (e) => {
    const opt = e.target.closest('.autocomplete-option');
    if (!opt) return;
    input.value = opt.dataset.value;
    menu.classList.add('hidden');
  });
}

function bindDropdownOutsideClick() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) {
      document.querySelectorAll('.custom-select-menu').forEach((m) => m.classList.add('hidden'));
      document.querySelectorAll('.custom-select.open').forEach((w) => w.classList.remove('open'));
    }
    if (!e.target.closest('.autocomplete')) {
      document.querySelectorAll('.autocomplete-menu').forEach((m) => m.classList.add('hidden'));
    }
  });
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
// Équipe (membres assignables aux tâches)
// ---------------------------------------------------------------------
function openTeamModal() {
  resetMemberForm();
  renderMemberList();
  $('#team-modal').classList.remove('hidden');
}

function closeTeamModal() {
  $('#team-modal').classList.add('hidden');
}

function resetMemberForm() {
  state.editingMemberId = null;
  $('#member-id').value = '';
  $('#member-name').value = '';
  $('#member-badge').value = '';
  $('#member-discord-id').value = '';
  $('#member-always-notify').checked = false;
  $('#member-save-btn').textContent = 'Ajouter le membre';
  $('#member-cancel-btn').classList.add('hidden');
}

function renderMemberList() {
  const el = $('#member-list');
  if (!el) return;
  if (state.members.length === 0) {
    el.innerHTML = '<p class="member-empty">Aucun membre pour l\'instant — ajoute ton équipe ci-dessus.</p>';
    return;
  }
  el.innerHTML = state.members.map((m) => `
    <div class="member-row" data-id="${m.id}">
      <div class="member-row-info">
        <span class="member-avatar">${escapeHtml((m.name[0] || '?').toUpperCase())}</span>
        <div>
          <div class="member-row-name">
            ${escapeHtml(m.name)}
            ${m.badge ? `<span class="badge-pill">${escapeHtml(m.badge)}</span>` : ''}
            ${m.alwaysNotify ? `<span class="badge-pill badge-chief">🔔 Toujours notifié</span>` : ''}
          </div>
          <div class="member-row-discord muted">${m.discordId ? 'ID Discord : ' + escapeHtml(m.discordId) : 'Pas d\'ID Discord renseigné'}</div>
        </div>
      </div>
      <div class="member-row-actions">
        <button type="button" class="btn btn-icon member-edit-btn" data-id="${m.id}">✏️</button>
        <button type="button" class="btn btn-icon member-delete-btn" data-id="${m.id}">🗑️</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.member-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => startEditMember(btn.dataset.id));
  });
  el.querySelectorAll('.member-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleMemberDelete(btn.dataset.id));
  });
}

function startEditMember(id) {
  const member = state.members.find((m) => m.id === id);
  if (!member) return;
  state.editingMemberId = id;
  $('#member-id').value = member.id;
  $('#member-name').value = member.name;
  $('#member-badge').value = member.badge || '';
  $('#member-discord-id').value = member.discordId || '';
  $('#member-always-notify').checked = !!member.alwaysNotify;
  $('#member-save-btn').textContent = 'Enregistrer les modifications';
  $('#member-cancel-btn').classList.remove('hidden');
  $('#member-name').focus();
}

async function handleMemberSubmit(e) {
  e.preventDefault();
  const name = $('#member-name').value.trim();
  if (!name) return;
  const member = {
    id: state.editingMemberId || crypto.randomUUID(),
    name,
    badge: $('#member-badge').value.trim(),
    discordId: $('#member-discord-id').value.trim(),
    alwaysNotify: $('#member-always-notify').checked,
  };
  const existingIndex = state.members.findIndex((m) => m.id === member.id);
  if (existingIndex >= 0) {
    state.members[existingIndex] = member;
  } else {
    state.members.push(member);
  }
  resetMemberForm();
  renderMemberList();
  populateAssigneeSelects();
  renderAssigneeFilter();
  renderBoard();
  try {
    await saveMembers(existingIndex >= 0 ? `Modifier le membre "${name}"` : `Ajouter le membre "${name}"`);
  } catch { /* déjà notifié dans saveMembers */ }
}

async function handleMemberDelete(id) {
  const member = state.members.find((m) => m.id === id);
  if (!confirm(`Retirer ${member?.name || 'ce membre'} de l'équipe ? Les tâches qui lui sont assignées deviendront "Non assigné".`)) return;
  state.members = state.members.filter((m) => m.id !== id);
  for (const t of state.tasks) {
    if (t.assigneeId === id) t.assigneeId = null;
  }
  if (state.editingMemberId === id) resetMemberForm();
  renderMemberList();
  populateAssigneeSelects();
  renderAssigneeFilter();
  renderBoard();
  try {
    await saveMembers(`Retirer le membre "${member?.name || id}"`);
    await saveTasks(`Désassigner les tâches de "${member?.name || id}"`);
  } catch { /* déjà notifié */ }
}

function populateAssigneeSelects() {
  const taskSelect = $('#task-assignee');
  if (taskSelect) {
    const current = taskSelect.value;
    taskSelect.innerHTML = '<option value="">Non assigné</option>' +
      state.members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}${m.badge ? ' — ' + escapeHtml(m.badge) : ''}</option>`).join('');
    taskSelect.value = state.members.some((m) => m.id === current) ? current : '';
    taskSelect._customSelectRefresh?.();
  }
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
  populateAssigneeSelects();
  $('#task-assignee').value = task?.assigneeId || '';
  $('#task-urgency')._customSelectRefresh?.();
  $('#task-status')._customSelectRefresh?.();
  $('#task-assignee')._customSelectRefresh?.();
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
    assigneeId: $('#task-assignee').value || null,
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
  loadIdeas();
  loadMembers();
}

// ---------------------------------------------------------------------
// Événements globaux
// ---------------------------------------------------------------------
function bindGlobalEvents() {
  bindDragAndDrop();
  bindDropdownOutsideClick();
  bindProjectAutocomplete();
  enhanceSelect($('#project-filter'), 'select-narrow');
  enhanceSelect($('#assignee-filter'), 'select-narrow');
  enhanceSelect($('#task-urgency'));
  enhanceSelect($('#task-status'));
  enhanceSelect($('#task-assignee'));

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

  $('#idea-modal-close').addEventListener('click', closeIdeaModal);
  $('#idea-form').addEventListener('submit', handleIdeaSubmit);
  $('#idea-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleIdeaSubmit(e);
    }
  });

  $('#team-btn').addEventListener('click', openTeamModal);
  $('#team-modal-close').addEventListener('click', closeTeamModal);
  $('#member-form').addEventListener('submit', handleMemberSubmit);
  $('#member-cancel-btn').addEventListener('click', resetMemberForm);

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
  $('#assignee-filter').addEventListener('change', (e) => {
    state.filters.assignee = e.target.value;
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
        if (overlay.id === 'idea-modal') closeIdeaModal();
        if (overlay.id === 'team-modal') closeTeamModal();
      }
    });
  });
}

initLock();
