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

const { date: today, hour } = parisNow();

// Le workflow se déclenche à 7h ET 8h UTC pour couvrir le changement d'heure.
// On ne veut envoyer le message qu'une seule fois, quand il est réellement 9h à Paris.
if (hour !== 9) {
  console.log(`Il est ${hour}h à Paris (pas 9h) — on ne fait rien pour ce déclenchement.`);
  process.exit(0);
}

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
if (!webhookUrl) {
  console.error("Le secret DISCORD_WEBHOOK_URL n'est pas configuré sur le dépôt.");
  process.exit(1);
}

const raw = await readFile(new URL('../../data/tasks.json', import.meta.url), 'utf-8');
const { tasks = [] } = JSON.parse(raw);

const due = tasks.filter((t) => {
  if (t.status === 'done') return false;
  const trigger = t.reminderDate || t.dueDate;
  return trigger && trigger <= today;
});

const urgencyOrder = { urgent: 0, moyen: 1, faible: 2 };
const urgencyLabel = { urgent: '🔴 Urgent', moyen: '🟡 Moyen', faible: '🟢 Faible' };
due.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

let description;
if (due.length === 0) {
  description = "Rien de prévu aujourd'hui. 🎉";
} else {
  description = due
    .map((t) => {
      const overdue = t.dueDate && t.dueDate < today ? ' ⚠️ *en retard*' : '';
      const project = t.project ? ` _(${t.project})_` : '';
      return `**${urgencyLabel[t.urgency] || t.urgency}** — ${t.title}${project}${overdue}`;
    })
    .join('\n');
}

const payload = {
  username: 'Tableau de bord',
  embeds: [
    {
      title: `📋 À faire aujourd'hui — ${today}`,
      description,
      color: due.length > 0 ? 0xf85149 : 0x3fb950,
      footer: { text: `${due.length} tâche(s) au total` },
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

console.log(`Message envoyé avec ${due.length} tâche(s).`);
