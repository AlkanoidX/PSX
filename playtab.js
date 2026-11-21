// Moteur d'interface PlayTab : échelle, dernière entrée, focus unique, manette/clavier/souris/tactile,
// glyphes d'aide, notifications et langues. Suit D:\PS2 RECOMP\PAGE_DESIGN.md.
(function () {
	var root = document.documentElement;
	var PT = window.PT = {};

	// ---- Échelle : 1 rem = 16 px d'une maquette 1920 × 1080 ----
	function echelle() {
		var w = innerWidth, h = innerHeight, f = Math.min(w / 1920, h / 1080) * 16;
		if (matchMedia("(pointer: coarse)").matches) {
			var petit = Math.min(w, h), portrait = h > w;
			if (petit < 600) f = Math.min(12, Math.max(8.4, petit / (portrait ? 40 : 46)));
			else f = Math.max(f * 1.12, Math.min(12, petit / 68));
		}
		root.style.fontSize = Math.max(7, f) + "px";
	}
	echelle();
	addEventListener("resize", echelle);

	// ---- Langues ----
	var LANGS = ["en", "fr", "es", "de", "it", "pt", "pl", "tr"];
	PT.LANGS = LANGS;
	PT.NOMS_LANGUES = { en: "English", fr: "Français", es: "Español", de: "Deutsch", it: "Italiano", pt: "Português (BR)", pl: "Polski", tr: "Türkçe" };
	function lire(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function ecrire(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
	PT.lire = lire; PT.ecrire = ecrire;
	function langueDepart() {
		var m = location.search.match(/[?&]lang=([a-z]{2})/i);
		if (m && LANGS.indexOf(m[1].toLowerCase()) >= 0) return m[1].toLowerCase();
		var s = lire("psx-lang"); if (s && LANGS.indexOf(s) >= 0) return s;
		var nav = navigator.languages || [navigator.language || "en"];
		for (var i = 0; i < nav.length; i++) { var c = String(nav[i]).slice(0, 2).toLowerCase(); if (LANGS.indexOf(c) >= 0) return c; }
		return "en";
	}
	PT.lang = langueDepart();
	var surLangue = [];
	PT.t = function (cle, vars) {
		var tx = window.PSX_TEXTES || {};
		var s = (tx[PT.lang] && tx[PT.lang][cle]) || (tx.en && tx.en[cle]) || cle;
		if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
		return s;
	};
	PT.nombre = function (n, dec) { return new Intl.NumberFormat(PT.lang === "pt" ? "pt-BR" : PT.lang, { maximumFractionDigits: dec === undefined ? 1 : dec, minimumFractionDigits: dec === undefined ? 1 : dec }).format(n); };
	PT.traduire = function (el) {
		(el || document).querySelectorAll("[data-t]").forEach(function (n) { n.textContent = PT.t(n.getAttribute("data-t")); });
		(el || document).querySelectorAll("[data-t-aria]").forEach(function (n) { n.setAttribute("aria-label", PT.t(n.getAttribute("data-t-aria"))); });
	};
	PT.surLangue = function (fn) { surLangue.push(fn); };
	PT.changerLangue = function (l) {
		PT.lang = l; ecrire("psx-lang", l); root.lang = l;
		PT.traduire(); surLangue.forEach(function (fn) { fn(); }); aide();
	};
	root.lang = PT.lang;
	if (lire("psx-contrast") === "1") root.classList.add("contrast");

	// ---- Dernière entrée utilisée ----
	var typeManette = "xbox";
	function mode(m) { if (root.getAttribute("data-input") !== m) { root.setAttribute("data-input", m); aide(); } }
	PT.mode = function () { return root.getAttribute("data-input"); };
	PT.typeManette = function () { return typeManette; };
	var mx = -1, my = -1;
	addEventListener("mousemove", function (e) { if (Math.abs(e.screenX - mx) + Math.abs(e.screenY - my) > 2) { mx = e.screenX; my = e.screenY; mode("mouse"); } }, true);
	addEventListener("mousedown", function () { mode("mouse"); }, true);
	addEventListener("touchstart", function () { mode("touch"); }, { capture: true, passive: true });

	// ---- Écran actif (fenêtre focalisable) ----
	// PT.ecran({ racine, retour(), horizontal(dir, el) -> bool, aide: ["change","back","select"], depart: el })
	var ecran = null, focus = null;
	PT.ecran = function (e) {
		ecran = e;
		if (e) {
			var d = e.depart || items()[0];
			PT.focaliser(d);
		} else { if (focus) focus.classList.remove("is-f"); focus = null; }
		aide();
	};
	PT.ecranActif = function () { return ecran; };
	function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest("[hidden]"); }
	function items() { return ecran ? Array.prototype.filter.call(ecran.racine.querySelectorAll(".f"), function (el) { return visible(el) && !el.disabled; }) : []; }
	PT.items = items;
	PT.focaliser = function (el) {
		if (!el) return;
		if (focus && focus !== el) focus.classList.remove("is-f");
		focus = el; el.classList.add("is-f");
		try { el.focus({ preventScroll: true }); } catch (e) {}
		el.scrollIntoView({ block: "nearest" });
	};
	PT.focusActuel = function () { return focus; };
	function cogner(el, haut) { if (!el) return; el.style.setProperty("--bump", haut ? "-.5rem" : ".5rem"); el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
	function deplacer(d) {
		var l = items(); if (!l.length) return;
		var i = l.indexOf(focus);
		if (i < 0) return PT.focaliser(l[0]);
		var j = i + d;
		if (j < 0 || j >= l.length) return cogner(focus, d < 0);
		PT.focaliser(l[j]);
	}
	function horizontal(d) {
		if (!focus) return;
		if (focus._changer) return focus._changer(d);
		if (ecran && ecran.horizontal && ecran.horizontal(d, focus)) return;
		cogner(focus, false);
	}
	function valider() {
		if (!focus) return;
		if (focus.classList.contains("off")) return cogner(focus, false);
		if (focus._changer) return focus._changer(1);
		focus.click();
	}
	function retour() { if (ecran && ecran.retour) ecran.retour(); }

	// Survol souris : déplace le focus
	document.addEventListener("mouseover", function (e) {
		if (PT.mode() !== "mouse" || !ecran) return;
		var el = e.target.closest && e.target.closest(".f");
		if (el && ecran.racine.contains(el) && !el.disabled) PT.focaliser(el);
	});

	// ---- Clavier ----
	var surMenu = null; // appelé en jeu (M / Échap / L3+R3)
	PT.surDemandeMenu = function (fn) { surMenu = fn; };
	addEventListener("keydown", function (e) {
		mode("key");
		if (PT.capture) return; // capture d'une touche (personnalisation des commandes)
		if (ecran) {
			var k = e.key, fait = true;
			if (k === "ArrowUp") deplacer(-1);
			else if (k === "ArrowDown") deplacer(1);
			else if (k === "ArrowLeft") horizontal(-1);
			else if (k === "ArrowRight") horizontal(1);
			else if (k === "Enter" || k === " ") { if (!e.repeat) valider(); }
			else if (k === "Escape" || k === "Backspace") { if (!e.repeat) retour(); }
			else fait = false;
			if (fait) { e.preventDefault(); e.stopPropagation(); }
		} else if ((e.key === "m" || e.key === "M" || e.key === "Escape") && surMenu && !e.repeat) {
			e.preventDefault(); e.stopPropagation(); surMenu();
		}
	}, true);
	addEventListener("keyup", function (e) { if (ecran) e.stopPropagation(); }, true);

	// ---- Manette : relue à chaque image, sans garder de référence ----
	var avant = {}, repet = {}, PREMIERE = 220, SUIVANTE = 160;
	PT.surManetteBrute = null; // capture pour la personnalisation des commandes
	function lirePads() { try { return navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { return []; } }
	function boucle(t) {
		var pads = lirePads(), etat = {}, actif = false;
		for (var p = 0; p < pads.length; p++) {
			var g = pads[p]; if (!g || !g.connected) continue;
			var b = function (i) { return g.buttons[i] && (g.buttons[i].pressed || g.buttons[i].value > .5); };
			var ax = Math.abs(g.axes[0] || 0) > .3 ? g.axes[0] : 0, ay = Math.abs(g.axes[1] || 0) > .3 ? g.axes[1] : 0;
			var e = { up: b(12) || ay < -.5, down: b(13) || ay > .5, left: b(14) || ax < -.5, right: b(15) || ax > .5, a: b(0), b: b(1), start: b(9), l3r3: b(10) && b(11) };
			for (var k in e) if (e[k]) { etat[k] = true; actif = true; }
			if (actif && !etat._id) { etat._id = g.id; }
			if (PT.surManetteBrute) PT.surManetteBrute(g);
		}
		if (actif) {
			var id = String(etat._id || "");
			typeManette = /054c|playstation|dualshock|dualsense/i.test(id) ? "ps" : /057e|nintendo/i.test(id) ? "nin" : "xbox";
			mode("pad");
		}
		["up", "down", "left", "right", "a", "b", "start", "l3r3"].forEach(function (k) {
			var a = !!etat[k];
			if (a && !avant[k]) { action(k); repet[k] = t + PREMIERE; }
			else if (a && avant[k] && ["up", "down", "left", "right"].indexOf(k) >= 0 && t >= repet[k]) { action(k); repet[k] = t + SUIVANTE; }
			avant[k] = a;
		});
		requestAnimationFrame(boucle);
	}
	function action(k) {
		if (PT.capture) return;
		if (ecran) {
			if (k === "up") deplacer(-1); else if (k === "down") deplacer(1);
			else if (k === "left") horizontal(-1); else if (k === "right") horizontal(1);
			else if (k === "a") valider(); else if (k === "b") retour();
			else if (k === "start" && ecran.start) ecran.start();
			else if (k === "l3r3" && ecran.l3r3) ecran.l3r3();
		} else if (k === "l3r3" && surMenu) surMenu();
	}
	requestAnimationFrame(boucle);

	// ---- Lignes de réglage : ◀ valeur ▶ ----
	// PT.reglage({ t: "volume", valeurs: [{v, l}] ou fonction, get(), set(v) })
	PT.reglage = function (o) {
		var el = document.createElement("div");
		el.className = "row opt f"; el.tabIndex = -1; el.setAttribute("role", "group");
		el.innerHTML = '<span class="lab"></span><span class="val"><button class="arw" tabindex="-1" aria-hidden="true">◀</button><b class="num"></b><button class="arw" tabindex="-1" aria-hidden="true">▶</button></span>';
		var lab = el.querySelector(".lab"), val = el.querySelector("b");
		function vals() { return typeof o.valeurs === "function" ? o.valeurs() : o.valeurs; }
		function dessiner() {
			lab.textContent = PT.t(o.t);
			var v = o.get(), l = vals(), x = l.filter(function (i) { return i.v === v; })[0];
			val.textContent = x ? (typeof x.l === "function" ? x.l() : x.l) : String(v);
			el.setAttribute("aria-label", lab.textContent + " : " + val.textContent);
		}
		el._changer = function (d) {
			if (el.classList.contains("off")) return cogner(el, false);
			var l = vals(), i = 0, v = o.get();
			for (var k = 0; k < l.length; k++) if (l[k].v === v) i = k;
			o.set(l[(i + d + l.length) % l.length].v); dessiner();
		};
		var fl = el.querySelectorAll(".arw");
		fl[0].addEventListener("click", function (e) { e.stopPropagation(); PT.focaliser(el); el._changer(-1); });
		fl[1].addEventListener("click", function (e) { e.stopPropagation(); PT.focaliser(el); el._changer(1); });
		el.addEventListener("click", function () { PT.focaliser(el); el._changer(1); });
		el._dessiner = dessiner; dessiner();
		PT.surLangue(dessiner);
		return el;
	};
	PT.interrupteur = function (o) {
		return PT.reglage({ t: o.t, valeurs: [{ v: true, l: function () { return PT.t("yes"); } }, { v: false, l: function () { return PT.t("no"); } }], get: o.get, set: o.set });
	};
	// Ligne d'action avec chevron
	PT.ligne = function (cle, fn, cote) {
		var el = document.createElement("button");
		el.className = "row act f"; el.tabIndex = -1;
		el.innerHTML = '<span class="lab"></span>' + (cote ? '<span class="side"></span>' : "");
		function dessiner() { el.querySelector(".lab").textContent = typeof cle === "function" ? cle() : PT.t(cle); if (cote) el.querySelector(".side").textContent = cote(); }
		el.addEventListener("click", function () { PT.focaliser(el); fn(el); });
		el._dessiner = dessiner; dessiner(); PT.surLangue(dessiner);
		return el;
	};

	// ---- Notifications ----
	PT.toast = function (texte) {
		var pile = document.getElementById("toasts");
		if (!pile) { pile = document.createElement("div"); pile.id = "toasts"; pile.setAttribute("aria-live", "polite"); document.body.appendChild(pile); }
		var t = document.createElement("div"); t.className = "toast"; t.textContent = texte;
		pile.appendChild(t);
		while (pile.children.length > 3) pile.removeChild(pile.firstChild);
		setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
	};

	// ---- Aide en bas à droite ----
	function glyphe(btn) {
		if (PT.mode() === "key") return '<span class="g-key">' + (btn === "a" ? "Enter" : "Esc") + "</span>";
		if (typeManette === "ps") return '<span class="g ps ' + btn + '">' + (btn === "a" ? "✕" : "○") + "</span>";
		if (typeManette === "nin") return '<span class="g nin">' + (btn === "a" ? "B" : "A") + "</span>";
		return '<span class="g x' + btn + '">' + (btn === "a" ? "A" : "B") + "</span>";
	}
	function aide() {
		var h = document.getElementById("help");
		if (!h) { h = document.createElement("div"); h.id = "help"; document.body && document.body.appendChild(h); }
		if (!h) return;
		var l = ecran && ecran.aide ? ecran.aide : [];
		h.hidden = !l.length;
		h.innerHTML = l.map(function (k) {
			if (k === "change") return "<span>" + (PT.mode() === "key" ? '<span class="g-key">← →</span>' : '<span class="g-sys">◀ ▶</span>') + PT.t("change") + "</span>";
			return "<span>" + glyphe(k === "back" ? "b" : "a") + PT.t(k === "back" ? "back" : "select") + "</span>";
		}).join("");
	}
	PT.aide = aide;
	document.addEventListener("DOMContentLoaded", function () { PT.traduire(); aide(); });
})();
