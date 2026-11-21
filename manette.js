// Manette (API Gamepad, mapping "standard" : Xbox, PlayStation, la plupart des manettes USB/Bluetooth).
// Toutes les manettes branchées pilotent le joueur 1. Le stick gauche double la croix directionnelle.
// PSXPad.surBouton(function (nom, appuye) {...}) reçoit chaque appui / relâchement.
(function () {
	var lireManettes = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : function () { return []; };

	var BOUTONS = { 0: "croix", 1: "rond", 2: "carre", 3: "triangle", 4: "L1", 5: "R1", 6: "L2", 7: "R2",
		8: "select", 9: "start", 10: "L3", 11: "R3", 12: "haut", 13: "bas", 14: "gauche", 15: "droite", 16: "home" };
	var SEUIL_STICK = 0.5, SEUIL_GACHETTE = 0.3;

	var ecouteurs = [], etat = {}, actif = false;

	function lire() {
		var appuis = {};
		var pads = lireManettes() || [];
		for (var p = 0; p < pads.length; p++) {
			var pad = pads[p];
			if (!pad || !pad.connected) continue;
			for (var b in BOUTONS) {
				var btn = pad.buttons[b];
				if (!btn) continue;
				var seuil = (b == 6 || b == 7) ? SEUIL_GACHETTE : 0.5;
				if (btn.pressed || btn.value > seuil) appuis[BOUTONS[b]] = true;
			}
			var ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
			if (ax < -SEUIL_STICK) appuis.gauche = true;
			if (ax > SEUIL_STICK) appuis.droite = true;
			if (ay < -SEUIL_STICK) appuis.haut = true;
			if (ay > SEUIL_STICK) appuis.bas = true;
		}
		return appuis;
	}

	function boucle() {
		var appuis = lire();
		var noms = {}, n;
		for (n in appuis) noms[n] = 1;
		for (n in etat) noms[n] = 1;
		for (n in noms) {
			var a = !!appuis[n];
			if (a !== !!etat[n]) {
				etat[n] = a;
				for (var i = 0; i < ecouteurs.length; i++) { try { ecouteurs[i](n, a); } catch (e) {} }
			}
		}
		requestAnimationFrame(boucle);
	}

	function demarrer() { if (!actif) { actif = true; requestAnimationFrame(boucle); } }

	window.PSXPad = {
		surBouton: function (fn) { ecouteurs.push(fn); demarrer(); },
		estAppuye: function (nom) { return !!etat[nom]; }
	};
})();
