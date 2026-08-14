// Mot de passe du "verrou léger" côté site.
// Ce n'est PAS une vraie sécurité : le dépôt est public, donc data/tasks.json
// reste consultable directement par qui connaît l'URL. Ce mot de passe sert
// uniquement à décourager un visiteur qui tomberait sur le lien par hasard.
// Change cette valeur puis commit/push pour définir ton propre mot de passe.
export const SITE_PASSPHRASE = 'change-moi';

const KEYS = {
  owner: 'tb_owner',
  repo: 'tb_repo',
  token: 'tb_token',
  unlocked: 'tb_unlocked',
};

export const config = {
  get owner() { return localStorage.getItem(KEYS.owner) || ''; },
  set owner(v) { localStorage.setItem(KEYS.owner, v); },
  get repo() { return localStorage.getItem(KEYS.repo) || ''; },
  set repo(v) { localStorage.setItem(KEYS.repo, v); },
  get token() { return localStorage.getItem(KEYS.token) || ''; },
  set token(v) { localStorage.setItem(KEYS.token, v); },
  isComplete() {
    return Boolean(this.owner && this.repo && this.token);
  },
};

export function isUnlocked() {
  return sessionStorage.getItem(KEYS.unlocked) === '1';
}
export function unlock() {
  sessionStorage.setItem(KEYS.unlocked, '1');
}
