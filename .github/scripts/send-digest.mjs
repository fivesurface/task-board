import { readFile } from 'node:fs/promises';

const PARIS_TZ = 'Europe/Paris';

function parisNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

function daysBetween(dateStr, todayIso) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const t = new Date(todayIso + 'T00:00:00Z');
  return Math.round((t - d) / 86400000);
}

async function readJson(relativePath, fallback) {
  try {
    const raw = await readFile(new URL(relativePath, import.meta.url), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const { date: today, hour } = parisNow();
const eventName = process.env.GITHUB_EVENT_NAME || '';

// Le workflow planifié se déclenche à 7h ET 8h UTC pour couvrir le changement d'heure.
// On ne veut envoyer le message qu'une seule fois, quand il est réellement 9h à Paris.
// Un déclenchement manuel (bouton "Envoyer sur Discord" du site) envoie toujours, sans attendre 9h.
if (eventName === 'schedule' && hour !== 9) {
  console.log(`Il est ${hour}h à Paris (pas 9h) — on ne fait rien pour ce déclenchement planifié.`);
  process.exit(0);
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  console.error("Le secret DISCORD_WEBHOOK_URL n'est pas configuré sur le dépôt.");
  process.exit(1);
}

const { tasks = [] } = await readJson('../../data/tasks.json', { tasks: [] });
const { members = [] } = await readJson('../../data/members.json', { members: [] });
const memberById = Object.fromEntries(members.map((m) => [m.id, m]));

// URL du site (GitHub Pages), pour faire un lien direct vers chaque tâche.
const [repoOwner, repoName] = (process.env.GITHUB_REPOSITORY || '').split('/');
const siteUrl = repoOwner && repoName ? `https://${repoOwner}.github.io/${repoName}` : null;

// Le message affiche désormais TOUTES les tâches non terminées (pas
// seulement celles dues aujourd'hui), pour une vue d'ensemble complète.
const remaining = tasks.filter((t) => t.status !== 'done');

const urgencyOrder = { urgent: 0, moyen: 1, faible: 2 };
const urgencyDot = { urgent: '🔴', moyen: '🟡', faible: '🟢' };

function formatTaskLine(t) {
  let escalation = '';
  if (t.dueDate) {
    const overdueDays = daysBetween(t.dueDate, today);
    if (overdueDays >= 3) escalation = ' 🔥 **en retard**';
    else if (overdueDays >= 1) escalation = ' ⚠️ *en retard*';
  } else if (t.createdAt) {
    const openDays = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
    if (openDays >= 5) escalation = ` ⏳ *en attente depuis ${openDays} j*`;
  }
  const project = t.project ? ` _(${t.project})_` : '';
  const assigneeMember = t.assigneeId ? memberById[t.assigneeId] : null;
  const assigneeTag = assigneeMember
    ? (assigneeMember.discordId ? `<@${assigneeMember.discordId}>` : assigneeMember.name)
    : null;
  const assignee = assigneeTag ? ` · 👤 ${assigneeTag}` : '';
  const titleText = siteUrl ? `[${t.title}](${siteUrl}/#/task/${t.id})` : t.title;
  return `${urgencyDot[t.urgency] || '⚪'} ${titleText}${project}${assignee}${escalation}`;
}

function formatDateHeader(dateStr) {
  const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const capped = label.charAt(0).toUpperCase() + label.slice(1);
  if (dateStr === today) return `📍 Aujourd'hui — ${capped}`;
  if (dateStr < today) return `⏰ En retard — ${capped}`;
  return capped;
}

// Vue façon agenda : un groupe par date (triées chronologiquement), plutôt
// que par urgence — on voit d'un coup d'œil ce qui tombe quand.
const byDate = new Map();
const withoutDate = [];
for (const t of remaining) {
  if (!t.dueDate) { withoutDate.push(t); continue; }
  if (!byDate.has(t.dueDate)) byDate.set(t.dueDate, []);
  byDate.get(t.dueDate).push(t);
}
const sortedDates = [...byDate.keys()].sort();
const sortByUrgency = (a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9);

const fields = sortedDates.map((dateStr) => {
  const items = byDate.get(dateStr).sort(sortByUrgency);
  let value = items.map(formatTaskLine).join('\n');
  if (value.length > 1024) value = value.slice(0, 1000) + '\n… (liste tronquée)';
  return { name: formatDateHeader(dateStr), value, inline: false };
});

if (withoutDate.length) {
  let value = withoutDate.sort(sortByUrgency).map(formatTaskLine).join('\n');
  if (value.length > 1024) value = value.slice(0, 1000) + '\n… (liste tronquée)';
  fields.push({ name: '🔹 Sans échéance', value, inline: false });
}

const payload = {
  username: 'Tableau de bord',
  embeds: [
    {
      title: `📋 Tableau de bord — ${today}`,
      description: remaining.length
        ? `${remaining.length} tâche(s) restante(s), classées par jour.`
        : 'Rien à faire actuellement. 🎉',
      fields,
      color: remaining.length > 0 ? 0xf85149 : 0x3fb950,
      footer: { text: `${remaining.length} tâche(s) au total` },
    },
  ],
};

const res = await fetch(webhookUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  console.error(`Échec de l'envoi Discord : ${res.status} ${await res.text()}`);
  process.exit(1);
}

console.log(`Message envoyé avec ${remaining.length} tâche(s).`);
