# AEEMCI Universitaire — version préparée pour Render

Plateforme Node.js/Express avec actualités, événements, inscriptions, espace organisateur et export CSV.

## Déploiement sur Render

Le fichier `render.yaml` configure le service web, le contrôle de santé et un disque persistant pour conserver la base SQLite entre les redémarrages et redéploiements.

1. Dépose le contenu de ce dossier dans le dépôt GitHub `ibrahimakhalilc8-lab/aeemci-site` (à la racine, sans conserver un dossier parent `aeemci-site` supplémentaire).
2. Dans Render, choisis **New + → Blueprint**, puis connecte le dépôt GitHub et lance le déploiement.
3. Render demandera la valeur secrète `ADMIN_SETUP_KEY`. Crée une longue clé aléatoire et conserve-la temporairement pour l'étape de création du premier administrateur.
4. Une fois le service déployé, ouvre son URL Render. Vérifie aussi `https://TON-SERVICE.onrender.com/health` : la réponse attendue est `{"status":"ok"}`.
5. Crée le premier administrateur avec la commande ci-dessous. Remplace l'URL, la clé, l'adresse et le mot de passe. Utilise un mot de passe unique d'au moins 12 caractères.

```bash
curl -X POST "https://TON-SERVICE.onrender.com/api/admin/setup" \
  -H "Content-Type: application/json" \
  -d '{"setupKey":"REMPLACE_PAR_TA_CLE","email":"admin@exemple.com","password":"REMPLACE_PAR_UN_MOT_DE_PASSE_LONG"}'
```

La réponse doit indiquer que l'administrateur a été créé. Connecte-toi ensuite dans **Espace organisateur** sur le site. Après la création du premier compte, cette route refuse les nouvelles créations.

## Important concernant le coût

Le fichier `render.yaml` utilise un service `starter` et un disque persistant de 1 Go, car les inscriptions sont enregistrées dans SQLite. Cette configuration n'est pas un déploiement gratuit. Ne retire pas le disque pour économiser : sur un système de fichiers éphémère, les inscriptions peuvent être perdues lors d'un redéploiement ou d'un redémarrage.

## Lancer localement

```bash
npm install
npm start
```

Ouvre `http://localhost:3000`.

Pour créer un compte administrateur localement, la méthode interactive `node create-admin.js` crée le compte dans la base locale.

## Fonctions incluses

- Affichage des actualités et activités
- Inscription avec validation serveur et contrôle des doublons par activité
- Connexion administrateur et session temporaire
- Publication d'activités et d'actualités
- Recherche des inscriptions et export CSV
- Vérification de santé pour Render
- En-têtes de sécurité de base et stockage configurable par variable d'environnement

## Avant un usage institutionnel

Cette version est prête à être déployée techniquement, mais ce n'est pas un audit de sécurité. Avant de recueillir des données réelles, définis la politique de confidentialité, les personnes habilitées à consulter les inscriptions, les durées de conservation et les procédures de sauvegarde. Les sessions sont conservées en mémoire et prennent fin lors d'un redémarrage. Ajoute aussi une limitation des tentatives de connexion avant une utilisation à grande échelle.
