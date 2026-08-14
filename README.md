# Tableau de bord

Un tableau type Trello (projets, étiquettes d'urgence, description, captures d'écran) entièrement hébergé par GitHub (Pages + Actions + API), avec un résumé Discord automatique chaque matin.

⚠️ **Ce dépôt doit être public** pour que GitHub Pages soit gratuit. Son contenu (tâches, captures d'écran) est donc techniquement accessible à qui connaît l'URL exacte, même si le site n'est référencé nulle part. Le mot de passe du site (voir étape 5) n'est qu'un déterrent léger, pas une vraie protection.

## Mise en ligne — à faire une seule fois

### 1. Créer le dépôt sur GitHub
- Va sur https://github.com/new
- Nom du dépôt : `task-board` (ou ce que tu veux, retiens-le)
- Visibilité : **Public**
- Ne coche rien d'autre (pas de README, pas de .gitignore — le dossier local en a déjà)
- Clique "Create repository"

### 2. Pousser le code
Dans ce dossier, exécute (en remplaçant `TON_PSEUDO`) :
```
git init
git add .
git commit -m "Premier envoi du tableau de bord"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/task-board.git
git push -u origin main
```

### 3. Activer GitHub Pages
- Sur la page du dépôt GitHub → **Settings** → **Pages**
- Source : "Deploy from a branch"
- Branch : `main`, dossier `/ (root)`
- Sauvegarde. Ton site sera disponible à `https://TON_PSEUDO.github.io/task-board/` après 1-2 minutes.

### 4. Créer ton jeton d'accès (pour pouvoir modifier les tâches depuis le site)
- https://github.com/settings/personal-access-tokens/new
- Nom : `task-board`
- Expiration : à ta convenance (ex: 1 an)
- "Repository access" → "Only select repositories" → choisis `task-board`
- "Permissions" → "Repository permissions" → **Contents : Read and write**
- Génère le jeton et **copie-le tout de suite** (il ne sera plus jamais affiché)

### 5. Configurer le site
- Ouvre `https://TON_PSEUDO.github.io/task-board/`
- Une fenêtre de paramètres s'ouvre automatiquement : renseigne ton pseudo GitHub, le nom du dépôt, et colle ton jeton
- (Optionnel mais recommandé) Change le mot de passe du verrou léger : édite la ligne `SITE_PASSPHRASE` dans [js/config.js](js/config.js), puis commit/push

### 6. Créer le webhook Discord
- Dans Discord : Paramètres du serveur → Intégrations → Webhooks → "Nouveau webhook"
- Choisis le salon où tu veux recevoir le résumé du matin
- Copie l'URL du webhook

### 7. Ajouter le webhook comme secret GitHub
- Sur le dépôt GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
- Nom : `DISCORD_WEBHOOK_URL`
- Valeur : colle l'URL copiée à l'étape précédente

### 8. Tester le message Discord sans attendre 9h
- Onglet **Actions** du dépôt → workflow "Digest Discord quotidien" → **Run workflow**
- Ça envoie immédiatement le résumé du jour sur Discord (utile pour vérifier que tout marche)

C'est tout : à partir de maintenant, chaque tâche non terminée dont la **date de rappel** (ou à défaut la date d'échéance) est aujourd'hui ou dépassée sera listée automatiquement dans le message Discord de 9h (heure de Paris, ajustée automatiquement été/hiver).

## Utilisation au quotidien
- **+ Nouvelle tâche** : titre, projet, étiquettes personnalisées, description, urgence, échéance, date de rappel, captures d'écran (glisser-déposer une image directement dans la zone prévue, ou clic pour choisir un fichier)
- Glisser-déposer les cartes entre **À faire / En cours / Terminé**
- La barre latérale résume ce qu'il te reste à faire (par urgence) et liste ce qui est urgent ou en retard
- **📨 Envoyer sur Discord** (en haut) déclenche l'envoi du résumé Discord immédiatement, sans attendre 9h — pratique pour tester ou pour prévenir d'un changement en cours de journée
- Chaque modification (créer/déplacer/supprimer une tâche, ajouter une capture) crée un petit commit automatique dans le dépôt — c'est normal, c'est comme ça que les données sont sauvegardées
- Le dépôt et le jeton restent enregistrés dans ton navigateur : pas besoin de les ressaisir à chaque visite (sauf si tu changes d'appareil ou vides le cache)

## Structure du projet
```
index.html              Page principale
css/style.css           Design
js/app.js                Logique du tableau (rendu, glisser-déposer, modales)
js/github.js             Appels à l'API GitHub (lecture/écriture des données)
js/config.js              Paramètres locaux + mot de passe du verrou léger
data/tasks.json           Toutes les tâches (la "base de données")
data/images/               Captures d'écran uploadées
.github/workflows/         Tâche planifiée du message Discord
.github/scripts/            Script qui construit et envoie le message Discord
```
