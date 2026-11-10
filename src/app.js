import * as C from "./cadena.js";
import { conectarNodo } from "./nodo.js";

const $ = (s) => document.querySelector(s);
const el = (etiqueta, props = {}, ...hijos) => {
  const e = Object.assign(document.createElement(etiqueta), props);
  e.append(...hijos.filter((h) => h !== null && h !== undefined && h !== false));
  return e;
};
const corto = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const ceros = (h) => h.match(/^0*/)[0].length;
const fechaHora = new Intl.DateTimeFormat("es-EC", { dateStyle: "medium", timeStyle: "short" });

function hashConCeros(h, { recortar = false } = {}) {
  const n = ceros(h);
  const resto = recortar ? corto(h).slice(n) : h.slice(n);
  return [el("span", { className: "ceros", textContent: h.slice(0, n) }), resto];
}

/* ---------- estado ---------- */
let modo = "sim";
let cadena = C.crearCadena({ dificultad: 3 });
let nombres = {};
let seleccion = null;
let siguiendoPunta = true; // mostrar siempre el último bloque hasta que el usuario elija otro
let ultimaAltura = -1;
let minando = false;
let nodo = null; // { info, bloques, mempool }
let velocidadHash = null;
let totalIntentos = 0;
let totalSegundos = 0;

function reiniciarNombres() {
  nombres = Object.fromEntries(Object.entries(cadena.carteras).map(([n, d]) => [d, n]));
}
reiniciarNombres();
const nombreDe = (dir) => nombres[dir] ?? (dir ? corto(dir) : "—");

/* ---------- vista común de un bloque (simulación o nodo real) ---------- */
function vistaSim(b, problemas) {
  return {
    altura: b.altura,
    hash: b.hash,
    anterior: b.anterior,
    merkle: b.merkle,
    tiempo: b.tiempo,
    dificultad: `${b.dificultad} ceros al inicio`,
    nonce: b.nonce,
    intentos: b.intentos,
    problemas,
    txs: b.transacciones.map((tx) => ({
      id: tx.id,
      coinbase: Boolean(tx.coinbase),
      entradas: tx.entradas.map((e) => ({ texto: nombreDe(e.direccion), valor: e.valor })),
      salidas: tx.salidas.map((s, i) => ({ texto: nombreDe(s.direccion), valor: s.valor, vuelto: !tx.coinbase && i > 0 && s.direccion === tx.entradas[0]?.direccion })),
      comision: tx.comision ?? null,
    })),
    niveles: C.raizMerkle(b.transacciones.map((t) => t.id)).niveles,
    simulado: true,
  };
}

function bloquesVisibles() {
  if (modo === "nodo") return nodo?.bloques ?? [];
  const validacion = C.validarCadena(cadena);
  return cadena.bloques.map((b, i) => vistaSim(b, validacion[i].problemas));
}

/* ---------- pintar ---------- */
function pintarEstado(bloques) {
  const datos = [];
  if (modo === "sim") {
    const rota = bloques.findIndex((b) => b.problemas.length);
    datos.push(
      ["Altura", C.punta(cadena).altura],
      ["Dificultad", `${cadena.dificultad} ceros`],
      ["Recompensa del próximo", `${C.btc(C.recompensa(C.punta(cadena).altura + 1))} BTC`],
      ["Mempool", `${cadena.mempool.length} tx`],
      ["Velocidad de minado", velocidadHash ? `${Math.round(velocidadHash / 1000)} mil hashes/s` : "—"],
      ["Cadena", rota === -1 ? "válida" : `rota desde el bloque ${rota}`, rota === -1 ? "cadena-ok" : "cadena-rota"],
    );
  } else if (nodo) {
    datos.push(
      ["Red", nodo.info.chain],
      ["Altura", nodo.info.blocks],
      ["Mempool", `${nodo.mempool.length} tx`],
      ["Mostrando", `últimos ${nodo.bloques.length} bloques`],
    );
  } else {
    datos.push(["Nodo", "sin conectar"]);
  }
  $("#estado").replaceChildren(
    ...datos.map(([k, v, clase]) => el("div", { className: `dato ${clase ?? ""}` }, el("span", { textContent: k }), el("strong", { textContent: String(v) }))),
  );
}

function pintarRiel(bloques) {
  const lista = $("#bloques");
  const nuevaAltura = bloques.at(-1)?.altura ?? -1;
  lista.replaceChildren(
    ...bloques.map((b) => {
      const pieza = el(
        "button",
        { type: "button", className: "pieza", ariaLabel: `Bloque ${b.altura}` },
        el("span", { className: "altura", textContent: `#${b.altura}` }),
        el("span", { className: "h" }, ...hashConCeros(b.hash, { recortar: true })),
        el("span", { className: "meta", textContent: `${b.txs.length} tx` }),
      );
      pieza.setAttribute("aria-current", String(b.altura === seleccion));
      pieza.addEventListener("click", () => {
        seleccion = b.altura;
        siguiendoPunta = b.altura === bloques.at(-1).altura;
        pintar();
      });
      const li = el("li", { className: "bloque" }, pieza);
      li.classList.toggle("roto", b.problemas.length > 0);
      li.classList.toggle("nuevo", b.altura > ultimaAltura && ultimaAltura >= 0);
      return li;
    }),
  );
  if (nuevaAltura > ultimaAltura) {
    const riel = document.querySelector(".riel");
    riel.scrollLeft = riel.scrollWidth;
  }
  ultimaAltura = nuevaAltura;
}

function pintarCarteras() {
  const altura = C.punta(cadena).altura;
  $("#carteras").replaceChildren(
    ...Object.entries(cadena.carteras).map(([nombre, dir]) => {
      const s = C.saldo(cadena, dir);
      const extras = [];
      if (s.inmaduro) extras.push(`${C.btc(s.inmaduro)} BTC de minería sin madurar`);
      if (s.pendiente) extras.push(`${C.btc(s.pendiente)} BTC por confirmar`);
      return el(
        "li",
        { className: "cartera" },
        el("b", { textContent: nombre }),
        el("span", { className: "saldo", textContent: `${C.btc(s.disponible)} BTC` }),
        el("span", { className: "dir", textContent: dir }),
        extras.length ? el("span", { className: "extra", textContent: extras.join(" · ") }) : null,
      );
    }),
  );
  for (const id of ["#minero", "#de", "#a"]) {
    const sel = $(id);
    const previo = sel.value;
    sel.replaceChildren(...Object.keys(cadena.carteras).map((n) => el("option", { value: n, textContent: n })));
    sel.value = previo || (id === "#a" ? "Ana" : "Alfredo");
  }
  if (altura < 101 && !$("#minando").textContent) {
    $("#minando").textContent = "Pista: como en regtest, las monedas minadas se pueden gastar cuando tienen más de 100 confirmaciones. Mina 101 bloques para empezar.";
  }
}

function pintarMempool() {
  const lista = modo === "sim" ? cadena.mempool : nodo?.mempool ?? [];
  $("#cuenta-mempool").textContent = `(${lista.length})`;
  $("#mempool").replaceChildren(
    ...(lista.length
      ? lista.map((tx) =>
          el("li", {}, el("span", { textContent: `${nombreDe(tx.entradas[0].direccion)} → ${nombreDe(tx.salidas[0].direccion)}` }), el("b", { textContent: `${C.btc(tx.salidas[0].valor)} BTC` })),
        )
      : [el("li", { className: "vacia", textContent: "Vacía. Lo que envíes espera aquí hasta que alguien mine un bloque." })]),
  );
}

function pintarDetalle(bloques) {
  const caja = $("#detalle");
  const b = bloques.find((x) => x.altura === seleccion) ?? bloques.at(-1);
  if (!b) {
    caja.replaceChildren(el("p", { textContent: modo === "nodo" ? "Conecta tu nodo para ver sus bloques." : "No hay bloques." }));
    return;
  }
  const valido = b.problemas.length === 0;
  const filas = [
    ["Hash", b.hash],
    ["Bloque anterior", b.anterior ?? "— (génesis)"],
    ["Raíz de Merkle", b.merkle],
    ["Fecha", fechaHora.format(new Date(b.tiempo * 1000))],
    ["Dificultad", b.dificultad],
    ["Nonce", b.intentos ? `${b.nonce.toLocaleString("es-EC")} (${b.intentos.toLocaleString("es-EC")} intentos)` : b.nonce.toLocaleString("es-EC")],
  ];
  caja.replaceChildren(...[
    el("h2", {}, `Bloque #${b.altura}`, el("span", { className: `sello ${valido ? "ok" : "roto"}`, textContent: valido ? "válido" : "inválido" })),
    el("p", { className: "hash-grande" }, ...hashConCeros(b.hash)),
    valido ? null : el("ul", { className: "problemas" }, ...b.problemas.map((p) => el("li", { textContent: p })),
      el("li", { textContent: "Para que la trampa pase, habría que volver a minar este bloque y todos los que vienen después, más rápido que el resto de la red. Por eso es tan difícil cambiar el pasado en Bitcoin." })),
    el("dl", { className: "cabecera-bloque" }, ...filas.flatMap(([k, v]) => [el("dt", { textContent: k }), el("dd", { textContent: v })])),
    el("h3", { textContent: `Transacciones (${b.txs.length})` }),
    b.txs.length ? el("ul", { className: "txs" }, ...b.txs.map((tx, i) => pintarTx(tx, i, b))) : el("p", { textContent: "El bloque génesis no tiene transacciones." }),
    b.niveles?.length ? el("h3", { textContent: "Árbol de Merkle" }) : null,
    b.niveles?.length ? pintarMerkle(b.niveles) : null,
  ].filter(Boolean));
}

function pintarTx(tx, i, b) {
  const item = (x) => el("li", {}, `${x.texto} `, el("b", { textContent: `${C.btc(x.valor)} BTC` }), x.vuelto ? el("span", { className: "etq", textContent: "vuelto" }) : null);
  const li = el(
    "li",
    { className: "tx" },
    el(
      "div",
      { className: "tx-cabeza" },
      el("span", {}, tx.coinbase ? "Coinbase (recompensa del minero) " : "Transferencia ", el("code", { textContent: corto(tx.id) })),
      tx.comision !== null && !tx.coinbase ? el("span", { textContent: `comisión ${tx.comision.toLocaleString("es-EC")} sats` }) : null,
    ),
    el(
      "div",
      { className: "flujo" },
      el("ul", {}, ...(tx.coinbase ? [el("li", { textContent: "Monedas nuevas" })] : tx.entradas.map(item))),
      el("span", { className: "flecha", textContent: "→", ariaHidden: "true" }),
      el("ul", {}, ...tx.salidas.map(item)),
    ),
  );
  if (b.simulado && b.altura > 0) {
    const boton = el("button", { type: "button", className: "manipular", textContent: "Cambiar el monto (hacer trampa)" });
    boton.addEventListener("click", () => {
      C.manipular(cadena, b.altura, i, tx.salidas[0].valor + 1000 * C.SATS);
      pintar();
    });
    li.append(boton);
  }
  return li;
}

function pintarMerkle(niveles) {
  return el(
    "div",
    { className: "merkle", ariaLabel: "Árbol de Merkle: las transacciones abajo y la raíz arriba" },
    ...niveles.map((nivel) => el("div", { className: "nivel" }, ...nivel.map((h) => el("span", { className: "nodo-m", textContent: h.slice(0, 8) })))),
  );
}

function pintar() {
  const bloques = bloquesVisibles();
  if (siguiendoPunta || seleccion === null || !bloques.some((b) => b.altura === seleccion)) seleccion = bloques.at(-1)?.altura ?? null;
  pintarEstado(bloques);
  pintarRiel(bloques);
  pintarDetalle(bloques);
  if (modo === "sim") {
    pintarCarteras();
    pintarMempool();
  }
}

/* ---------- minar sin congelar la página ---------- */
function minarUno(minero) {
  return new Promise((resolver) => {
    const plantilla = C.plantillaBloque(cadena, minero);
    const inicio = performance.now();
    const tanda = () => {
      for (let i = 0; i < 4000; i++) {
        const h = C.hashBloque(plantilla);
        if (C.cumpleDificultad(h, plantilla.dificultad)) {
          const bloque = { ...plantilla, hash: h, intentos: plantilla.nonce + 1 };
          totalIntentos += bloque.intentos;
          totalSegundos += (performance.now() - inicio) / 1000;
          if (totalSegundos > 0.05) velocidadHash = totalIntentos / totalSegundos;
          resolver(C.agregarBloque(cadena, bloque));
          return;
        }
        plantilla.nonce++;
      }
      $("#minando").textContent = `nonce ${plantilla.nonce.toLocaleString("es-EC")} → ${C.hashBloque(plantilla).slice(0, 24)}…`;
      setTimeout(tanda, 0);
    };
    tanda();
  });
}

async function minarVarios(n) {
  if (minando) return;
  minando = true;
  document.querySelectorAll("#minar1, #minar101").forEach((b) => (b.disabled = true));
  const minero = cadena.carteras[$("#minero").value];
  try {
    for (let i = 0; i < n; i++) {
      const b = await minarUno(minero);
      if (n === 1 || i % 10 === 9 || i === n - 1) pintar();
      $("#minando").textContent = `Bloque #${b.altura} minado: ${b.intentos.toLocaleString("es-EC")} intentos hasta encontrar ${b.hash.slice(0, 16)}…`;
    }
  } catch (e) {
    if (!(e instanceof C.ErrorCadena)) throw e;
    $("#minando").textContent = e.message;
  } finally {
    minando = false;
    document.querySelectorAll("#minar1, #minar101").forEach((b) => (b.disabled = false));
    pintar();
  }
}

/* ---------- eventos ---------- */
$("#minar1").addEventListener("click", () => minarVarios(1));
$("#minar101").addEventListener("click", () => minarVarios(101));
$("#dificultad").addEventListener("change", (e) => {
  cadena.dificultad = Number(e.target.value);
  pintar();
});
$("#enviar").addEventListener("submit", (e) => {
  e.preventDefault();
  const msj = $("#mensaje-enviar");
  try {
    const tx = C.enviar(cadena, {
      de: cadena.carteras[$("#de").value],
      a: cadena.carteras[$("#a").value],
      monto: Number($("#monto").value) * C.SATS,
      comision: Number($("#comision").value),
    });
    msj.textContent = `En la mempool (${corto(tx.id)}). Mina un bloque para confirmarla.`;
    msj.className = "mensaje ok";
  } catch (err) {
    if (!(err instanceof C.ErrorCadena)) throw err;
    msj.textContent = err.message;
    msj.className = "mensaje error";
  }
  pintar();
});

function cambiarModo(nuevo) {
  modo = nuevo;
  document.querySelectorAll("[data-modo]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.modo === modo)));
  $("#panel-sim").hidden = modo !== "sim";
  $("#panel-nodo").hidden = modo !== "nodo";
  seleccion = null;
  siguiendoPunta = true;
  ultimaAltura = -1;
  pintar();
}
document.querySelector(".modo").addEventListener("click", (e) => {
  const b = e.target.closest("[data-modo]");
  if (b) cambiarModo(b.dataset.modo);
});

$("#conectar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msj = $("#mensaje-nodo");
  msj.textContent = "Conectando…";
  msj.className = "mensaje";
  try {
    nodo = await conectarNodo($("#url-nodo").value.trim());
    msj.textContent = `Conectado a ${nodo.info.chain}, altura ${nodo.info.blocks}.`;
    msj.className = "mensaje ok";
    seleccion = null;
    pintar();
  } catch (err) {
    msj.textContent = err.message;
    msj.className = "mensaje error";
  }
});

pintar();
