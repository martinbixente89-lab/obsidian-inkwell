# Changelog

Toutes les modifications notables apportées au plugin **Inkwell** sont consignées dans ce fichier.

Le format s’appuie sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/) et respecte les règles de [Semantic Versioning](https://semver.org/lang/fr/).

## [1.5.1] - 2026-10-28

### Version 1.5.1 — Correctif : Rétablissement des sources TypeScript de gestion des polices

Cette version corrective résout une exclusion involontaire dans le fichier `.gitignore` qui masquait les sources TypeScript du module de polices lors de la compilation publique.

### Corrections
- **Rétablissement des sources TypeScript `src/fonts/`** :
  - Ajustement de la règle d'exclusion des polices du coffre dans `.gitignore` (`/fonts/`) pour ne cibler que les dossiers de polices du coffre et inclure les fichiers TypeScript `font-manager.ts` et `types.ts` dans le dépôt public.
  - Résolution complète des avertissements de typage TypeScript (`@typescript-eslint/no-unsafe-*`) liés à l'absence de ce module sur le dépôt distant.

---

## [1.5.0] - 2026-10-28

### Version 1.5.0 — Format HTML unifié en ligne & Barre d’outils compacte à 4 groupes

Cette version majeure unifie l’ensemble des commandes de mise en forme en ligne d’Inkwell sous une représentation HTML moderne et cohérente, éliminant définitivement les conflits liés aux marqueurs Markdown (`**`, `*`, `~~`), et introduit une barre d'outils flottante compacte restructurée en 4 îlots fonctionnels.

### Nouveautés et Améliorations
- **Modèle de mise en forme 100% HTML unifié** :
  - Les commandes, boutons de la barre flottante et raccourcis (`Mod+B`, `Mod+I`, `Mod+U`) génèrent désormais des styles CSS combinables au sein d’une balise `<span data-inkwell="1" style="...">` unique :
    - **Gras** : `font-weight: bold;`
    - **Italique** : `font-style: italic;`
    - **Souligné et Barré** : combinés sur `text-decoration` (`underline`, `line-through`, ou `underline line-through`).
  - Aucun marqueur `**`, `*` ou `~~` n'est plus jamais produit par les commandes Inkwell.
- **Indépendance et retrait sélectif des styles** :
  - Chaque style peut être appliqué ou retiré de façon indépendante sans altérer les autres styles présents sur le passage (couleur, surlignage, police, taille, souligné).
  - La balise `<span>` est nettoyée et supprimée automatiquement dès lors que tous les styles sont retirés.
- **Absorption intelligente des notes existantes (sans conversion de masse)** :
  - Aucune conversion globale du coffre.
  - Lorsqu'un formatage est appliqué ou retiré sur un passage contenant d'anciens délimiteurs (`**...**`, `*...*`, `~~...~~`, `<u>...</u>`), ceux-ci sont absorbés et nettoyés proprement sans empilement de balises inutiles.
- **Nouvelle barre flottante compacte à 4 îlots fonctionnels** :
  - Réorganisation ergonomique en 4 groupes séparés par de fins séparateurs verticaux :
    - **Groupe 1 (Mise en forme)** : Gras, Italique, Souligné, Barré.
    - **Groupe 2 (Styles Inkwell)** : Couleur, Surlignage, Taille / titres, Police.
    - **Groupe 3 (Édition)** : Modifier le passage entier.
    - **Groupe 4 (Nettoyage)** : Menu de nettoyage ciblé (couleur, surlignage) + Nettoyage global en 1 clic.
  - Gabarit fin d'environ 348 px de large avec boutons confortables de `26px × 26px`.
- **Lisibilité renforcée des états actif et mixte (accessibilité visuelle)** :
  - **Actif** : fond plein de couleur d'accentuation avec bordure nette et icône contrastée.
  - **Mixte** : fond intermédiaire, cadre d'accentuation en incrustation et tiret pointillé distinctif en bas du bouton, immédiatement lisible indépendamment de la couleur.

---



### Version 1.4.1 — Correctif : Masquage universel des balises HTML en modes Source et Aperçu en direct

Cette version corrective élimine l'exposition des balises HTML de mise en forme (`<span>`, `<u>`) dans les notes quel que soit le mode d'affichage utilisé (Lecture, Aperçu en direct et mode Source), y compris lorsque le curseur est placé dans le passage ou qu'une sélection le traverse.

### Corrections et Améliorations
- **Masquage complet des balises en Aperçu en direct et en mode Source** :
  - Masquage des balises ouvrantes et fermantes (`<span ...>`, `</span>`, `<u>`, `</u>`) et de leurs attributs (`style`, `data-inkwell`, etc.).
  - Maintien du masquage lorsque le curseur entre dans le passage ou qu'une sélection le traverse.
  - Décoration continue du texte affichant fidèlement la mise en forme (couleur, surlignage, apparence, taille en pt, police personnalisée, soulignement, gras).
- **Prise en charge des balises Inkwell et des anciens spans de mise en forme** :
  - Détection et masquage des spans Inkwell (`data-inkwell="1"`) ainsi que des anciens spans de mise en forme sans `data-inkwell` (`<span style="color: ...">`, `<span style="font-size: ...">`, etc.).
  - Prise en charge des balises de soulignement `<u>...</u>` utilisées par le plugin.
  - Spans imbriqués (`<span style="color: red"><span style="font-size: 20pt">...</span></span>`) pris en charge avec masquage disjoint des balises et superposition exacte des styles.
  - Passages sur plusieurs lignes et défilement pris en charge sans dépendance visuelle à la présence de la balise ouvrante à l'écran.
- **Préservation stricte du code et des balises non prises en charge** :
  - Les blocs de code (``` ... ```) et le code en ligne (` ... `) restent rigoureusement intacts et visibles (aucune balise masquée à l'intérieur).
  - Les marqueurs Markdown (`**`, `*`, `#`) conservent leur comportement standard.
  - Les balises HTML tierces non prises en charge (`<div>`, `<p>`, `<table>`, `<script>`, `<mark>`, `<font>`, `<b>`, `<i>`, `<s>`, ou spans dotés d'attributs `id`, `class`, `onclick`) restent explicitement visibles pour ne jamais rendre du contenu invisible de façon arbitraire.
- **Intégrité absolue du fichier sur disque** :
  - Le simple affichage ou défilement ne modifie, ne supprime et ne normalise aucune note sur le disque.
  - Toute modification du contenu résulte exclusivement d'une action d'édition explicite (saisie, suppression, copier-coller).
  - Prise en charge éprouvée de la frappe, des suppressions aux frontières, du copier-coller et de l'annulation/rétablissement (`Cmd+Z` / `Cmd+Shift+Z`).

---

## [1.4.0] - 2026-10-27

### Version 1.4.0 — Personnalisation de l’apparence du surlignage (Coins arrondis, Épaisseur, Position)

Cette version enrichit le surlignage avec des options avancées d'apparence directement accessibles depuis la barre flottante : coins arrondis, réglage de l'épaisseur du bandeau coloré et décalage vertical par rapport aux lettres, avec aperçu interactif en temps réel, indicateur de contraste adapté et bouton de rétablissement de l'apparence par défaut.

### Ajouts et Fonctionnalités
- **Section « Apparence » dans la modale de surlignage** :
  - Accessible directement depuis le bouton « Surlignage personnalisé… » du menu popover de surlignage.
  - **Coins arrondis** : Curseur réglable de 0 à 12 px avec valeur numérique et libellé explicite (« Arrondi des angles (actuel : N px) »), permettant d'obtenir des coins droits ou des extrémités très arrondies.
  - **Épaisseur** : Curseur réglable de 15% à 100% de la hauteur du texte avec affichage du pourcentage (« Hauteur du bandeau coloré (actuelle : N%) »), du trait fin soulignant le mot jusqu'au bandeau plein couvrant tout le texte.
  - **Position verticale** : Curseur réglable de 0% à 85% permettant de décaler verticalement le bandeau (« Décalage vertical du bandeau (actuel : N%) »).
  - **Distinction claire épaisseur et position** : Permet de choisir indépendamment un surlignage fin placé au ras de la ligne de base des lettres, centré sur le texte, ou placé plus haut.
- **Aperçu en direct et contraste adapté** :
  - Boîte d'aperçu dynamique actualisant instantanément le rendu visuel selon la couleur, l'opacité et les trois curseurs d'apparence.
  - L'indicateur de contraste adapte son libellé en précisant `(zone couverte par le bandeau)` lorsque l'épaisseur est inférieure à 100%, évitant ainsi toute interprétation trompeure.
  - Bouton « Appliquer » validant la sélection initiale, et fermeture/annulation sans modification de la note.
- **Option « Apparence par défaut »** :
  - Bouton disponible dans la modale de réglage (« Rétablir ») ainsi que dans le pied du menu popover de surlignage (« Apparence par défaut »).
  - Retire exclusivement les propriétés d'arrondi (`border-radius`), d'épaisseur et de décalage (`background-image`), restaurant le bandeau rectangulaire plein (`background-color`) sans jamais supprimer la couleur ni l'opacité choisie.
- **Rendu non intrusif et multi-lignes** :
  - Rendu CSS basé sur `linear-gradient(to top, ...)` et `-webkit-box-decoration-break: clone; box-decoration-break: clone;`.
  - Ne déplace aucune lettre, ne modifie ni la taille du texte ni l'interlignage (`line-height`).
  - Gère les retours à la ligne sans relier artificiellement la fin d'une ligne au début de la suivante.
  - Préserve intégralement les polices importées, les tailles personnalisées, les couleurs de texte, le gras, l'italique et les liens.
  - Prise en charge de l'annulation/rétablissement en 1 étape (`Cmd+Z`).

---

## [1.3.0] - 2026-10-27

### Version 1.3.0 — Titres Markdown et Taille personnalisée (points)

Cette version enrichit la barre d'outils flottante avec un menu unifié « Taille / Titres » offrant la gestion directe des véritables titres Markdown hiérarchiques et le dimensionnement personnalisé du texte en points (`pt`), comme dans Word.

### Ajouts et Fonctionnalités
- **Titres Markdown hiérarchiques (# à ######)** :
  - Menu « Taille / Titres » accessible depuis la barre d'outils flottante.
  - Options « Texte normal » et « Titre 1 » à « Titre 6 » avec aperçus visuels proportionnels permettant de distinguer immédiatement chaque niveau.
  - Utilisation exclusive des véritables marqueurs Markdown (# à ######) conformément à la syntaxe native, sans recourir à des balises HTML pour les titres.
  - Action ciblant l'ensemble de la ligne ou du paragraphe concerné, sans affecter les autres paragraphes.
  - Remplacement immédiat et propre des marqueurs existants sans accumulation (ex. un passage H1 transformé en H3 devient directement `### ` et non `# ### `).
  - « Texte normal » retire le niveau de titre sans supprimer le contenu ni altérer les styles internes (gras, italique, liens, balises Inkwell).
- **Taille personnalisée en points (style Word)** :
  - Champ numérique permettant de saisir une taille exacte avec unité explicite en points (`pt`).
  - Validation contrôlée par la touche Entrée ou par un bouton dédié « Appliquer » (aucune modification parasite à chaque chiffre tapé).
  - Contrôle strict des bornes autorisées (4 à 144 pt) avec rejet propre des valeurs invalides et rappel d'aide.
  - Grille de raccourcis rapides vers les tailles courantes (8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72 pt).
  - Option « Taille par défaut » retirant exclusivement la propriété `font-size`, sans effacer la police (`font-family`), la couleur, le surlignage ou les enrichissements markdown.
  - Affichage de la taille active ou indicateur explicite « Tailles multiples » lorsque la sélection contient des tailles hétérogènes.
  - Application ciblée uniquement au texte sélectionné via balise `<span>` standard sans modifier toute la note ni l'interface.
- **Expérience utilisateur et robustesse** :
  - Conservation stricte de la sélection initiale lors de l'interaction avec le menu, les boutons et le champ numérique.
  - Prise en charge intégrale de l'annulation et du rétablissement en une seule étape (`Cmd+Z` / `Cmd+Shift+Z`).
  - Rendu fidèle et validé simultanément en Aperçu en direct (Live Preview) et en mode Lecture (Reading view).

---

## [1.2.0] - 2026-10-27

### Version 1.2.0 — Polices personnelles et Choix depuis la barre flottante

Cette version apporte la prise en charge des polices personnelles importées localement dans le coffre (.ttf, .otf, .woff, .woff2), leur sélection avec aperçu typographique direct depuis la barre d'outils flottante, la distinction stricte des variantes (normale, grasse, italique) et le repli automatique sans altération des notes.

### Ajouts et Fonctionnalités
- **Importation et gestion des polices personnelles (Réglages)** :
  - Section dédiée « Polices personnelles » dans les paramètres d'Inkwell.
  - Importation d'un ou plusieurs fichiers `.ttf`, `.otf`, `.woff` ou `.woff2`.
  - Vérification réelle du chargement de la police via l'API `FontFace` du moteur Chromium avant toute persistance ; rejet propre et explicite des fichiers invalides ou corrompus.
  - Copie physique des fichiers de police dans le dossier local du coffre : `<Vault>/.obsidian/plugins/inkwell/fonts/` (fonctionnement 100 % local et hors ligne, sans requête réseau ni service tiers).
  - Affichage de chaque police importée avec son format, sa graisse, son style, sa taille de fichier et un aperçu typographique en direct.
  - Modification aisée du nom d'affichage de la police dans Inkwell via modale dédiée.
  - Gestion automatique des doublons sans écrasement silencieux (résolution unique de nom et de fichier).
  - Retrait sécurisé d'une police avec modale de confirmation explicite, suppression du fichier et déchargement de `document.fonts`.
  - Carte d'information documentant les fichiers à transférer pour synchroniser ses polices entre appareils.
- **Sélection et application depuis la barre d'outils flottante** :
  - Bouton « Police » (`lucide-case-sensitive`) dans la barre flottante ouvrant la liste complète des polices importées avec aperçu typographique réel pour chacune.
  - L'application d'une police cible strictement le texte sélectionné (`<span data-inkwell="1" style="font-family: '...';">...</span>`) sans affecter le reste de la note ni l'interface d'Obsidian.
  - Conservation absolue de la sélection cible lors de l'interaction avec le menu.
  - Option « Police par défaut » retirant uniquement la personnalisation de police du passage, tout en préservant intacts sa couleur, son surlignage, sa taille, son gras ou son italique.
  - Affichage explicite de l'état « Polices multiples » lorsque la sélection contient plusieurs polices hétérogènes.
- **Compatibilité, persistance et robustesse** :
  - Rendu validé en Aperçu en direct (Live Preview) et en mode Lecture (Markdown preview).
  - Préservation intégrale des styles cumulés (couleur, surlignage, taille, gras, italique, souligné, barré).
  - Préservation intégrale de l'historique d'annulation et de rétablissement (`Cmd+Z` / `Cmd+Shift+Z`).
  - Rechargement automatique de toutes les polices importées au démarrage du plugin et lors de l'ouverture de fenêtres secondaires (popouts).
  - Distinction formelle des variantes importées séparément (normale, grasse, italique) via des identifiants et familles CSS dédiés, interdisant toute confusion ou collision de famille.
  - Repli automatique sans réécriture : si un fichier de police est manquant ou retiré, le texte s'affiche avec la police de repli standard (`sans-serif`) sans qu'aucun texte ne soit effacé ni aucune note modifiée.

---

## [1.1.0] - 2026-10-27

### Version 1.1.0 — Palettes personnalisées et Contrôle de contraste

Cette version apporte la gestion complète des palettes de couleurs personnalisées pour le texte et le surlignage, l'accès direct aux favoris et aux nuances récentes, ainsi qu'une indication précise de contraste WCAG 2.1 dans la barre d'outils et les réglages.

### Ajouts et Fonctionnalités
- **Gestion complète des palettes personnelles** :
  - Création de palettes personnalisées de texte et de surlignage avec nom et identifiant dédié.
  - Renommage et suppression sécurisée des palettes personnalisées (avec confirmation pour la suppression).
  - Ajout, édition du nom et de la valeur (hex, rgb, rgba), suppression et réorganisation ordonnée (déplacement haut/bas) de chaque nuance.
  - Préservation des palettes intégrées d'origine (non supprimables, toujours récupérables).
- **Nuances récentes et favorites** :
  - **Récents** : enregistrement automatique selon l'ordre d'usage le plus récent (MRU, max 10 éléments, déduplication stricte sans doublon).
  - **Favoris** : bascule directe (étoile ★) depuis les réglages ou les modales, synchronisée immédiatement.
  - Onglets dédiés **Palette**, **Favoris** et **Récents** dans les menus popover de la barre d'outils flottante.
- **Sélection des couleurs par défaut étendue** :
  - Choix de la couleur de texte par défaut et du surlignage par défaut parmi toutes les nuances disponibles (intégrées et personnalisées).
  - Repli explicite et prévisible si une couleur par défaut venait à être supprimée.
- **Indication de contraste WCAG 2.1** :
  - Évaluation dynamique du ratio de contraste avec identification explicite du fond évalué (thème clair, thème sombre ou surlignage translucent mélangé via composition alpha).
  - Distinction formelle entre le texte normal (seuil WCAG AA ≥ 4.5:1) et le grand texte (seuil WCAG AA ≥ 3.0:1).
  - Détection des sélections hétérogènes signalant un état explicite (« Sélection mixte - contraste variable ») évitant tout ratio trompeur.
  - Suggestion consultative d'une alternative plus lisible sans jamais remplacer silencieusement une couleur choisie ni bloquer son application.
- **Importation et exportation JSON documentées** :
  - Exportation de toutes les palettes dans un fichier JSON versionné (`schemaVersion: 1`).
  - Validation stricte de la structure et du format avant tout import, avec rejet propre des contenus invalides.
  - Choix du traitement des conflits : **Fusion** (conserve l'existant et renomme les doublons) ou **Remplacement** (écrase les palettes personnalisées en conservant les palettes d'usine).
- **Réinitialisation ciblée des palettes** :
  - Bouton dédié permettant de restaurer les palettes d'usine indépendamment des autres paramètres du plugin et sans impacter les notes.

### Préservation stricte de la V1.0.0
- **Intégrité absolue des notes** : aucun changement rétroactif des notes existantes ni modification de leur format HTML/Markdown. La suppression d'une palette ne modifie pas les balises existantes dans les documents.
- **Non-régression vérifiée** : masquage des balises, franchissement au clavier, combinaisons canoniques de styles (Cas 6), assainissement et aller-retour du presse-papier préservés.

### Procédure de retour arrière vers la V1.0.0
- **Sauvegarde préalable de `data.json`** : Avant tout retour arrière vers la V1.0.0, copier le fichier de configuration de coffre : `<Vault>/.obsidian/plugins/inkwell/data.json`.
- **Comportement par champ sous la V1.0.0** :
  - *Champs préexistants conservés par la V1.0.0* : `defaultColor` (si présente dans la palette intégrée d'origine V1.0.0, sinon repli sur `#e03131`), `defaultHighlightColor` (si présent dans les surlignages intégrés, sinon repli sur `rgba(255, 212, 59, 0.35)`), `toolbarEnabled`, `experimentalTagNavigation` et `experimentalColorBoldSupport`.
  - *Champs ajoutés en V1.1.0 ignorés par la V1.0.0* : `palettes`, `favoriteColors`, `favoriteHighlights`, `recentColors`, `recentHighlights`, `activeTextPaletteId` et `activeHighlightPaletteId`.
  - En cas d'enregistrement de réglages sous la V1.0.0, les nouveaux champs sont omis de `data.json` ; la copie préalable de sauvegarde permet leur réintégration intégrale lors d'une réinstallation ultérieure de la V1.1.0.

---

## [1.0.0] - 2026-10-27

### Version 1.0.0 — Première version officielle (macOS Desktop)

Cette version marque l'aboutissement du périmètre fonctionnel convenu pour Inkwell sur macOS Desktop, combinant la barre flottante, le dimensionnement, les polices, le surlignage, la navigation/masquage de balises et l'assainissement complet du presse-papier.

### Ajouts et Finalisations
- **Activation par défaut de l'expérience complète pour les nouvelles installations** :
  - **Navigation et masquage des balises** (`experimentalTagNavigation: true` par défaut) : franchissement atomique des balises par les flèches et masquage des balises à l'édition de la ligne active en Aperçu en direct.
  - **Prise en charge couleur et gras** (`experimentalColorBoldSupport: true` par défaut) : rendu, synchronisation de graisse inactive et partitionnement propre lors du gras partiel sur combinaisons canoniques Cas 6 (`**<span ...>...</span>**`).
  - **Préservation des réglages existants** : les choix explicitement enregistrés par les utilisateurs existants (`false` ou `true`) sont préservés intacts sans écrasement lors de la montée de version.
- **Assainissement et contrat du presse-papier de bout en bout** :
  - `text/plain` : texte lisible sans balises de présentation Inkwell, préservation des caractères littéraux `<`, `>`, `&` et des délimiteurs Markdown.
  - `text/html` : structure HTML équilibrée représentant le gras via `<strong>` sans astérisques Markdown littéraux `**`, avec encodage strict des entités.
  - **Interception du collage** : conversion automatique des fragments HTML Inkwell riches collés en Markdown canonique (Cas 6), neutralisant le filtre natif d'Obsidian sans régression vers le Cas 1.
  - Aller-retour inter-notes vérifié sans altération du document destination.
- **Libellés de réglages clarifiés** :
  - Distinction nette entre fonctionnalités livrées et limites restantes.
  - Identifiants de réglages internes strictement préservés (`experimentalTagNavigation`, `experimentalColorBoldSupport`, `toolbarEnabled`).

### Réserves Documentées et Limites
1. **Compatibilité validée sur macOS Desktop uniquement** : L'ensemble des vérifications interactives et de rendu a été validé sous environnement macOS Desktop (Chromium/Electron).
2. **Presse-papier système externe non vérifié de bout en bout** : L'interception et la purification des flux sont vérifiées au sein d'Obsidian. Les échanges via le presse-papier externe d'applications tierces non-Chromium restent sous réserve des filtres du système hôte.
3. **Contrastes limités de certaines couleurs** : La palette statique privilégie l'expression colorimétrique native. Le jaune ocre (`#d48806`) sur fond blanc (2.87:1) reste en deçà du seuil 3:1 WCAG. Les notes existantes et couleurs personnalisées ne sont jamais modifiées.
4. **Cas 1 historique non migré automatiquement** : Le format historique inversé (`<span ...>**texte**</span>`) reste lisible et protégé, sans réécriture silencieuse ni migration globale. La commande facultative de réparation manuelle reste disponible.

---

## [0.6.0] - 2026-10-26

### Ajouts
- **Choix des familles de polices (3 familles génériques + retour au défaut du contexte)** :
  - **Sans empattement** : `font-family: sans-serif;`.
  - **Avec empattement** : `font-family: serif;`.
  - **Monospace** : `font-family: monospace;`.
  - **Police par défaut** : retrait de `font-family` (le passage reprend la police naturelle héritée du contexte).
  - *Distinction claire* : `sans-serif` est une famille générique CSS standard et distincte de la police configurée dans Obsidian.
- **Accès par la barre flottante contextuelle et 5 nouvelles commandes** :
  - Bouton **Police du texte** (`lucide-case-sensitive`) dans le Groupe 2 de la barre d'outils flottante.
  - Popover typographique avec prévisualisation du rendu de chaque police sur son étiquette, badge explicatif, navigation au clavier et focus visible.
  - Détection d'état actif ou de l'indicateur **« Police mixte »** (`.inkwell-font-mixed-info`) sans option active trompeuse.
  - 5 commandes Obsidian :
    - `inkwell:choose-font-family` (modale FuzzySuggestModal avec prévisualisation).
    - `inkwell:set-font-sans-serif`.
    - `inkwell:set-font-serif`.
    - `inkwell:set-font-monospace`.
    - `inkwell:remove-font-family`.
- **Règles de suppression et de préservation** :
  - Retirer la police (`remove-font-family`) retire uniquement `font-family` et conserve couleur, surlignage, taille, formats Markdown (`**`, `*`, `~~`), souligné (`<u>`) et attributs tiers.
  - Si plus aucun style Inkwell ne subsiste, le marqueur `data-inkwell="1"` est retiré, mais la balise `<span>` est préservée si elle comporte encore des attributs ou styles tiers utiles (`class`, `data-*`). La balise n'est supprimée que si elle est devenue superflue.
  - **Retirer les styles Inkwell** (`clear-all-styles`) élimine les 4 propriétés gérées (`color`, `background-color`, `font-size`, `font-family`) en une opération, tout en préservant intacts gras, italique, souligné, barré et attributs tiers.
- **Sélections partielles et mixtes** :
  - Modifier une partie d'un passage dimensionné ou stylé ne modifie pas les mots environnants.
  - Appliquer une police à une sélection mixte l'harmonise intégralement sous la famille choisie, sans produire de spans imbriqués.
  - L'état est évalué selon le format enregistré : l'absence de `font-family` correspond à la police par défaut.
- **Rendu typographique et préservation géométrique** :
  - Vérifié en aperçu en direct (Live Preview) et en mode Lecture dans les paragraphes, les listes (`-`) et les titres (`#`).
  - La police Monospace préserve la taille du texte sans réduction involontaire.
  - Repositionnement immédiat de la barre d'outils et des menus popover après changement de police.
- **Préservation de la sélection et annulation en une fois** :
  - La sélection reste active après chaque application de police pour permettre d'enchaîner directement d'autres styles.
  - Chaque opération constitue une transaction unique annulable en un seul `Cmd + Z`.
  - Maintien des exclusions strictes (liens Markdown, wikilinks `[[...]]`, code, sélections multilignes) et protection des balises HTML non marquées `data-inkwell="1"`.

- **Recalibrage de la palette par défaut (V0.6.0)** :
  - Nuances ajustées pour les nouvelles applications : Violet `#ae3ec9` (contraste sombre $3.52:1$, clair $4.85:1$), Orange `#e8590c` (sombre $4.76:1$, clair $3.58:1$), Jaune ocre `#d48806` (sombre $5.94:1$, clair $2.87:1$).
  - Notes existantes et couleurs personnalisées strictement préservées.
- **Rendu contrasté du surlignage en mode sombre (V0.6.0)** :
  - Règle ciblée appliquant la couleur `#1e1e1e` (contraste $> 11:1$) uniquement aux surlignages clairs sans couleur de texte explicite.
  - Couverture uniforme sur les 3 états : édition active (décoration CodeMirror), ligne inactive (`.cm-html-embed`), et mode Lecture (Markdown post-processor).
  - Préservation des fonds sombres personnalisés (`#222222`) et des couleurs explicites.
- **Désinfection du presse-papier et sélections multilignes (V0.6.0)** :
  - `text/plain` : texte lisible sans balises de présentation Inkwell, avec préservation stricte des caractères littéraux `<`, `>`, `&`.
  - `text/html` : contenu enrichi équilibré et correctement encodé avec conversion du gras en `<strong>`.
  - Aller-retour d'une source canonique Cas 6 vérifié sans recréation de Cas 1, avec maintien du rendu et de l'édition normale dans la note de destination.
  - Sauts de ligne multilignes isolés en dehors des balises inline pour préserver la structure Markdown.

### Validation & Tests
- **Tests unitaires automatisés (219 tests dans `npm test`)** :
  - Validation du désinfecteur de presse-papier, des entités et des caractères littéraux.
  - Protection des structures multilignes et non-altération du Markdown environnant.
  - Détection et isolation stricte des spans simples et des attributs Inkwell.
  - Définition et application des 4 options de police, non-cumulativité et idempotence.
- **Interactions réelles dans Obsidian (macOS Desktop)** :
  - Parcours utilisateur complet vérifié : sélection $\to$ bouton de barre $\to$ popover $\to$ choix $\to$ modification $\to$ sélection conservée pour la taille et la police.
  - Positionnement dynamique avec confinement strict aux bords gauche, droit, haut et bas de l'éditeur.
  - Rétablissement des réglages par défaut vérifié via le bouton physique `Réinitialiser` du panneau de réglages.
  - Aller-retour inter-notes du presse-papier vérifié avec le `DataTransfer` réel sur un passage canonique Cas 6.
- **Clarification mobile et limites** :
  - Prise en charge officielle limitée à macOS Desktop (environnement effectivement vérifié).
  - Format historique Cas 1 non réécrit automatiquement ; commande de réparation manuelle disponible.

---

## [0.5.1] - 2026-10-26

### Ajouts
- **Zone de mise en forme dans la barre flottante (Groupe 1)** :
  - Organisation en 3 groupes séparés visuellement par des séparateurs verticaux :
    `[ Gras | Italique | Souligné | Barré ] | [ Couleur | Surlignage | Taille ] | [ Retirer couleur | Retirer surlignage | Retirer les styles Inkwell ]`.
  - 4 boutons à bascule indépendants basés sur les icônes natives Obsidian :
    - **Gras** (`lucide-bold`) : syntaxe `**texte**` (ou `__`).
    - **Italique** (`lucide-italic`) : syntaxe `*texte*` (ou `_`).
    - **Souligné** (`lucide-underline`) : balise HTML `<u>texte</u>`.
    - **Barré** (`lucide-strikethrough`) : syntaxe `~~texte~~`.
- **Comportement des boutons à bascule (inactif / mixte / actif)** :
  - *Inactif ou mixte* : le premier clic harmonise et applique le format à l'intégralité de la sélection.
  - *Actif* : le clic retire ce format sur toute la sélection.
  - *Sélection partielle* : découpage propre du format sans altérer les mots environnants. Les espaces intérieurs adjacents aux délimiteurs sont replacés à l'extérieur pour préserver une syntaxe Markdown valide sur les scénarios testés sans astérisques résiduels (ex. `Un **grand et** beau passage.`).
  - *Préservation de la sélection* : la sélection reste active après chaque clic pour permettre d'enchaîner directement plusieurs actions de formatage.
  - *Annulation en une seule fois* : chaque opération de formatage constitue une transaction d'éditeur unique (`Cmd + Z` rétablit l'état antérieur en un geste).
- **Accessibilité et disposition responsive** :
  - Utilisation de `aria-pressed="true"`, `"false"`, et `"mixed"` sur les boutons à bascule.
  - Indicateur visuel distinctif pour l'état mixte (`.is-mixed` avec barre de soulignement indicatrice).
  - Disposition compacte sur deux rangées (`.is-compact`, $190\text{ px} \times 66\text{ px}$) lorsque la zone visible est étroite ($< 420\text{ px}$), évitant tout défilement horizontal masqué.
- **Hiérarchie et ordre de sérialisation unique** :
  - Règle de sérialisation stricte : Markdown (`**`, `*`, `~~`) à l'extérieur de `<u>`, `<u>` à l'extérieur de `<span>`, texte au centre :
    `**_~~<u><span data-inkwell="1">...</span></u>~~_**`.
  - Extension Live Preview CodeMirror ([live-preview-extension.ts](file:///Users/westkronos147/mon-plugin/src/editor/live-preview-extension.ts)) : propagation des classes `.cm-strong`, `.cm-em`, `.cm-strikethrough` sur les éléments HTML imbriqués (`<u>`, `<span>`) pour assurer un rendu calculé vérifié identique sur les scénarios testés en Live Preview et en mode Lecture.
- **Protection des formats existants** :
  - Les balises `<u>` simples sont reconnues comme du soulignement natif autorisé.
  - Les balises `<u>` dotées d'attributs ou de styles tiers sont préservées intactes lors des découpages partiels.
  - La commande et le bouton **Retirer les styles Inkwell** (`clear-all-styles`) suppriment couleur, surlignage et taille, tout en préservant intégralement le gras, l'italique, le souligné et le barré.

### Validation & Tests
- **Validation manuelle par l'utilisateur en conditions réelles** :
  - Confirmation explicite du comportement des boutons Gras, Italique, Souligné et Barré dans leur zone distincte de la barre.
  - Validation du rendu visuel en Aperçu en direct et en mode Lecture, du découpage sans marqueurs parasites, de la persistance de sélection et du respect des formats existants lors du retrait des styles Inkwell.
- **Tests automatisés et simulations de régression (93 tests unitaires dans `npm test`)** :
  - Détection des syntaxes Markdown et des balises `<u>`.
  - Exclusion stricte du code inline (`` `code` ``) et des délimiteurs échappés (`\*`, `\_`, `\~`).
  - Calcul des états de couverture (`none`, `all`, `mixed`).
  - Normalisation des espaces lors du retrait partiel.
  - Préservation des attributs tiers sur les balises `<u>`.
  - Vérification de l'ordre de sérialisation lors des applications et suppressions successives.

---

## [0.5.0] - 2026-10-26

### Ajouts
- **Dimensionnement inline du texte (3 niveaux)** :
  - **Petite** : `0.85em` (`font-size: 0.85em;`).
  - **Normale** : retrait de `font-size` pour laisser le texte reprendre sa taille naturelle de contexte sans valeur fixe.
  - **Grande** : `1.25em` (`font-size: 1.25em;`).
- **Comportement non cumulatif** :
  - « Grande » est un état absolu et non une augmentation progressive. L'appliquer plusieurs fois conserve `1.25em`.
  - Passer de Grande à Petite remplace la valeur directement sans imbriquer de balises ni multiplier les facteurs.
- **Justification de l'unité `em` et adaptation au contexte** :
  - Choix d'une unité relative s'adaptant à la hiérarchie typographique (titres `#` à `######`, listes, callouts, texte courant).
  - Clarification documentaire : correction de l'affirmation antérieure selon laquelle les pixels bloqueraient le zoom ; `em` est justifié par son adaptation au contexte typographique sans constituer une garantie universelle sur l'ensemble des thèmes.
- **Protection stricte de la structure Markdown** :
  - Préservation des marqueurs de titre (`#`), de liste (`-`, `*`, `1.`) et de cases à cocher (`- [ ]`, `- [x]`).
  - Si la sélection déborde sur ces marqueurs, ils restent exclus de la balise HTML. Si la sélection est restreinte uniquement au marqueur, l'action est refusée proprement sans altérer le document.
- **Sélections partielles et unifications de sélections mixtes** :
  - Modifier un mot au milieu d'un passage dimensionné préserve les mots adjacents.
  - Appliquer une taille à une sélection mixte applique la taille choisie de façon homogène.
  - En présence de plusieurs tailles dans la sélection, le popover indique l'état « Taille mixte » sans indiquer de bouton actif trompeur.
- **Intégration à la barre d'outils flottante contextuelle** :
  - Nouveau bouton **Taille du texte** (`lucide-type`).
  - Popover dédié présentant Petite, Normale et Grande, avec raccourcis clavier et navigation identique aux autres menus.
  - Recalcul de position immédiat après modification de taille pour compenser la géométrie du texte.
  - Conservation de la sélection active après modification pour permettre l'enchaînement fluide des styles.
- **Commandes dédiées** :
  - `Inkwell: Choose text size...` (`choose-text-size`) ouvrant un menu de sélection (`FuzzySuggestModal`).
  - `Inkwell: Set text size to Small` (`set-size-small`).
  - `Inkwell: Set text size to Normal` (`set-size-normal`).
  - `Inkwell: Set text size to Large` (`set-size-large`).
- **Suppression granulaire et globale** :
  - Retirer la couleur ou le surlignage préserve la taille du texte.
  - `Inkwell: Clear all styles` (`clear-all-styles`) supprime simultanément couleur, surlignage et taille en une seule passe, tout en préservant le Markdown externe.

### Validation & Tests
- **Validation typographique en conditions réelles (Obsidian)** :
  - Mesure des tailles calculées en Aperçu en direct et en mode Lecture : le widget `.cm-html-embed` maintient la continuité du contexte typographique du titre parent (ex. H1 de 25.888px dimensionné à 32.36px pour 1.25em).
- **Tests unitaires automatisés (71 tests dans `npm test`)** :
  - Non-cumulativité des états.
  - Remplacement direct et suppression granulaire.
  - Combinaison des trois styles dans une balise unique avec `data-inkwell="1"`.
  - Protection des préfixes Markdown (titres, listes, tâches).
  - Délimiteurs gras/italique préservés à l'extérieur.
  - Définition exacte des trois options.

---

## [0.4.0] - 2026-10-26

### Ajouts
- **Barre d'outils contextuelle à la sélection (Live Preview)** :
  - Apparition automatique à la sélection de texte en aperçu en direct (jamais en mode lecture ni en mode source brut).
  - 5 actions avec icônes natives Obsidian (`lucide-palette`, `lucide-highlighter`, `lucide-eraser`, `lucide-brush-cleaning`, `lucide-remove-formatting`).
  - Infobulle native (`setTooltip`) et nom accessible (`aria-label`) pour chaque bouton.
  - Popovers de sélection de couleur (8 pastilles) et de surlignage (5 pastilles) avec pastilles de 16px visuellement intégrées dans une zone cliquable espacée de 28×28px.
- **Enchaînement fluide des styles** :
  - Maintien immédiat de la sélection active sur le texte nouvellement stylé après application pour permettre d'enchaîner directement couleur $\rightarrow$ surlignage $\rightarrow$ retrait.
- **Gestion stricte des sélections non prises en charge** :
  - Sélection multiligne : la barre ne s'affiche pas pour préserver la structure Markdown.
  - Sélection chevauchant un lien : boutons désactivés avec infobulle explicative (*« Les liens ne peuvent pas être modifiés par Inkwell. »*).
  - Sélection chevauchant un span non marqué : boutons désactivés avec infobulle invitant à l'adoption (*« Cette sélection chevauche une balise HTML non gérée. Utilisez la commande d’adoption. »*). Aucune adoption automatique depuis la barre.
- **Accessibilité et navigation au clavier** :
  - Commande dédiée : `Inkwell: Focus floating toolbar` (`focus-floating-toolbar`) pour donner le focus au clavier sans voler le focus à l'apparition.
  - Navigation par flèches Gauche/Droite entre les boutons (`roving tabindex`).
  - Validation par Entrée / Espace.
  - Navigation directionnelle dans les palettes de pastilles avec focus visible.
  - Touche Échap : ferme d'abord le popover et rend le focus au bouton déclencheur ; un second Échap masque la barre et rend le focus à l'éditeur. La barre reste masquée pour la sélection courante jusqu'à ce que la sélection change.
- **Positionnement et confinement** :
  - Calcul dynamique au-dessus (ou au-dessous si l'espace manque) avec centrage horizontal et confinement strict dans la zone visible de l'éditeur et de la fenêtre.
  - Prise en charge des lignes uniques visuellement repliées (*visual wrapping*).
  - Recalcul de position au défilement et au redimensionnement.
- **Réglages et cycle de vie** :
  - Réglage toggle *Barre d'outils à la sélection* (activée par défaut), à effet immédiat sans rechargement.
  - Nettoyage complet du DOM, des popovers et des écouteurs à la désactivation du plugin.

### Validation & Tests
- **Validation utilisateur confirmée** : bon fonctionnement de la barre d'outils flottante dans l'utilisation réelle de l'utilisateur (apparition à la sélection en Aperçu en direct et application des actions).
- **Tests unitaires automatisés (49 tests dans `npm test`)** : validation des calculs de positionnement géométrique, serrage aux marges visibles de la fenêtre, logique de confinement, cycle de vie et sanitization du réglage `toolbarEnabled`, et détection des balises non marquées.
- **Interactions simulées par script dans Obsidian** : test de l'enchaînement des 5 boutons, fermeture du popover au clic extérieur, navigation Échap à deux niveaux et commande de focus clavier.

---

## [0.3.0] - 2026-10-26

### Ajouts
- **Surlignage de texte translucide** (5 teintes pastel avec canal alpha 0.35) :
  - Jaune (`rgba(255, 212, 59, 0.35)`), Vert (`rgba(81, 207, 102, 0.35)`), Bleu (`rgba(77, 171, 247, 0.35)`), Rose (`rgba(240, 101, 149, 0.35)`), Orange (`rgba(255, 146, 43, 0.35)`).
  - Teintes translucides adaptées à la fois aux thèmes clairs (fond pastel doux) et sombres (s'assombrit naturellement pour laisser ressortir le texte clair du thème sans altérer silencieusement la couleur du texte).
- **Menu FuzzySuggestModal pour le surlignage** (`Inkwell: Choose highlight color...`, ID : `choose-text-highlight`).
- **Commande rapide de surlignage** (`Inkwell: Apply default highlight`, ID : `apply-text-highlight`).
- **Suppression granulaire** :
  - `Inkwell: Remove highlight` (ID : `remove-text-highlight`) : retire uniquement le surlignage en conservant la couleur de texte.
  - `Inkwell: Remove text color` : retire la couleur en conservant le surlignage.
- **Suppression globale propre** (`Inkwell: Clear all styles`, ID : `clear-all-styles`) :
  - Retire simultanément couleur et surlignage, supprime le marqueur `data-inkwell` et élimine complètement la balise `<span>` s'il ne reste aucun autre attribut ou style utile.
  - Préserve strictement le Markdown externe (gras, italique, etc.) et les attributs tiers.
- **Marqueur explicite de gestion** (`data-inkwell="1"`) :
  - Ajouté systématiquement sur tous les nouveaux spans créés par Inkwell.
  - Sert de repère explicite de gestion sans modifier le rendu visuel.
- **Protection stricte des balises non marquées** :
  - Refus de modification ou d'imbrication sur les balises HTML sans `data-inkwell="1"` afin de protéger le HTML saisi manuellement ou généré par d'autres plugins.
- **Commande d'adoption sécurisée** (`Inkwell: Adopt legacy formatting in selection or note...`, ID : `adopt-legacy-formatting`) :
  - Détecte les spans historiques sans marqueur dans la sélection (ou dans la note active).
  - Affiche le décompte exact et le périmètre, rappelle que l'origine exacte ne peut être prouvée avec certitude, et requiert une confirmation explicite via modale dédiée.
  - Exclut rigoureusement les exemples de balises situés dans les blocs de code (` ``` `) et le code en ligne (`` `...` ``).
  - Exécution en une transaction unique réversible d'un seul **Undo** (`Cmd + Z`).
- **Évolution des réglages** :
  - Ajout du réglage du surlignage par défaut (avec pastille de prévisualisation).
  - Bouton de réinitialisation réinitialisant texte et surlignage par défaut sans toucher aux notes.
  - Préservation intégrale de la couleur de texte par défaut configurée en V0.2 lors de la montée de version.
- **Correctif sélection Live Preview** :
  - Intégration de `EmbedSelectionTracker` dans la commande d'adoption afin de capturer fidèlement les sélections réalisées à la souris à l'intérieur des widgets HTML en Live Preview, ciblant ainsi la sélection sans basculer indûment sur toute la note.

### Tests & Validation
- **Tests unitaires automatisés** : 33 tests (`node:test`) couvrant la combinaison en balise unique, la préservation mutuelle des styles, la suppression granulaire, la protection des spans non marqués, l'exclusion du code et la migration des réglages.
- **Vérifications réelles dans Obsidian** :
  - Application du surlignage, combinaison avec la couleur dans un `<span>` unique sans duplication.
  - Retrait partiel ou total validé.
  - Protection contre la modification des balises non marquées vérifiée dans l'éditeur.
  - Mesure des couleurs calculées dans le DOM Obsidian en thème clair et sombre.
- **Limites & Non garanti** :
  - Les calculs montrent que certaines combinaisons de texte sombre de la palette sur un surlignage assombri en thème sombre tombent sous 3:1 de contraste (**non conforme WCAG AA**).
  - Aucune correction silencieuse de couleur n'est imposée pour préserver la totale liberté de l'utilisateur.

---

## [0.2.0] - 2026-10-26

### Ajouts
- **Palette de 8 couleurs** : Rouge (`#e03131`), Orange (`#f08c00`), Jaune (`#fab005`), Vert (`#2f9e44`), Bleu (`#1971c2`), Turquoise (`#0ca678`), Violet (`#9c36b5`) et Gris (`#868e96`).
- **Menu FuzzySuggestModal** (`Inkwell: Choose text color...`, ID : `choose-text-color`) :
  - Recherche rapide et sélection au clavier ou à la souris.
  - Pastilles visuelles de prévisualisation pour chaque couleur.
  - Indicateur `(défaut)` sur la couleur actuellement configurée comme couleur par défaut.
- **Onglet de réglages** (**Paramètres → Options des plugins → Inkwell**) :
  - Choix de la couleur par défaut pour la commande rapide avec pastille dynamique.
  - Bouton **Rétablir par défaut** restaurant le Rouge sans modifier aucune note existante.
  - Tolérance aux pannes : assainissement des données chargées avec repli sur le rouge si une valeur est invalide ou manquante.
- **Sécurité et intégrité de la sélection** :
  - Capture préalable de la sélection avant la prise de focus du modal (compatible avec les widgets Live Preview).
  - Validation stricte avant toute écriture : vérification de l'éditeur, de la note active et du contenu de la ligne. Annulation sécurisée avec message clair si la sélection est devenue invalide ou si l'utilisateur change de note.
  - Fermeture du menu sans sélection : la note reste strictement inchangée.
  - Sans sélection, la commande rapide n'applique aucune modification.

### Modifications
- Commande rapide renommée en `Inkwell: Apply default text color` tout en conservant son identifiant `apply-text-color` pour préserver les raccourcis existants.

### Tests & Validation
- **Tests unitaires automatisés** : 21 tests (`node:test`) couvrant la sélection dans les widgets Live Preview, la préservation des délimiteurs Markdown, la normalisation des balises inversées V0.1 et la validation des réglages.
- **Tests réellement effectués dans Obsidian** :
  - Aucune modification sans sélection active.
  - Annulation propre lors de la fermeture du modal (`Escape` ou clic extérieur).
  - Application d'une couleur depuis le menu sans altérer la couleur par défaut enregistrée.
  - Détection de l'invalidation de sélection (changement de note ou modification concurrente du texte).
  - Modification de la couleur par défaut répercutée uniquement sur les applications futures.
  - Persistance de la couleur par défaut après fermeture et redémarrage complet d'Obsidian.
  - Rétablissement des réglages par défaut sans incidence sur les notes déjà formatées.
  - Lisibilité vérifiée sur les thèmes Obsidian clair et sombre par défaut.
- **Non garanti / Hors périmètre** :
  - Le contraste visuel n'est pas garanti sur l'ensemble des thèmes communautaires personnalisés (les couleurs utilisent des codes hexadécimaux fixes).
  - Les sélections multilignes et celles traversant des liens (`[[wikilinks]]` ou `[liens](url)`) demeurent refusées pour préserver l'intégrité de la syntaxe.
  - Pas de barre flottante, de surlignage ni de tailles/polices dans cette version.

---

## [0.1.0] - 2026-10-25

### Ajouts
- Coloration du texte sélectionné par balises HTML inline (`<span style="color: ...">`).
- Conservation des marqueurs Markdown (`**`, `*`) à l'extérieur des balises HTML.
- Extension d'affichage Live Preview assurant le maintien du gras et de l'italique sur le texte coloré.
- Commande de suppression de couleur avec support du curseur et de la sélection partielle.
- Commande de réparation des balises Markdown inversées historiques.
