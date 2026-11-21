# PSX

Bibliothèque et lecteur PlayStation 1 dans le navigateur, interface PlayTab Big Picture
(D:\PS2 RECOMP\PAGE_DESIGN.md), moteur EmulatorJS 4.2.3 + cœur PCSX-ReARMed (GPL-3.0).

- `index.html` : bibliothèque (manette, clavier, souris, tactile).
- `?ID` (ex. `?DRV`) : lance le jeu (`jeu.html?ID`).
- `jeux.js` : liste des jeux (une ligne par jeu, avec son BIOS).
- `lecteur.js` : écran titre, lancement, menu Pause, commandes, sauvegardes.
- `playtab.js` / `playtab.css` / `textes.js` : charte, focus, manette, 8 langues.
- `data/` : EmulatorJS + cœur pcsx_rearmed ; `fonts/` : Archivo, JetBrains Mono.

Aucun jeu ni BIOS dans ce dépôt (`bios/` est ignoré).
