# Film Pulse — guide d'utilisation

Film Pulse mesure le rythme de montage d'un extrait (MP4 ou WebM, 50 Mo et 120 s maximum) : coupes, fondus, durée moyenne des plans (ASL), beats de la bande-son, tempo, palette, score de synchro coupes/musique. Le compte de démonstration est `demo@example.com` / `Demo1234!`. Le contrat HTTP est dans [API_CONTRACT.md](../../API_CONTRACT.md), le design dans [design-system.md](design-system.md).

## Parcours

| Étape | Où | Action |
|---|---|---|
| 1. Import | Studio (`/clips`) | Glisser-déposer ou choisir un fichier. L'analyse se fait dans le navigateur ; l'aperçu se remplit en direct, **Annuler l'analyse** l'interrompt. Messages d'erreur : format non accepté, fichier vide, trop volumineux (> 50 Mo), illisible. |
| 2. Analyse | Studio | Résultat : coupes, fondus, ASL, tempo, palette, profil de rythme (Contemplatif, Posé, Soutenu, Nerveux, Frénétique), score de synchro. Sans piste audio décodable, seules les coupes sont analysées (pas de score). |
| 3. Sensibilité | Studio ou Salle de montage | Curseur **k** de 1 à 6 (pas de 0,5, défaut 3). Plus k est bas, plus il y a de coupes. Le recalcul est local, la vidéo n'est pas relue. Dans la Salle de montage, **Enregistrer** (propriétaire) conserve le réglage ; **Réinitialiser** revient à l'analyse enregistrée. Indisponible pour les anciens clips v1 (sans `diffs`). |
| 4. Envoi | Studio | Titre, jusqu'à 5 étiquettes, visibilité privé ou public, barre de progression d'envoi. |
| 5. Annotations | Salle de montage (`/clips/:id`) | Saisir un texte (280 car. max) à l'instant voulu (**Utiliser le temps courant**), **Ajouter**. 200 max par clip. Tout lecteur autorisé annote ; l'auteur et le propriétaire suppriment. |
| 6. Partage | **Partager** (propriétaire) | Privé (vous seul), Amis (ceux que vous cochez), Public (tout utilisateur connecté). |
| 7. Amis | `/friends` | Inviter par e-mail (réponse identique que le compte existe ou non), accepter ou refuser, retirer. Retirer un ami révoque aussitôt son accès. Le fil d'activité liste les nouveaux clips des amis, les annotations reçues et les amitiés. |
| 8. Découverte | `/discover` | Onglets Public, Amis, Partagés avec moi, Classements (les plus nerveux, les plus calés sur la musique). Recherche par titre ou étiquette ; tri : récents, nerveux, calés. Vos propres clips n'y figurent pas. |
| 9. Comparaison | Studio : cocher 2 extraits puis **Comparer** (`/clips/compare`) | Lecture synchronisée : **temps absolu** ou **durée relative**, vitesses 0,5× à 2×. Pouls, palettes, histogrammes et statistiques superposés ; badges « Plus nerveux » et « Plus calé sur la musique ». |

## Raccourcis du lecteur (Salle de montage)

Actifs quand le focus est sur le lecteur, hors champ de formulaire.

| Touche | Action |
|---|---|
| Espace | Lecture / pause |
| K | Pause |
| L | Lecture ; répété, passe à la vitesse supérieure (0,25× à 2×) |
| J | Recule de 5 s |
| ← / → | Image précédente / suivante (pas de 1/25 s) |
| Maj + ← / → | Recule / avance d'1 s |

Boutons dédiés : coupe précédente / suivante, vitesse, volume, plein écran. Un clic sur une coupe de la timeline saute à cet instant.

## Exports (Salle de montage, section Exporter)

- **Image du pouls (PNG)** : 1600 × 900, aux couleurs du thème courant.
- **Données (JSON)** : l'analyse complète.

## Limites

- Durée et poids : 120 s et 50 Mo ; la durée est déclarée par le navigateur, le serveur ne la sonde pas.
- Précision des coupes ≈ 0,1 s (échantillonnage à 10 images/s) ; moins fiable sur les vidéos très sombres.
- Lecture image par image calée sur 25 i/s.
- Le score de synchro est recalculé par le serveur ; il vaut ≈ 1 sans lien avec la musique, > 1 si les coupes tombent sur les beats (plafond 10).
- Les extraits ne sont jamais publics par défaut : le partage est un choix explicite.
