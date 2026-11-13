# Site de mariage Cassiana & Matthieu

Site statique (un seul `index.html` + dossier `img/`), publiable sur GitHub Pages.

## Ce qui se modifie
- Textes, parkings, dress code, chants, FAQ, lien de cagnotte : objet `CONTENT` en haut du script de `index.html`.
- Chants et lien de cagnotte : modifiables par les mariés depuis l'espace mariés (`#admin`), sans toucher au code.

## Activer les réponses réelles (allergies, cadeaux, espace mariés)
1. Créer un projet Supabase gratuit, exécuter `supabase-schema.sql` (l'adresse des mariés est déjà renseignée).
2. Copier l'URL du projet et la clé « anon » dans `CONFIG` de `index.html`.
3. Authentication > URL Configuration : ajouter l'adresse GitHub Pages du site.
4. Sans cette configuration, le site fonctionne en mode démonstration (données stockées dans le navigateur seulement).

## Remplir automatiquement les colonnes « Présence » et « Allergie » du Google Sheet
Coller `google-apps-script.gs` dans le Sheet (Extensions > Apps Script), le déployer en application Web, puis mettre l'URL dans `CONFIG.APPS_SCRIPT_URL`.
Les réponses sans correspondance dans la liste vont dans l'onglet « Réponses à rattacher ».

## QR code du carton papier
Pointer le QR code Canva vers `https://<adresse-du-site>/#infos`.

## Espace des mariés (connexion e-mail + mot de passe)
1. Supabase > Authentication > Users > Add user > Create new user : e-mail + mot de passe, cocher « Auto Confirm User ». Un compte par personne (Cassiana, Matthieu) ou un compte commun.
2. Supabase > Authentication > Sign In / Providers > Email : désactiver « Allow new users to sign up » pour que personne d'autre ne puisse créer de compte.
3. Chaque e-mail autorisé doit être dans la table `admins` : `insert into admins(email) values ('adresse@exemple.fr');`
4. Une fois connecté (lien « Connexion des mariés » en bas de page), le bouton « Modifier les textes » permet de changer n'importe quel texte du site directement sur la page.

## Scripts SQL
`supabase-schema.sql` crée tout d'un coup. Si une version plus ancienne est déjà installée, exécuter dans l'ordre : `supabase-migration-reponses.sql`, `supabase-migration-textes.sql`, `supabase-migration-chant.sql`.
