// Lecteur PS1 PlayTab : écran titre → lancement → jeu, menu Pause unique, commandes, sauvegardes.
// Moteur : EmulatorJS (cœur PCSX-ReARMed), dont l'interface est entièrement masquée.
(function () {
	var $ = function (i) { return document.getElementById(i); };
	var jeu = PSX_trouverJeu(PSX_idDansUrl());
	if (!jeu) { location.replace("./"); return; }

	var params = new URLSearchParams(location.search);
	var DANS_IFRAME = window.top !== window.self;
	var TACTILE = matchMedia("(pointer: coarse)").matches;
	var TAILLE_BIOS = 512 * 1024, TAILLE_CARTE = 128 * 1024;
	var disque = null, bios = null, biosNom = "", emu = null, enJeu = false, menuOuvert = false;
	var distant = !!jeu.disque;   // disc folder in the GitHub repo (jeux.js): the player has nothing to provide
	var manifeste = null;         // its disc.json: { name, size, piece, pieces }
	function tailleMo() { return disque ? PT.nombre(disque.size / 1048576, 0) : "…"; }

	document.title = jeu.titre;
	$("titre").textContent = jeu.titre;
	if (jeu.titre.length > 18) $("titre").classList.add("long");
	$("menu-jeu").textContent = $("ctrl-jeu").textContent = jeu.titre;

	// ---------- Réglages mémorisés ----------
	function reglage(cle, defaut) { var v = PT.lire("psx-" + cle); return v === null ? defaut : v; }
	var volume = parseInt(reglage("volume", "80"), 10);
	var stats = reglage("stats", TACTILE ? "0" : "1") === "1";
	var typePad = reglage("padtype", "517");          // 517 = DualShock, 1 = manette standard
	var typePadLance = typePad;

	// ---------- Commandes (index RetroPad d'EmulatorJS) ----------
	var BOUTONS = [
		[0, "cross"], [8, "circle"], [1, "square"], [9, "triangle"], [10, "L1"], [11, "R1"], [12, "L2"], [13, "R2"], [14, "L3"], [15, "R3"],
		[2, "Select"], [3, "Start"], [4, "up"], [5, "down"], [6, "left"], [7, "right"],
		[19, "lsUp"], [18, "lsDown"], [17, "lsLeft"], [16, "lsRight"], [23, "rsUp"], [22, "rsDown"], [21, "rsLeft"], [20, "rsRight"]
	];
	var PAD = { 0: "BUTTON_1", 8: "BUTTON_2", 1: "BUTTON_3", 9: "BUTTON_4", 10: "LEFT_TOP_SHOULDER", 11: "RIGHT_TOP_SHOULDER",
		12: "LEFT_BOTTOM_SHOULDER", 13: "RIGHT_BOTTOM_SHOULDER", 14: "LEFT_STICK", 15: "RIGHT_STICK", 2: "SELECT", 3: "START",
		4: "DPAD_UP", 5: "DPAD_DOWN", 6: "DPAD_LEFT", 7: "DPAD_RIGHT",
		16: "LEFT_STICK_X:+1", 17: "LEFT_STICK_X:-1", 18: "LEFT_STICK_Y:+1", 19: "LEFT_STICK_Y:-1",
		20: "RIGHT_STICK_X:+1", 21: "RIGHT_STICK_X:-1", 22: "RIGHT_STICK_Y:+1", 23: "RIGHT_STICK_Y:-1" };
	// Clavier joueur 1 (PAGE_DESIGN 7.2) : codes de touches
	var CLAVIER = { 0: 90, 8: 88, 1: 65, 9: 83, 10: 81, 11: 87, 12: 49, 13: 50, 2: 8, 3: 13, 4: 38, 5: 40, 6: 37, 7: 39, 16: 76, 17: 74, 18: 75, 19: 73 };
	function commandesParDefaut() {
		var c = {};
		for (var p = 0; p < 4; p++) {
			c[p] = {};
			for (var i = 0; i < 30; i++) {
				if (PAD[i] === undefined) { c[p][i] = {}; continue; }
				c[p][i] = { value2: PAD[i] };
				if (p === 0 && CLAVIER[i] !== undefined) c[p][i].value = CLAVIER[i];
			}
		}
		return c;
	}
	function commandesMemorisees() { try { var c = JSON.parse(PT.lire("psx-controles")); if (c && c[0]) return c; } catch (e) {} return commandesParDefaut(); }
	var commandes = commandesMemorisees();
	function garderCommandes() { PT.ecrire("psx-controles", JSON.stringify(commandes)); if (emu) emu.controls = JSON.parse(JSON.stringify(commandes)); }

	// ---------- Écran titre ----------
	var lignesTitre = $("rows-titre");
	lignesTitre.appendChild(PT.reglage({ t: "language", valeurs: PT.LANGS.map(function (l) { return { v: l, l: PT.NOMS_LANGUES[l] }; }),
		get: function () { return PT.lang; }, set: function (v) { PT.changerLangue(v); } }));

	function texteCharge(cle, vars) { $("charge-txt").textContent = PT.t(cle, vars); }
	function erreur(txt) { $("aide-erreur").hidden = !txt; $("aide-erreur").textContent = txt || ""; }
	function boutonJouer(cle, actif) {
		var b = $("jouer"); b.setAttribute("data-t", cle); b.textContent = PT.t(cle); b.disabled = !actif;
	}
	function ecranTitre(depart) { PT.ecran({ racine: $("panel"), aide: ["change", "select"], depart: depart, start: function () { if (!$("jouer").disabled) $("jouer").click(); } }); }

	async function biosServeur() {
		var liste = PSX_biosDuJeu(jeu);
		for (var i = 0; i < liste.length; i++) {
			try {
				var r = await fetch(liste[i], { cache: "force-cache" });
				if (!r.ok) continue;
				var b = await r.blob();
				if (b.size === TAILLE_BIOS) { biosNom = liste[i].split("/").pop().replace(/\.bin$/i, ""); return b; }
			} catch (e) {}
		}
		return null;
	}

	async function preparer() {
		ecranTitre(lignesTitre.querySelector(".f"));
		texteCharge("preparing");
		// Le cœur et le BIOS se chargent pendant qu'on lit le disque mémorisé.
		var coeur = fetch("data/cores/pcsx_rearmed-wasm.data").catch(function () {});
		var b = biosServeur();
		if (distant) {
			try { manifeste = await (await fetch(dossierDistant() + "disc.json", { cache: "no-cache" })).json(); }
			catch (e) { bios = await b; $("charge").hidden = true; return erreur("disc.json: " + e); }
		}
		try { disque = await PSX_lireDisque(jeu.id); } catch (e) { disque = null; }
		// A remembered copy of a remote disc counts only if it is that exact disc.
		if (distant && disque && (disque.size !== manifeste.size || disque.name !== manifeste.name)) disque = null;
		bios = await b; await coeur;
		$("charge").hidden = true;
		if (!distant && !disque) return demanderDisque();
		boutonJouer("play", true);
		PT.focaliser($("jouer"));
	}

	function demanderDisque(msg) {
		$("charge").hidden = true;
		$("disque-aide").hidden = false;
		erreur(msg);
		boutonJouer("insertDisc", true);
		PT.focaliser($("jouer"));
	}

	$("jouer").addEventListener("click", function () {
		if ($("jouer").disabled) return;
		if (!distant && !disque) return $("f-disque").click();
		lancer();
	});

	$("f-disque").addEventListener("change", async function (e) {
		var f = e.target.files[0]; e.target.value = "";
		if (!f) return;
		erreur(""); $("charge").hidden = false; $("disque-aide").hidden = true; texteCharge("discChecking"); boutonJouer("loading", false);
		var serial = await PSX_serialDuDisque(f);
		if (serial !== jeu.serial) {
			var autre = PSX_jeuParSerial(serial);
			return demanderDisque(serial ? PT.t("discWrong", { found: autre ? autre.titre + " (" + serial + ")" : serial, game: jeu.titre }) : PT.t("discUnreadable"));
		}
		texteCharge("discSaving");
		await PSX_garderDisque(jeu.id, f);
		disque = f;
		$("charge").hidden = true;
		boutonJouer("play", true);
		PT.focaliser($("jouer"));
	});

	// ---------- Lancement ----------
	function etape(n, etat, detail) {
		var el = $("e" + n); el.className = "etape " + etat;
		if (detail !== undefined) $("e" + n + "d").textContent = detail;
	}

	// Remote disc: download its pieces (4 at a time), join them in order, remember the result.
	function dossierDistant() { return new URL(jeu.disque, PSX_DEPOT).href; }

	async function telechargerDisque() {
		var m = manifeste, morceaux = new Array(m.pieces), recus = 0, suivant = 0;
		var barre = $("e2b"), total = PT.nombre(m.size / 1048576, 0);
		barre.classList.remove("busy"); barre.hidden = false;
		function progres() {
			barre.firstElementChild.style.width = (100 * recus / m.pieces) + "%";
			$("e2d").textContent = PT.nombre(Math.min(recus * m.piece, m.size) / 1048576, 0) + " / " + PT.t("boot2d", { size: total });
		}
		async function morceau(i) {
			var url = dossierDistant() + String(i).padStart(5, "0") + ".bin";
			for (var essai = 0; ; essai++) {
				try {
					var r = await fetch(url);
					if (!r.ok) throw new Error(r.status + " " + url);
					var b = await r.blob();
					var attendu = i < m.pieces - 1 ? m.piece : m.size - m.piece * (m.pieces - 1);
					if (b.size !== attendu) throw new Error("size " + b.size + " " + url);
					return b;
				} catch (e) { if (essai >= 2) throw e; }
			}
		}
		async function ouvrier() {
			while (suivant < m.pieces) { var i = suivant++; morceaux[i] = await morceau(i); recus++; progres(); }
		}
		progres();
		await Promise.all([ouvrier(), ouvrier(), ouvrier(), ouvrier()]);
		barre.classList.add("busy");
		var f = new File(morceaux, m.name);
		await PSX_garderDisque(jeu.id, f);
		return f;
	}

	async function lancer() {
		PT.ecran(null);
		$("overlay").classList.add("parti");
		$("boot").hidden = false;
		etape(1, "encours", bios ? PT.t("boot1d", { bios: biosNom }) : PT.t("boot1dHle"));
		etape(2, "", disque ? PT.t("boot2d", { size: tailleMo() }) : "");
		etape(3, "", "");
		if (!disque) {
			etape(2, "encours");
			try { disque = await telechargerDisque(); } catch (e) { return arret("disc: " + e.message); }
		}
		var source = disque;

		window.EJS_player = "#game";
		window.EJS_core = "pcsx_rearmed";
		window.EJS_pathtodata = "data/";
		window.EJS_gameUrl = source;
		if (bios) window.EJS_biosUrl = new File([bios], "scph5501.bin"); // nom attendu par le cœur
		window.EJS_gameName = jeu.id;                // clé de la carte mémoire dans le navigateur
		window.EJS_startOnLoaded = true;
		window.EJS_threads = false;
		window.EJS_color = "#34e27f";
		window.EJS_backgroundColor = "#000000";
		window.EJS_volume = gain(volume);
		window.EJS_defaultControls = JSON.parse(JSON.stringify(commandes));
		window.EJS_disableLocalStorage = true;       // réglages et commandes gérés par cette page
		window.EJS_defaultOptions = { "save-save-interval": "30" };
		window.EJS_DEBUG_XX = true;                  // charge data/src/*.js (pas de build minifié)
		window.EJS_ready = function () {
			emu = window.EJS_emulator;
			// Type de manette (DualShock / standard), lu dans la config du cœur : "ready" arrive avant.
			var opts = emu.retroarchOpts;
			var extra = [1, 2, 3, 4].map(function (p) { return { title: "P" + p, name: "input_libretro_device_p" + p, options: { "517": "DualShock", "1": "Standard" }, default: typePad, isString: true }; });
			Object.defineProperty(emu, "retroarchOpts", { configurable: true, get: function () { return opts; }, set: function (v) { opts = (Array.isArray(v) ? v : []).concat(extra); } });
			// Pendant le menu, le jeu ne reçoit aucune entrée.
			var popup = emu.isPopupOpen.bind(emu);
			emu.isPopupOpen = function () { return menuOuvert || popup(); };
		};
		window.EJS_onGameStart = function () { etape(1, "fini"); etape(2, "fini"); etape(3, "encours"); };
		var s = document.createElement("script"); s.src = "data/loader.js"; document.body.appendChild(s);

		var debut = performance.now(), bon = 0, avant = 0, tAvant = debut;
		var suivi = setInterval(function () {
			var e = window.EJS_emulator;
			if (e && e.failedToStart) { clearInterval(suivi); return arret(e.textElem ? e.textElem.innerText : ""); }
			if (!e || !e.started || !e.gameManager) {
				if (e && e.gameManager) { etape(1, "fini"); etape(2, "encours"); $("e2b").hidden = false; }
				if (performance.now() - debut > 120000) { clearInterval(suivi); arret("timeout"); }
				return;
			}
			$("e2b").hidden = true;
			var n = e.gameManager.getFrameNum(), t = performance.now(), fps = (n - avant) * 1000 / (t - tAvant);
			avant = n; tAvant = t;
			etape(3, "encours", PT.t("boot3d", { n: n, fps: PT.nombre(fps, 0) }));
			bon = fps >= 40 ? bon + 1 : 0;
			if (bon >= 4 || t - debut > 60000) { clearInterval(suivi); demarre(); }
		}, 500);
	}

	function demarre() {
		enJeu = true;
		etape(3, "fini");
		$("boot").classList.add("parti");
		setTimeout(function () { $("boot").hidden = true; $("overlay").hidden = true; }, 400);
		$("menu-button").hidden = false;
		montrerStats();
		setTimeout(function () { PT.toast(PT.t("menuHint")); }, 1500);
		emu.setVolume(gain(volume));
	}

	function arret(raison) {
		menuOuvert = false;
		["menu", "controles", "boot"].forEach(function (i) { $(i).hidden = true; });
		$("halt").hidden = false;
		$("halt-raison").textContent = raison || "";
		PT.ecran({ racine: $("halt"), aide: ["select"], depart: $("recharger") });
	}
	$("recharger").addEventListener("click", function () { location.reload(); });

	// ---------- En jeu : ☰, compteur, pause automatique ----------
	var minuteurSouris;
	function reveiller() {
		if (!enJeu) return;
		$("menu-button").classList.remove("cache");
		clearTimeout(minuteurSouris);
		minuteurSouris = setTimeout(function () { $("menu-button").classList.add("cache"); }, 3000);
	}
	addEventListener("mousemove", reveiller); addEventListener("touchstart", reveiller, { passive: true });
	$("menu-button").addEventListener("click", function () { ouvrirMenu(); });

	var statsMinuteur, statsAvant = 0, statsT = 0;
	function montrerStats() {
		clearInterval(statsMinuteur);
		$("stats").hidden = !stats || !enJeu;
		if (!stats || !enJeu) return;
		statsMinuteur = setInterval(function () {
			if (!emu || !emu.gameManager || menuOuvert) return;
			var n = emu.gameManager.getFrameNum(), t = performance.now();
			var fps = statsT ? (n - statsAvant) * 1000 / (t - statsT) : 0;
			statsAvant = n; statsT = t;
			$("stats").textContent = "frame " + n + "   " + fps.toFixed(1) + " fps   " + (biosNom || "HLE BIOS") + "   pcsx_rearmed";
		}, 1000);
	}

	PT.surDemandeMenu(function () { if (enJeu && !menuOuvert) ouvrirMenu(); });
	function pauseAuto() { if (enJeu && !menuOuvert && !params.has("nopause")) ouvrirMenu(); }
	addEventListener("blur", pauseAuto);
	document.addEventListener("visibilitychange", function () { if (document.hidden) pauseAuto(); });
	addEventListener("pagehide", function () { try { emu && emu.gameManager && emu.gameManager.saveSaveFiles(); } catch (e) {} });

	// ---------- Menu Pause ----------
	function gain(v) { return Math.pow(v / 100, 2); }
	var liste = $("menu-liste");
	function titre(cle) { var h = document.createElement("h3"); h.setAttribute("data-t", cle); h.textContent = PT.t(cle); return h; }
	function bouton(cle, fn, principal) {
		var b = document.createElement("button");
		b.className = "btn is-wide f" + (principal ? " is-primary" : ""); b.tabIndex = -1;
		b.setAttribute("data-t", cle); b.textContent = PT.t(cle);
		b.addEventListener("click", fn); return b;
	}
	function telecharger(donnees, nom) {
		var a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([donnees])); a.download = nom;
		document.body.appendChild(a); a.click(); a.remove();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
	}
	function horodatage() { var d = new Date(), z = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()); }
	function dateLocale() { return new Date().toLocaleString(PT.lang === "pt" ? "pt-BR" : PT.lang, { dateStyle: "short", timeStyle: "short" }); }

	var cleEtat = "etat:" + jeu.id;
	function sauvegardeRapide() {
		PT.toast(PT.t("saving"));
		try {
			var etat = emu.gameManager.getState().slice();
			PSX_garderDisque(cleEtat, new Blob([etat])).then(function () { PT.toast(PT.t("saved", { date: dateLocale() })); });
		} catch (e) { PT.toast(PT.t("stateBad")); }
	}
	async function chargementRapide() {
		var b = null; try { b = await PSX_lireDisque(cleEtat); } catch (e) {}
		if (!b) return PT.toast(PT.t("noState"));
		PT.toast(PT.t("loadingState"));
		try { emu.gameManager.loadState(new Uint8Array(await b.arrayBuffer())); PT.toast(PT.t("stateLoaded")); fermerMenu(); }
		catch (e) { PT.toast(PT.t("stateBad")); }
	}
	async function exporterEtat() {
		var b = null; try { b = await PSX_lireDisque(cleEtat); } catch (e) {}
		if (!b) return PT.toast(PT.t("noState"));
		telecharger(b, jeu.id + "-quicksave-" + horodatage() + ".state");
	}
	$("f-etat").addEventListener("change", async function (e) {
		var f = e.target.files[0]; e.target.value = ""; if (!f) return;
		try {
			var d = new Uint8Array(await f.arrayBuffer());
			emu.gameManager.loadState(d);
			await PSX_garderDisque(cleEtat, new Blob([d]));
			PT.toast(PT.t("stateImported")); fermerMenu();
		} catch (err) { PT.toast(PT.t("stateBad")); }
	});
	function exporterCarte() {
		var c = null; try { c = emu.gameManager.getSaveFile(); } catch (e) {}
		if (!c || !c.length) return PT.toast(PT.t("noCard"));
		telecharger(c, jeu.id + "-carte-memoire.srm");
	}
	$("f-carte").addEventListener("change", async function (e) {
		var f = e.target.files[0]; e.target.value = ""; if (!f) return;
		if (f.size !== TAILLE_CARTE) return PT.toast(PT.t("cardBad"));
		var d = new Uint8Array(await f.arrayBuffer());
		if (!(d[0] === 0x4D && d[1] === 0x43)) return PT.toast(PT.t("cardBad")); // en-tête "MC"
		var gm = emu.gameManager;
		gm.FS.writeFile(gm.getSaveFilePath(), d);
		gm.loadSaveFiles();
		PT.toast(PT.t("cardImported"));
		gm.restart();
		setTimeout(function () { try { gm.saveSaveFiles(); } catch (e) {} }, 1500);
		fermerMenu();
	});
	function quitter(url) {
		try { emu.gameManager.saveSaveFiles(); } catch (e) {}
		var gm = emu && emu.gameManager;
		if (gm && gm.FS && gm.FS.syncfs) gm.FS.syncfs(false, function () { location.href = url; });
		else location.href = url;
		setTimeout(function () { location.href = url; }, 1500);
	}

	var ligneRelancer;
	function construireMenu() {
		liste.innerHTML = "";
		liste.appendChild(bouton("resume", fermerMenu, true));

		liste.appendChild(titre("display"));
		if (!DANS_IFRAME) liste.appendChild(PT.interrupteur({ t: "fullscreen", get: function () { return !!document.fullscreenElement; },
			set: function (v) { try { v ? document.documentElement.requestFullscreen() : document.exitFullscreen(); } catch (e) {} } }));
		liste.appendChild(PT.interrupteur({ t: "stats", get: function () { return stats; }, set: function (v) { stats = v; PT.ecrire("psx-stats", v ? "1" : "0"); montrerStats(); } }));
		liste.appendChild(PT.interrupteur({ t: "contrast", get: function () { return document.documentElement.classList.contains("contrast"); },
			set: function (v) { document.documentElement.classList.toggle("contrast", v); PT.ecrire("psx-contrast", v ? "1" : "0"); } }));
		liste.appendChild(PT.reglage({ t: "language", valeurs: PT.LANGS.map(function (l) { return { v: l, l: PT.NOMS_LANGUES[l] }; }),
			get: function () { return PT.lang; }, set: function (v) { PT.changerLangue(v); } }));

		liste.appendChild(titre("sound"));
		var vols = []; for (var v = 0; v <= 100; v += 10) vols.push({ v: v, l: v + " %" });
		liste.appendChild(PT.reglage({ t: "volume", valeurs: vols, get: function () { return volume; },
			set: function (v) { volume = v; PT.ecrire("psx-volume", String(v)); if (emu) emu.setVolume(gain(v)); } }));
		liste.appendChild(PT.reglage({ t: "padType", valeurs: [{ v: "517", l: function () { return PT.t("dualshock"); } }, { v: "1", l: function () { return PT.t("digital"); } }],
			get: function () { return typePad; }, set: function (v) { typePad = v; PT.ecrire("psx-padtype", v); ligneRelancer.hidden = typePad === typePadLance; } }));
		ligneRelancer = PT.ligne(function () { return PT.t("relaunch"); }, function () { quitter(location.href); });
		var pill = document.createElement("span"); pill.className = "pill"; pill.setAttribute("data-t", "newSetting"); pill.textContent = PT.t("newSetting");
		ligneRelancer.insertBefore(pill, ligneRelancer.querySelector(".lab").nextSibling);
		ligneRelancer.style.gridTemplateColumns = "1fr auto auto";
		ligneRelancer.hidden = true;
		liste.appendChild(ligneRelancer);
		liste.appendChild(PT.ligne("controls", ouvrirControles));

		liste.appendChild(titre("saves"));
		liste.appendChild(PT.ligne("quickSave", sauvegardeRapide));
		liste.appendChild(PT.ligne("quickLoad", chargementRapide));
		liste.appendChild(PT.ligne("exportState", exporterEtat));
		liste.appendChild(PT.ligne("importState", function () { $("f-etat").click(); }));

		liste.appendChild(titre("card"));
		liste.appendChild(PT.ligne("exportCard", exporterCarte));
		liste.appendChild(PT.ligne("importCard", function () { $("f-carte").click(); }));

		liste.appendChild(titre("game"));
		liste.appendChild(PT.ligne("catalog", function () { quitter("./"); }));
		liste.appendChild(PT.ligne("forgetDisc", function () { PSX_oublierDisque(jeu.id).then(function () { quitter(location.href); }); }));

		$("menu-info").textContent = [PT.t("boot2d", { size: tailleMo() }), "BIOS " + (biosNom || "HLE"), jeu.serial, "PCSX-ReARMed"].join(" · ");
	}

	function ouvrirMenu() {
		if (!emu || !emu.started) return;
		if (!liste.children.length) construireMenu();
		menuOuvert = true;
		try { emu.pause(); } catch (e) {}
		$("menu").hidden = false;
		$("menu-button").classList.add("cache");
		liste.querySelectorAll(".f").forEach(function (el) { if (el._dessiner) el._dessiner(); });
		PT.ecran({ racine: $("menu"), aide: ["change", "back", "select"], retour: fermerMenu, l3r3: fermerMenu, depart: liste.querySelector(".btn") });
	}
	function fermerMenu() {
		$("menu").hidden = true; $("controles").hidden = true;
		PT.ecran(null);
		// Un bouton encore enfoncé (le A qui a validé) n'arrive au jeu qu'une fois relâché : on attend la fin de l'appui.
		setTimeout(function () { menuOuvert = false; try { emu.play(); } catch (e) {} }, 120);
	}

	// ---------- Personnaliser les commandes ----------
	var joueur = 0, capture = null;
	var NOMS_PAD = { xbox: { BUTTON_1: "A", BUTTON_2: "B", BUTTON_3: "X", BUTTON_4: "Y", LEFT_TOP_SHOULDER: "LB", RIGHT_TOP_SHOULDER: "RB", LEFT_BOTTOM_SHOULDER: "LT", RIGHT_BOTTOM_SHOULDER: "RT", SELECT: "View", START: "Menu" },
		ps: { BUTTON_1: "✕", BUTTON_2: "○", BUTTON_3: "□", BUTTON_4: "△", LEFT_TOP_SHOULDER: "L1", RIGHT_TOP_SHOULDER: "R1", LEFT_BOTTOM_SHOULDER: "L2", RIGHT_BOTTOM_SHOULDER: "R2", SELECT: "Share", START: "Options" },
		commun: { LEFT_STICK: "L3", RIGHT_STICK: "R3", DPAD_UP: "↑", DPAD_DOWN: "↓", DPAD_LEFT: "←", DPAD_RIGHT: "→" } };
	function nomPad(v) {
		if (v === undefined || v === "") return "—";
		var t = PT.typeManette() === "ps" ? NOMS_PAD.ps : NOMS_PAD.xbox;
		if (t[v]) return t[v]; if (NOMS_PAD.commun[v]) return NOMS_PAD.commun[v];
		var m = String(v).match(/^(LEFT|RIGHT)_STICK_([XY]):([+-])1$/);
		if (m) return (m[1] === "LEFT" ? "LS " : "RS ") + (m[2] === "X" ? (m[3] === "+" ? "→" : "←") : (m[3] === "+" ? "↓" : "↑"));
		return String(v).replace(/^BUTTON_/, "#");
	}
	function nomTouche(code) {
		if (code === undefined || code === "" || code === 0) return "—";
		var n = emu && emu.keyMap && emu.keyMap[code];
		if (!n) return "#" + code;
		return n.replace(/ arrow$/, "").replace(/^./, function (c) { return c.toUpperCase(); });
	}
	function nomBouton(cle) { return /^[A-Z]/.test(cle) ? cle : PT.t(cle); }

	function construireControles() {
		var l = $("ctrl-liste"); l.innerHTML = "";
		l.appendChild(PT.reglage({ t: "player", valeurs: [0, 1, 2, 3].map(function (p) { return { v: p, l: String(p + 1) }; }),
			get: function () { return joueur; }, set: function (v) { joueur = v; dessinerControles(); } }));
		BOUTONS.forEach(function (b) {
			var r = PT.ligne(function () { return nomBouton(b[1]); }, function (el) { attendre(el, b[0]); }, function () {
				var c = commandes[joueur][b[0]] || {};
				return nomPad(c.value2) + "  ·  " + (joueur === 0 || c.value ? nomTouche(c.value) : "—");
			});
			r.classList.remove("act"); r.dataset.idx = b[0];
			l.appendChild(r);
		});
		l.appendChild(PT.ligne("resetControls", function () {
			commandes = commandesParDefaut(); garderCommandes();
			dessinerControles(); PT.toast(PT.t("controlsReset"));
		}));
		l.appendChild(bouton("back", fermerControles));
	}
	function dessinerControles() { $("ctrl-liste").querySelectorAll(".f").forEach(function (el) { if (el._dessiner) el._dessiner(); }); }
	function ouvrirControles() {
		if (!$("ctrl-liste").children.length) construireControles();
		$("menu").hidden = true; $("controles").hidden = false; $("capture-aide").textContent = "";
		dessinerControles();
		PT.ecran({ racine: $("controles"), aide: ["change", "back", "select"], retour: fermerControles, depart: $("ctrl-liste").querySelector(".f") });
	}
	function fermerControles() {
		finCapture();
		$("controles").hidden = true; $("menu").hidden = false;
		PT.ecran({ racine: $("menu"), aide: ["change", "back", "select"], retour: fermerMenu, l3r3: fermerMenu, depart: liste.querySelector('.row.act:not([hidden])') });
	}

	function etatPad(g) { return { b: g.buttons.map(function (x) { return x.pressed || x.value > .5; }), a: g.axes.slice() }; }
	function attendre(el, idx) {
		finCapture();
		var avant = {};
		el.classList.add("attente"); el.querySelector(".side").textContent = "…";
		$("capture-aide").textContent = PT.t("pressInput") + " " + PT.t("pressCancel");
		capture = { el: el, idx: idx, pret: false, minuteur: setTimeout(finCapture, 5000) };
		// L'appui qui a lancé l'attente (Entrée, A) ne compte pas : on arme un peu après.
		setTimeout(function () { if (capture) capture.pret = true; }, 250);
		PT.capture = true;
		// Touches déjà enfoncées (le A qui a validé) ignorées jusqu'au relâchement.
		Array.prototype.forEach.call(navigator.getGamepads ? navigator.getGamepads() : [], function (g) { if (g) avant[g.index] = etatPad(g); });
		capture.avant = avant;
		PT.surManetteBrute = function (g) {
			if (!capture) return;
			var a = capture.avant[g.index], n = etatPad(g);
			if (!capture.pret) { capture.avant[g.index] = n; return; }
			if (!a) { capture.avant[g.index] = n; return; }
			for (var i = 0; i < n.b.length; i++) {
				if (n.b[i] && !a.b[i]) {
					var noms = ["BUTTON_1", "BUTTON_2", "BUTTON_3", "BUTTON_4", "LEFT_TOP_SHOULDER", "RIGHT_TOP_SHOULDER", "LEFT_BOTTOM_SHOULDER", "RIGHT_BOTTOM_SHOULDER", "SELECT", "START", "LEFT_STICK", "RIGHT_STICK", "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT"];
					return affecter({ value2: noms[i] || ("BUTTON_" + (i + 1)) });
				}
				if (!n.b[i]) a.b[i] = false;
			}
			for (var k = 0; k < Math.min(4, n.a.length); k++) {
				if (Math.abs(n.a[k]) > .6 && Math.abs(a.a[k] || 0) < .3) {
					var axe = ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"][k];
					return affecter({ value2: axe + ":" + (n.a[k] > 0 ? "+1" : "-1") });
				}
				if (Math.abs(n.a[k]) < .3) a.a[k] = 0;
			}
		};
	}
	function touchePendantCapture(e) {
		if (!capture) return;
		e.preventDefault(); e.stopPropagation();
		if (e.repeat || !capture.pret) return;
		if (e.key === "Escape") return finCapture();
		affecter({ value: e.keyCode });
	}
	addEventListener("keydown", touchePendantCapture, true);
	function affecter(o) {
		var c = commandes[joueur][capture.idx] || (commandes[joueur][capture.idx] = {});
		if (o.value !== undefined) c.value = o.value;
		if (o.value2 !== undefined) c.value2 = o.value2;
		garderCommandes();
		var el = capture.el;
		finCapture();
		PT.focaliser(el);
	}
	function finCapture() {
		if (!capture) return;
		clearTimeout(capture.minuteur);
		capture.el.classList.remove("attente");
		capture = null;
		PT.surManetteBrute = null;
		$("capture-aide").textContent = "";
		dessinerControles();
		// Laisse passer le relâchement de la touche avant de rendre la main à la navigation.
		setTimeout(function () { PT.capture = false; }, 200);
	}

	PT.surLangue(function () { document.title = jeu.titre; if (liste.children.length) $("menu-info").textContent = [PT.t("boot2d", { size: tailleMo() }), "BIOS " + (biosNom || "HLE"), jeu.serial, "PCSX-ReARMed"].join(" · "); });

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", preparer); else preparer();
})();
