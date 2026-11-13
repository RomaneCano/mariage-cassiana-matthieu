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

## Espace des mariés (onglet « Connexion » dans la barre)
Un seul accès : le petit onglet « Connexion » de la barre du haut. Rien d'autre ne mène à l'espace des mariés.
1. Exécuter `supabase-migration-comptes.sql` : seules les adresses de la table `admins` peuvent créer un compte (par défaut `cassmattas@gmail.com`).
2. Supabase > Authentication > Sign In / Providers > Email : laisser « Allow new users to sign up » activé et « Confirm email » activé. Le déclencheur SQL refuse toute adresse absente de `admins`.
3. Cassiana et Matthieu créent leur compte eux-mêmes : onglet Connexion > « Créer mon compte », e-mail autorisé + mot de passe, puis lien de confirmation reçu par e-mail. À faire dès la mise en ligne.
4. Pour autoriser une autre adresse : `insert into admins(email) values ('adresse@exemple.fr');`
5. Une fois connecté : réponses des invités, chants, questions, cagnotte, et bouton « Modifier les textes du site » pour changer n'importe quel texte directement sur la page.

## Scripts SQL
`supabase-schema.sql` crée tout d'un coup. Si une version plus ancienne est déjà installée, exécuter dans l'ordre : `supabase-migration-reponses.sql`, `supabase-migration-textes.sql`, `supabase-migration-chant.sql`, `supabase-migration-comptes.sql`.
