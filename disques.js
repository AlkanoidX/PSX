// Disques des joueurs : vérification (volume ID du disque) et mémorisation dans le navigateur (IndexedDB).
// Rien n'est envoyé au serveur : le disque reste sur l'appareil du joueur.
(function () {
	var BASE = "psx-disques", TABLE = "disques";

	function ouvrir() {
		return new Promise(function (ok, ko) {
			var r = indexedDB.open(BASE, 1);
			r.onupgradeneeded = function () { r.result.createObjectStore(TABLE); };
			r.onsuccess = function () { ok(r.result); };
			r.onerror = function () { ko(r.error); };
		});
	}

	function transaction(mode, action) {
		return ouvrir().then(function (db) {
			return new Promise(function (ok, ko) {
				var t = db.transaction(TABLE, mode);
				var r = action(t.objectStore(TABLE));
				t.oncomplete = function () { db.close(); ok(r && r.result); };
				t.onerror = t.onabort = function () { db.close(); ko(t.error); };
			});
		});
	}

	window.PSX_lireDisque = function (id) {
		return transaction("readonly", function (s) { return s.get(id); });
	};

	window.PSX_garderDisque = function (id, fichier) {
		if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
		// Si le navigateur refuse (place insuffisante), le jeu se lance quand même ; il faudra juste re-choisir le disque.
		return transaction("readwrite", function (s) { return s.put(fichier, id); }).catch(function () {});
	};

	window.PSX_oublierDisque = function (id) {
		return transaction("readwrite", function (s) { return s.delete(id); });
	};

	// Volume ID du disque (ex. "SLES_01816"), lu dans le descripteur ISO 9660 (secteur 16).
	// Gère les images brutes 2352 octets/secteur (.bin/.img) et les .iso 2048.
	window.PSX_serialDuDisque = async function (fichier) {
		var essais = [16 * 2352 + 24, 16 * 2352 + 16, 16 * 2048];
		for (var i = 0; i < essais.length; i++) {
			var o = essais[i];
			if (fichier.size < o + 72) continue;
			var b = new Uint8Array(await fichier.slice(o, o + 72).arrayBuffer());
			if (b[1] === 67 && b[2] === 68 && b[3] === 48 && b[4] === 48 && b[5] === 49) { // "CD001"
				return String.fromCharCode.apply(null, b.subarray(40, 72)).trim().toUpperCase();
			}
		}
		return "";
	};
})();
