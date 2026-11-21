// Liste des jeux PS1 disponibles.
// Pour ajouter un jeu : une ligne de plus.
//   id      : ce qu'on met dans l'URL (?id), initiales en capitales
//   serial  : identifiant du disque (volume ID, ex. SLES_01816) pour vérifier que le joueur charge le bon jeu
//   couleur : couleur de la carte dans le catalogue
//   bios    : fichier BIOS à utiliser pour ce jeu (dans bios/), chargé automatiquement
//   disque  : (optionnel) dossier du disque dans le dépôt GitHub PSX_DEPOT, ex. "DRV/chd/"
//             (le .chd du disque coupé en morceaux de 8 Mo 00000.bin… + disc.json). Le lecteur le lit par
//             tranches de 1 Mo pendant la partie (flux.js), jamais en entier ; le joueur n'a rien à fournir.
//   disques : (au lieu de disque) jeu à plusieurs disques, ex. ["FF7/disc1/", "FF7/disc2/", "FF7/disc3/"]
//             Sans ces champs, le joueur choisit son .bin au premier lancement (mémorisé ensuite).
//   jaquette: (optionnel) image du boîtier dans le dépôt PSX_DEPOT, ex. "DRV/cover.jpg" (jaquette IGDB du jeu PS1)
window.PSX_JEUX = [
	{ id: "SDW", titre: "Sheep, Dog 'n' Wolf", serial: "SLES_02895", annee: 2001, editeur: "Infogrames", genre: "Plates-formes", couleur: "#d9a21b", bios: "scph1001-us.bin", disque: "SDW/chd/", jaquette: "SDW/cover.jpg" },
	{ id: "DRV", titre: "Driver", serial: "SLES_01816", annee: 1999, editeur: "GT Interactive", genre: "Course / poursuite", couleur: "#b8322a", bios: "scph1001-us.bin", disque: "DRV/chd/", jaquette: "DRV/cover.jpg" },
	{ id: "CB1", titre: "Crash Bandicoot", serial: "SCES_00344", annee: 1996, editeur: "Sony Computer Entertainment", genre: "Plates-formes", couleur: "#e8731c", bios: "scph1001-us.bin", disque: "CB1/chd/", jaquette: "CB1/cover.jpg" },
	{ id: "CB2", titre: "Crash Bandicoot 2: Cortex Strikes Back", serial: "SCES_00967", annee: 1997, editeur: "Sony Computer Entertainment", genre: "Plates-formes", couleur: "#d4511e", bios: "scph1001-us.bin", disque: "CB2/chd/", jaquette: "CB2/cover.jpg" },
	{ id: "CB3", titre: "Crash Bandicoot 3: Warped", serial: "SCES_01420", annee: 1998, editeur: "Sony Computer Entertainment", genre: "Plates-formes", couleur: "#c23b22", bios: "scph1001-us.bin", disque: "CB3/chd/", jaquette: "CB3/cover.jpg" },
	{ id: "CBH", titre: "Crash Bash", serial: "SCUS_94570", annee: 2000, editeur: "Sony Computer Entertainment", genre: "Party / multijoueur", couleur: "#2f7fd1", bios: "scph1001-us.bin", disque: "CBH/chd/", jaquette: "CBH/cover.jpg" },
	{ id: "SYD", titre: "Spyro: Year of the Dragon", serial: "SCES_02835", annee: 2000, editeur: "Sony Computer Entertainment", genre: "Plates-formes", couleur: "#7a3fb5", bios: "scph1001-us.bin", disque: "SYD/chd/", jaquette: "SYD/cover.jpg" },
	{ id: "TR", titre: "Tomb Raider", serial: "SLES_00024", annee: 1996, editeur: "Eidos Interactive", genre: "Action / aventure", couleur: "#8a6a3b", bios: "scph1001-us.bin", disque: "TR/chd/", jaquette: "TR/cover.jpg" },
	{ id: "DC", titre: "Dino Crisis", serial: "SLES_02207", annee: 1999, editeur: "Capcom", genre: "Survival horror", couleur: "#4f7a2a", bios: "scph1001-us.bin", disque: "DC/chd/", jaquette: "DC/cover.jpg" },
	{ id: "YFM", titre: "Yu-Gi-Oh! Forbidden Memories", serial: "SLES_03947", annee: 2002, editeur: "Konami", genre: "Cartes / stratégie", couleur: "#b08a1e", bios: "scph1001-us.bin", disque: "YFM/chd/", jaquette: "YFM/cover.jpg" }
];

// Bump with the ?v= stamps in index.html and jeu.html whenever a site or patched EmulatorJS file changes.
window.PSX_VERSION = "20261121f";

// PS1 disc repo: one folder per game (its initials), read straight from GitHub (CORS allowed).
window.PSX_DEPOT = "https://raw.githubusercontent.com/AlkanoidX/ps1/main/";

// BIOS PS1 posés sur le serveur dans bios/ (512 Ko chacun).
// Chaque jeu note son BIOS (champ bios) ; il est chargé automatiquement. Sans champ : BIOS de sa région.
// Les autres servent de secours si le fichier manque. Aucun BIOS : BIOS simulé du cœur (moins compatible).
// Testés : scph1001-us = le plus compatible (Driver OK) ; scph7502-eu = écran noir sur Driver.
window.PSX_DOSSIER_BIOS = "bios/";
window.PSX_BIOS_REGION = { EU: "scph1001-us.bin", US: "scph1001-us.bin", JP: "scph5500-jp.bin" };
window.PSX_BIOS_SECOURS = ["scph1001-us.bin", "scph7003.bin", "scph7502-eu.bin", "scph5500-jp.bin"];

window.PSX_regionDuJeu = function (jeu) {
	var p = jeu.serial.slice(0, 4);
	if (/^S[CL]E[SD]$/.test(p)) return "EU";
	if (/^S[CILP]P[SM]$/.test(p)) return "JP";
	return "US";
};

// Chemins des BIOS à essayer pour ce jeu, dans l'ordre.
window.PSX_biosDuJeu = function (jeu) {
	var noms = [jeu.bios || PSX_BIOS_REGION[PSX_regionDuJeu(jeu)]].concat(PSX_BIOS_SECOURS);
	return noms.filter(function (n, i) { return noms.indexOf(n) === i; }).map(function (n) { return PSX_DOSSIER_BIOS + n; });
};

window.PSX_trouverJeu = function (id) {
	id = String(id || "").toUpperCase();
	for (var i = 0; i < window.PSX_JEUX.length; i++) if (window.PSX_JEUX[i].id === id) return window.PSX_JEUX[i];
	return null;
};

window.PSX_jeuParSerial = function (serial) {
	for (var i = 0; i < window.PSX_JEUX.length; i++) if (window.PSX_JEUX[i].serial === serial) return window.PSX_JEUX[i];
	return null;
};

// Boîtier du jeu : la jaquette si elle existe, sinon un boîtier généré (couleur + titre).
window.PSX_boitier = function (jeu) {
	var el = document.createElement("div");
	el.className = "boitier-jeu";
	el.style.setProperty("--couleur", jeu.couleur);
	if (jeu.jaquette) {
		var img = document.createElement("img");
		img.src = new URL(jeu.jaquette, PSX_DEPOT).href; img.alt = jeu.titre; img.loading = "lazy";
		el.appendChild(img);
	} else {
		var t = document.createElement("span");
		t.className = "boitier-titre"; t.textContent = jeu.titre;
		var s = document.createElement("span");
		s.className = "boitier-serial"; s.textContent = jeu.serial.replace("_", "-");
		el.appendChild(t); el.appendChild(s);
	}
	return el;
};

// "?DRV" ou "?jeu=DRV"
window.PSX_idDansUrl = function () {
	var q = location.search.replace(/^\?/, "");
	if (!q) return "";
	var m = q.match(/(?:^|&)jeu=([^&]+)/i);
	if (m) return decodeURIComponent(m[1]).toUpperCase();
	var premier = q.split("&")[0];
	return premier.indexOf("=") < 0 ? decodeURIComponent(premier).toUpperCase() : ""; // ?lang=fr n'est pas un jeu
};
