// PS1 disc streaming: the disc is read by 1 MB chunks, only when the game needs them, never downloaded whole.
// A disc in the repo (jeux.js "disque") is cut into pieces (00000.bin…, disc.json); a chunk is a range of one piece
// (raw.githubusercontent.com answers range requests, with CORS). Chunks read are kept in Cache Storage
// "psxweb-disc <folder address> <disc size>" (same naming as the PS2 / PSP pages' "ps2web-disc", "pspweb-disc"), so
// a game played before starts from the browser, and the storage screens can list and free them.
//
// The emulator reads its disc synchronously (emscripten FS). A chunk already in memory is served at once; the chunks
// after it are always on their way (AHEAD), so a game reading on finds them ready. A chunk not there yet (a jump to
// another part of the disc) is fetched with a synchronous request: the game waits a fraction of a second.
(function () {
	var CHUNK = 1048576;          // bytes per chunk
	var AHEAD = 8;                // chunks fetched ahead of the one read (8 MB, about 25 s of a 2x CD drive)
	var PARALLEL = 4;             // chunks downloaded at once in the background
	var MEMORY = 256;             // chunks kept in memory (256 MB), oldest dropped first (they stay in Cache Storage)

	window.PSX_FLUX_PREFIXE = "psxweb-disc ";
	window.PSX_FLUX_CHUNK = CHUNK;
	window.PSX_nomReserve = function (base, size) { return PSX_FLUX_PREFIXE + base + " " + size; };

	// base: folder address ending with "/", m: its disc.json { name, size, piece, pieces }
	window.PSX_flux = function (base, m) {
		var n = Math.ceil(m.size / CHUNK), mem = new Map(), enCours = new Map(), file = [], actifs = 0;
		var reserve = self.caches ? caches.open(PSX_nomReserve(base, m.size)).catch(function () { return null; }) : Promise.resolve(null);
		var f = { size: m.size, chunks: n, lus: 0, attentes: 0, surProgres: null };

		function cle(i) { return base + "chunk/" + i; }
		function plage(i) {
			var debut = i * CHUNK, fin = Math.min(debut + CHUNK, m.size) - 1, p = Math.floor(debut / m.piece);
			return { url: base + String(p).padStart(5, "0") + ".bin", de: debut - p * m.piece, a: fin - p * m.piece, taille: fin - debut + 1 };
		}
		function garder(i, octets) {
			mem.delete(i); mem.set(i, octets);
			if (mem.size > MEMORY) mem.delete(mem.keys().next().value);
		}
		function ranger(i, octets) {
			reserve.then(function (c) { if (c) return c.put(cle(i), new Response(octets)); }).catch(function () {});
		}
		// A 200 answer (host ignoring the range) is cut to the chunk.
		function decouper(octets, r, statut) { return statut === 206 ? octets : octets.subarray(r.de, r.a + 1); }

		// Background: from Cache Storage, else the network; kept in memory and in Cache Storage.
		function charger(i, bas) {
			if (i < 0 || i >= n || mem.has(i)) return Promise.resolve();
			if (enCours.has(i)) return enCours.get(i);
			var r = plage(i);
			var p = reserve.then(function (c) { return c ? c.match(cle(i)) : null; }).catch(function () { return null; }).then(function (hit) {
				if (hit) return hit.arrayBuffer().then(function (b) { return new Uint8Array(b); });
				return fetch(r.url, { headers: { Range: "bytes=" + r.de + "-" + r.a }, priority: bas ? "low" : "high" }).then(function (rep) {
					if (rep.status !== 206 && rep.status !== 200) throw new Error(rep.status + " " + r.url);
					return rep.arrayBuffer().then(function (b) {
						var o = decouper(new Uint8Array(b), r, rep.status);
						if (o.length !== r.taille) throw new Error("size " + o.length + " " + r.url);
						ranger(i, o); return o;
					});
				});
			}).then(function (o) { garder(i, o); f.lus++; if (f.surProgres) f.surProgres(f); }, function (e) { console.warn("disc chunk", i, e); })
				.then(function () { enCours.delete(i); });
			enCours.set(i, p);
			return p;
		}
		function pomper() {
			while (actifs < PARALLEL && file.length) {
				var i = file.shift();
				if (mem.has(i) || enCours.has(i)) continue;
				actifs++;
				charger(i, true).then(function () { actifs--; pomper(); });
			}
		}
		function enAvance(i) {
			var neuf = [];
			for (var j = i + 1; j <= i + AHEAD && j < n; j++) if (!mem.has(j) && !enCours.has(j) && file.indexOf(j) < 0) neuf.push(j);
			file = neuf.concat(file.filter(function (j) { return neuf.indexOf(j) < 0; })).slice(0, 64);
			pomper();
		}

		// Chunk not in memory: synchronous request (binary through x-user-defined, the only way on the page's thread).
		function chargerTout(i) {
			var r = plage(i);
			for (var essai = 0; essai < 3; essai++) {
				try {
					var x = new XMLHttpRequest();
					x.open("GET", r.url, false);
					x.overrideMimeType("text/plain; charset=x-user-defined");
					x.setRequestHeader("Range", "bytes=" + r.de + "-" + r.a);
					x.send();
					if (x.status !== 206 && x.status !== 200) continue;
					var t = x.responseText, o = new Uint8Array(t.length);
					for (var k = 0; k < t.length; k++) o[k] = t.charCodeAt(k) & 255;
					o = decouper(o, r, x.status);
					if (o.length !== r.taille) continue;
					f.attentes++;
					garder(i, o); ranger(i, o); f.lus++;
					return o;
				} catch (e) { console.warn("disc chunk (sync)", i, e); }
			}
			throw new Error("disc chunk " + i + " unreadable");
		}
		function octets(i) {
			var o = mem.get(i);
			if (o) { mem.delete(i); mem.set(i, o); return o; }
			return chargerTout(i);
		}

		// Copies length bytes at position into dest (a Uint8Array view); returns the count.
		f.lire = function (dest, position, length) {
			if (position >= m.size) return 0;
			length = Math.min(length, m.size - position);
			var fait = 0, dernier = -1;
			while (fait < length) {
				var p = position + fait, i = Math.floor(p / CHUNK), o = octets(i), d = p - i * CHUNK, k = Math.min(o.length - d, length - fait);
				dest.set(o.subarray(d, d + k), fait);
				fait += k; dernier = i;
			}
			enAvance(dernier);
			return fait;
		};
		// Before the game starts: the first chunks (the disc's system area, read first).
		f.prechauffer = function (combien) {
			var l = []; for (var i = 0; i < Math.min(combien, n); i++) l.push(charger(i, false));
			return Promise.all(l);
		};
		return f;
	};

	// Makes the stream a read-only file of the emulator's file system (same way as emscripten's own lazy files).
	window.PSX_fichierFlux = function (FS, chemin, f) {
		var i = chemin.lastIndexOf("/"), dossier = chemin.slice(0, i) || "/", nom = chemin.slice(i + 1);
		var node = FS.createFile(dossier, nom, {}, true, false);
		node.contents = null;
		Object.defineProperties(node, { usedBytes: { get: function () { return f.size; } } });
		var ops = {};
		Object.keys(node.stream_ops).forEach(function (k) { ops[k] = node.stream_ops[k]; });
		ops.read = function (stream, buffer, offset, length, position) {
			return f.lire(new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length), position, length);
		};
		ops.write = function () { throw new FS.ErrnoError(63); };
		ops.mmap = function () { throw new FS.ErrnoError(43); };
		node.stream_ops = ops;
		return node;
	};
})();
