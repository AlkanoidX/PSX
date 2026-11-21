// Liste des jeux PS1 disponibles.
// Pour ajouter un jeu : une ligne de plus.
//   id      : ce qu'on met dans l'URL (?id), initiales en capitales
//   serial  : identifiant du disque (volume ID, ex. SLES_01816) pour vérifier que le joueur charge le bon jeu
//   couleur : couleur de la carte dans le catalogue
//   jaquette: (optionnel) chemin d'une image dans le dossier, ex. "jaquettes/DRV.jpg"
window.PSX_JEUX = [
	{ id: "SDW", titre: "Sheep, Dog 'n' Wolf", serial: "SLES_02895", annee: 2001, editeur: "Infogrames", genre: "Plates-formes", couleur: "#d9a21b" },
	{ id: "DRV", titre: "Driver", serial: "SLES_01816", annee: 1999, editeur: "GT Interactive", genre: "Course / poursuite", couleur: "#b8322a" }
];

// BIOS PS1 sur le serveur (512 Ko, ex. SCPH-1001 / SCPH-5502). S'il est présent, il sert pour tous les jeux
// et le joueur n'a rien à fournir. Absent : PCSX-ReARMed utilise son BIOS simulé (moins compatible :
// Driver par exemple se bloque à « Checking MEMORY CARDS » sans vrai BIOS).
window.PSX_BIOS = "bios/scph5501.bin";

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
		img.src = jeu.jaquette; img.alt = jeu.titre; img.loading = "lazy";
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
	return decodeURIComponent(m ? m[1] : q.split("&")[0]).toUpperCase();
};
