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

// Retente une fois en cas d'échec transitoire (réseau, 5xx) avant d'abandonner.
export async function putImageFileWithRetry(owner, repo, path, token, base64Content, message) {
  try {
    return await putImageFile(owner, repo, path, token, base64Content, message);
  } catch (e) {
    await new Promise((r) => setTimeout(r, 900));
    return await putImageFile(owner, repo, path, token, base64Content, message);
  }
}

// Redimensionne/compresse une image côté navigateur avant envoi, pour des
// uploads plus rapides et plus fiables (payload plus léger = moins de
// timeouts/erreurs). Ne touche pas aux images déjà petites.
export function prepareImageForUpload(file, { maxDim = 1600, quality = 0.85, maxBytes = 1.5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const needsResize = img.width > maxDim || img.height > maxDim;
      const needsCompress = file.size > maxBytes;
      if (!needsResize && !needsCompress) {
        resolve(file);
        return;
      }
      let { width, height } = img;
      if (needsResize) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Compression impossible'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => reject(new Error("Impossible de lire l'image"));
    img.src = url;
  });
}

export async function dispatchWorkflow(owner, repo, token, workflowFile) {
  const url = `${API}/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Échec du déclenchement (${res.status})`);
  }
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
