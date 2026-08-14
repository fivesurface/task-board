// Petite couche d'accès à l'API GitHub (Contents API).
// Le dépôt sert de "base de données" : on lit/écrit data/tasks.json et
// data/images/*.png via des commits.

const API = 'https://api.github.com';
const BRANCH = 'main';

function authHeaders(token) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}
function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

export async function getJsonFile(owner, repo, path, token) {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}?ref=${BRANCH}&_=${Date.now()}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`Lecture impossible (${res.status}) : ${path}`);
  const body = await res.json();
  return { data: JSON.parse(b64ToUtf8(body.content)), sha: body.sha };
}

export async function putJsonFile(owner, repo, path, token, dataObj, sha, message) {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: utf8ToB64(JSON.stringify(dataObj, null, 2)),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Échec de sauvegarde (${res.status})`);
  }
  return res.json();
}

export async function putImageFile(owner, repo, path, token, base64Content, message) {
  const url = `${API}/repos/${owner}/${repo}/contents/${path}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64Content, branch: BRANCH }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Échec de l'upload (${res.status})`);
  }
  const body = await res.json();
  return `https://raw.githubusercontent.com/${owner}/${repo}/${BRANCH}/${path}`;
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
