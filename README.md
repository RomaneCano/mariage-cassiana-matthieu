# Site de mariage Cassiana & Matthieu

Site statique (un seul `index.html` + dossier `img/`), publiable sur GitHub Pages.

## Ce qui se modifie
- Textes, parkings, dress code, chants, FAQ, lien de cagnotte : objet `CONTENT` en haut du script de `index.html`.
- Chants : renseigner `audio` avec un lien mp3 (lecteur intégré) ou un lien YouTube.

## Activer les réponses réelles (allergies, cadeaux, espace mariés)
1. Créer un projet Supabase gratuit, exécuter `supabase-schema.sql` (remplacer les deux e-mails des mariés).
2. Copier l'URL du projet et la clé « anon » dans `CONFIG` de `index.html`.
3. Authentication > URL Configuration : ajouter l'adresse GitHub Pages du site.
4. Sans cette configuration, le site fonctionne en mode démonstration (données stockées dans le navigateur seulement).

## Remplir automatiquement la colonne « Allergie » du Google Sheet
Coller `google-apps-script.gs` dans le Sheet (Extensions > Apps Script), le déployer en application Web, puis mettre l'URL dans `CONFIG.APPS_SCRIPT_URL`.
Les réponses sans correspondance dans la liste vont dans l'onglet « Allergies à rattacher ».

## QR code du carton papier
Pointer le QR code Canva vers `https://<adresse-du-site>/#infos`.
