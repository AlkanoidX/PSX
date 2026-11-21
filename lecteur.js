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
	// Disc folders in the GitHub repo (jeux.js "disque", or "disques" for a multi-disc game): streamed by chunks (flux.js),
	// the player has nothing to provide. Without them, the player's own .bin (kept in IndexedDB, disques.js).
	var dossiers = jeu.disques || (jeu.disque ? [jeu.disque] : []);
	var distant = dossiers.length > 0;
	var manifestes = [];          // disc.json of each disc: { name, size, piece, pieces }
	var flux = [];                // their streams, made at launch
	var premium = false;          // PlayTab Premium (asked to PlayTab's player frame): fast forward and rewind
	function tailleMo() {
		var o = distant ? manifestes.reduce(function (t, m) { return t + m.size; }, 0) : disque ? disque.size : 0;
		return o ? PT.nombre(o / 1048576, 0) : "…";
	}

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
	var filtre = reglage("filtre", "disabled");       // EmulatorJS shader (data/src/shaders.js) or "disabled"
	var vitesse = reglage("vitesse", "3.0");          // fast forward ratio (Premium)

	// ---------- Commandes (index RetroPad d'EmulatorJS) ----------
	var BOUTONS = [
		[0, "cross"], [8, "circle"], [1, "square"], [9, "triangle"], [10, "L1"], [11, "R1"], [12, "L2"], [13, "R2"], [14, "L3"], [15, "R3"],
		[2, "Select"], [3, "Start"], [4, "up"], [5, "down"], [6, "left"], [7, "right"],
		[19, "lsUp"], [18, "lsDown"], [17, "lsLeft"], [16, "lsRight"], [23, "rsUp"], [22, "rsDown"], [21, "rsLeft"], [20, "rsRight"],
		[27, "fastForward"], [28, "rewind"]   // held down; PlayTab Premium only
	];
	var PREMIUM_BOUTONS = [27, 28];
	var PAD = { 0: "BUTTON_1", 8: "BUTTON_2", 1: "BUTTON_3", 9: "BUTTON_4", 10: "LEFT_TOP_SHOULDER", 11: "RIGHT_TOP_SHOULDER",
		12: "LEFT_BOTTOM_SHOULDER", 13: "RIGHT_BOTTOM_SHOULDER", 14: "LEFT_STICK", 15: "RIGHT_STICK", 2: "SELECT", 3: "START",
		4: "DPAD_UP", 5: "DPAD_DOWN", 6: "DPAD_LEFT", 7: "DPAD_RIGHT",
		16: "LEFT_STICK_X:+1", 17: "LEFT_STICK_X:-1", 18: "LEFT_STICK_Y:+1", 19: "LEFT_STICK_Y:-1",
		20: "RIGHT_STICK_X:+1", 21: "RIGHT_STICK_X:-1", 22: "RIGHT_STICK_Y:+1", 23: "RIGHT_STICK_Y:-1" };
	// Clavier joueur 1 (PAGE_DESIGN 7.2) : codes de touches
	var CLAVIER = { 0: 90, 8: 88, 1: 65, 9: 83, 10: 81, 11: 87, 12: 49, 13: 50, 2: 8, 3: 13, 4: 38, 5: 40, 6: 37, 7: 39, 16: 76, 17: 74, 18: 75, 19: 73, 27: 69, 28: 82 };
	function commandesParDefaut() {
		var c = {};
		for (var p = 0; p < 4; p++) {
			c[p] = {};
			for (var i = 0; i < 30; i++) {
				if (PAD[i] === undefined) { c[p][i] = p === 0 && CLAVIER[i] !== undefined ? { value: CLAVIER[i] } : {}; continue; }
				c[p][i] = { value2: PAD[i] };
				if (p === 0 && CLAVIER[i] !== undefined) c[p][i].value = CLAVIER[i];
			}
		}
		return c;
	}
	function commandesMemorisees() {
		try {
			var c = JSON.parse(PT.lire("psx-controles"));
			if (c && c[0]) {
				// Controls saved before fast forward / rewind existed get their default keys.
				var d = commandesParDefaut();
				PREMIUM_BOUTONS.forEach(function (i) { var k = c[0][i]; if (!k || (k.value === undefined && k.value2 === undefined)) c[0][i] = d[0][i]; });
				return c;
			}
		} catch (e) {}
		return commandesParDefaut();
	}
	var commandes = commandesMemorisees();
	// What EmulatorJS gets: without Premium, fast forward and rewind have no key.
	function commandesJeu() {
		var c = JSON.parse(JSON.stringify(commandes));
		if (!premium) for (var p in c) PREMIUM_BOUTONS.forEach(function (i) { c[p][i] = {}; });
		return c;
	}
	function garderCommandes() { PT.ecrire("psx-controles", JSON.stringify(commandes)); if (emu) emu.controls = commandesJeu(); }

	// ---------- PlayTab Premium (same exchange as the PS2 / PSP pages' cloud save) ----------
	// The page never sees the account: PlayTab's player frame answers { pt: "cloud-state", on, premium }. Outside PlayTab: no Premium.
	var CADRE = window.parent !== window ? window.parent : null;
	function cadreOk(o) { return o === "https://bigpicture.playtab.fun" || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o); }
	var premiumPret = new Promise(function (ok) {
		if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && params.get("premium") === "1") return ok(true);   // local tests only
		if (!CADRE) return ok(false);
		function reponse(e) {
			var d = e.data;
			if (e.source === CADRE && cadreOk(e.origin) && d && d.pt === "cloud-state") { removeEventListener("message", reponse); ok(!!(d.on && d.premium)); }
		}
		addEventListener("message", reponse);
		try { CADRE.postMessage({ pt: "cloud-hello" }, "*"); } catch (e) { ok(false); }
		setTimeout(function () { removeEventListener("message", reponse); ok(false); }, 5000);
	});
	function ouvrirPremium() {
		if (CADRE) { try { CADRE.postMessage({ pt: "cloud-premium" }, "*"); return; } catch (e) {} }
		var l = PT.lang, u = "https://bigpicture.playtab.fun" + (["fr", "es", "de", "it", "pt", "pl", "tr"].indexOf(l) >= 0 ? "/" + l : "") + "/settings?s=premium";
		window.open(u, "_blank", "noopener");
	}

	// Keys chosen by the player in Big Picture (pt-input.js, shared with the PS2 / PSP / Xbox pages): it turns them into this
	// page's keys (Z = cross, I J K L = stick…, same table). activeLayer tells it when a menu is open (keys left alone).
	window.activeLayer = function () { return !enJeu || menuOuvert ? "menu" : ""; };
	if (DANS_IFRAME) { var pti = document.createElement("script"); pti.src = "/pt-cloud/pt-input.js?v=20261120"; pti.async = true; document.head.appendChild(pti); }

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
		var pret = fetch("data/cores/pcsx_rearmed-wasm.data").catch(function () {});
		var b = biosServeur();
		if (distant) {
			try {
				manifestes = await Promise.all(dossiers.map(function (d) {
					return fetch(dossierDistant(d) + "disc.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
				}));
			} catch (e) { bios = await b; $("charge").hidden = true; return erreur("disc.json: " + e); }
			// Whole discs kept by the older page (IndexedDB) and EmulatorJS's own copies: the disc is now streamed.
			PSX_oublierDisque(jeu.id).catch(function () {});
			try { indexedDB.deleteDatabase("EmulatorJS-roms"); } catch (e) {}
		} else {
			try { disque = await PSX_lireDisque(jeu.id); } catch (e) { disque = null; }
		}
		premium = await premiumPret;
		bios = await b; await pret;
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

	// Disc folder in the repo (an absolute address, e.g. a second repo, is taken as is).
	function dossierDistant(d) { return new URL(d, PSX_DEPOT).href; }

	async function lancer() {
		PT.ecran(null);
		$("overlay").classList.add("parti");
		$("boot").hidden = false;
		etape(1, "encours", bios ? PT.t("boot1d", { bios: biosNom }) : PT.t("boot1dHle"));
		etape(2, "", PT.t(distant ? "boot2s" : "boot2d", { size: tailleMo() }));
		etape(3, "", "");
		if (distant) {
			// The disc is read by chunks while playing; only its first chunks are fetched before the start.
			etape(2, "encours");
			flux = manifestes.map(function (m, i) { return PSX_flux(dossierDistant(dossiers[i]), m); });
			var barre = $("e2b"), premiers = 8;
			barre.classList.remove("busy"); barre.hidden = false;
			flux[0].surProgres = function (f) { barre.firstElementChild.style.width = Math.min(100, 100 * f.lus / premiers) + "%"; };
			await flux[0].prechauffer(premiers);
			flux[0].surProgres = null;
			barre.classList.add("busy");
			var noms = flux.map(function (f, i) { return jeu.id + (flux.length > 1 ? "-" + (i + 1) : "") + ".bin"; });
			window.EJS_gameStream = function (FS) {
				flux.forEach(function (f, i) { PSX_fichierFlux(FS, "/" + noms[i], f); });
				if (flux.length === 1) return noms[0];
				FS.writeFile("/" + jeu.id + ".m3u", noms.join("\n"));   // multi-disc: the core switches discs from this list
				return jeu.id + ".m3u";
			};
			window.EJS_gameUrl = flux.length > 1 ? jeu.id + ".m3u" : noms[0];
		} else window.EJS_gameUrl = disque;

		window.EJS_player = "#game";
		window.EJS_core = "pcsx_rearmed";
		window.EJS_pathtodata = "data/";
		if (bios) window.EJS_biosUrl = new File([bios], "scph5501.bin"); // nom attendu par le cœur
		window.EJS_gameName = jeu.id;                // clé de la carte mémoire dans le navigateur
		window.EJS_startOnLoaded = true;
		window.EJS_threads = false;
		window.EJS_color = "#34e27f";
		window.EJS_backgroundColor = "#000000";
		window.EJS_volume = gain(volume);
		window.EJS_defaultControls = commandesJeu();
		window.EJS_disableLocalStorage = true;       // réglages et commandes gérés par cette page
		window.EJS_disableDatabases = true;          // no copy of the disc / BIOS / core in EmulatorJS's IndexedDB
		window.EJS_defaultOptions = { "save-save-interval": "30", "shader": filtre, "ff-ratio": vitesse,
			"rewindEnabled": premium ? "enabled" : "disabled", "rewind-granularity": "2" };
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
		// Version stamp on files we patch, so the Cloudflare cache in front of the FTP serves the new ones.
		window.EJS_paths = { "emulator.js": "data/src/emulator.js?v=" + PSX_VERSION, "GameManager.js": "data/src/GameManager.js?v=" + PSX_VERSION };
		var s = document.createElement("script"); s.src = "data/loader.js?v=" + PSX_VERSION; document.body.appendChild(s);

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
			var d = flux.reduce(function (t, f) { return t + f.lus; }, 0), w = flux.reduce(function (t, f) { return t + f.attentes; }, 0);
			$("stats").textContent = "frame " + n + "   " + fps.toFixed(1) + " fps   " + (biosNom || "HLE BIOS") + "   pcsx_rearmed" + (flux.length ? "   disc " + d + " MB" + (w ? " (" + w + " waits)" : "") : "");
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
		// Screen filters (EmulatorJS shaders): ScaleHQ smoothing 2x / 4x, CRT looks.
		liste.appendChild(PT.reglage({ t: "filter", valeurs: [["disabled", "fNone"], ["2xScaleHQ.glslp", "fSmooth2"], ["4xScaleHQ.glslp", "fSmooth4"],
			["crt-easymode.glslp", "fCrt"], ["crt-aperture.glslp", "fCrtSharp"], ["crt-geom.glslp", "fCrtCurved"]].map(function (f) { return { v: f[0], l: function () { return PT.t(f[1]); } }; }),
			get: function () { return filtre; }, set: function (v) { filtre = v; PT.ecrire("psx-filtre", v); try { emu.changeSettingOption("shader", v); } catch (e) {} } }));

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

		// PlayTab Premium: fast forward and rewind (keys in Customize controls, E / R by default, held down)
		var tp = titre("premiumTitle"); tp.classList.add("premium"); liste.appendChild(tp);
		if (premium) {
			liste.appendChild(PT.reglage({ t: "ffSpeed", valeurs: ["2.0", "3.0", "4.0"].map(function (v) { return { v: v, l: "×" + parseInt(v, 10) }; }),
				get: function () { return vitesse; }, set: function (v) { vitesse = v; PT.ecrire("psx-vitesse", v); try { emu.changeSettingOption("ff-ratio", v); } catch (e) {} } }));
			liste.appendChild(PT.ligne("speedKeys", ouvrirControles, function () { return nomsTouches(27) + "  ·  " + nomsTouches(28); }));
		} else {
			var lp = PT.ligne("premiumPitch", ouvrirPremium, function () { return "Premium"; });
			lp.classList.add("premium"); liste.appendChild(lp);
		}

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
		if (flux.length > 1) liste.appendChild(PT.reglage({ t: "disc", valeurs: flux.map(function (f, i) { return { v: i, l: function () { return PT.t("discN", { n: i + 1 }); } }; }),
			get: function () { try { return emu.gameManager.getCurrentDisk(); } catch (e) { return 0; } },
			set: function (v) { try { emu.gameManager.setCurrentDisk(v); PT.toast(PT.t("discN", { n: v + 1 })); } catch (e) {} } }));
		if (distant) liste.appendChild(PT.ligne("freeThis", function () {
			Promise.all(manifestes.map(function (m, i) { return caches.delete(PSX_nomReserve(dossierDistant(dossiers[i]), m.size)); })).catch(function () {})
				.then(function () { quitter("./"); });
		}));
		else liste.appendChild(PT.ligne("forgetDisc", function () { PSX_oublierDisque(jeu.id).then(function () { quitter(location.href); }); }));

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
	function nomsTouches(i) { var c = commandes[0][i] || {}; return c.value2 ? nomPad(c.value2) + " / " + nomTouche(c.value) : nomTouche(c.value); }

	function construireControles() {
		var l = $("ctrl-liste"); l.innerHTML = "";
		l.appendChild(PT.reglage({ t: "player", valeurs: [0, 1, 2, 3].map(function (p) { return { v: p, l: String(p + 1) }; }),
			get: function () { return joueur; }, set: function (v) { joueur = v; dessinerControles(); } }));
		BOUTONS.forEach(function (b) {
			var verrou = PREMIUM_BOUTONS.indexOf(b[0]) >= 0 && !premium;
			var r = PT.ligne(function () { return nomBouton(b[1]); }, function (el) { if (verrou) return ouvrirPremium(); attendre(el, b[0]); }, function () {
				if (verrou) return "Premium";
				var c = commandes[joueur][b[0]] || {};
				return nomPad(c.value2) + "  ·  " + (joueur === 0 || c.value ? nomTouche(c.value) : "—");
			});
			if (verrou) r.classList.add("premium");
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
