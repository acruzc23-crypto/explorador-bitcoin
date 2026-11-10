// Una cadena de bloques al estilo regtest de Bitcoin, simplificada para aprender:
// UTXO, mempool, comisiones, coinbase con madurez de 100 bloques, árbol de Merkle
// y prueba de trabajo con SHA-256 doble. No hay firmas digitales ni scripts.
import { hash256, sha256 } from "./sha256.js";

export const SATS = 100_000_000; // 1 BTC
export const MADUREZ_COINBASE = 100; // igual que en Bitcoin Core
export const HALVING_REGTEST = 150; // en regtest la recompensa se reduce cada 150 bloques
export const RECOMPENSA_INICIAL = 50 * SATS;

export class ErrorCadena extends Error {}

// Como en Bitcoin Core: una coinbase se puede gastar cuando tiene más de 100 confirmaciones.
// Por eso en regtest se minan 101 bloques antes de tener saldo.
export const madura = (confirmaciones) => confirmaciones > MADUREZ_COINBASE;

export const btc = (sats) => (sats / SATS).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 8 });

export function direccion(nombre) {
  return "bcrt1q" + sha256(`clave-publica:${nombre}`).slice(0, 34);
}

export function recompensa(altura) {
  const halvings = Math.floor(altura / HALVING_REGTEST);
  return halvings >= 64 ? 0 : Math.floor(RECOMPENSA_INICIAL / 2 ** halvings);
}

const serializarTx = (tx) => JSON.stringify({ entradas: tx.entradas, salidas: tx.salidas, coinbase: tx.coinbase ?? null });
export const idTx = (tx) => hash256(serializarTx(tx));

export function raizMerkle(ids) {
  if (ids.length === 0) return { raiz: "0".repeat(64), niveles: [] };
  const niveles = [ids];
  let nivel = ids;
  while (nivel.length > 1) {
    const siguiente = [];
    for (let i = 0; i < nivel.length; i += 2) {
      siguiente.push(hash256(nivel[i] + (nivel[i + 1] ?? nivel[i]))); // el último se duplica si es impar
    }
    niveles.push(siguiente);
    nivel = siguiente;
  }
  return { raiz: nivel[0], niveles };
}

export const cabecera = (b) => `${b.version}|${b.anterior}|${b.merkle}|${b.tiempo}|${b.dificultad}|${b.nonce}`;
export const hashBloque = (b) => hash256(cabecera(b));
export const cumpleDificultad = (hash, dificultad) => hash.startsWith("0".repeat(dificultad));

/** Prueba nonces hasta que el hash empiece con `dificultad` ceros. */
export function minar(plantilla, { limite = 5_000_000, alProgreso } = {}) {
  const b = { ...plantilla, nonce: plantilla.nonce ?? 0 };
  const inicio = b.nonce;
  for (;;) {
    const h = hashBloque(b);
    if (cumpleDificultad(h, b.dificultad)) return { ...b, hash: h, intentos: b.nonce - inicio + 1 };
    b.nonce++;
    if (b.nonce - inicio >= limite) throw new ErrorCadena("Se alcanzó el límite de intentos sin encontrar un hash válido.");
    if (alProgreso && (b.nonce & 0x3fff) === 0) alProgreso(b.nonce - inicio, h);
  }
}

export function crearCadena({ dificultad = 3, carteras = ["Alfredo", "Ana", "Tienda"] } = {}) {
  const c = {
    bloques: [],
    mempool: [],
    dificultad,
    carteras: Object.fromEntries(carteras.map((n) => [n, direccion(n)])),
  };
  const genesis = {
    version: 1,
    altura: 0,
    anterior: "0".repeat(64),
    tiempo: 1294963200, // como el génesis de regtest, una fecha fija
    dificultad,
    transacciones: [],
  };
  genesis.merkle = raizMerkle([]).raiz;
  c.bloques.push(minar(genesis));
  return c;
}

export const punta = (c) => c.bloques.at(-1);

/** Todas las salidas no gastadas, contando también lo que ya está en la mempool. */
export function utxos(c, { incluirMempool = true } = {}) {
  const set = new Map();
  const txs = c.bloques.flatMap((b) => b.transacciones.map((tx) => ({ tx, altura: b.altura })));
  if (incluirMempool) txs.push(...c.mempool.map((tx) => ({ tx, altura: null })));
  for (const { tx, altura } of txs) {
    for (const e of tx.entradas) set.delete(`${e.tx}:${e.salida}`);
    tx.salidas.forEach((s, i) => set.set(`${tx.id}:${i}`, { tx: tx.id, salida: i, ...s, altura, coinbase: Boolean(tx.coinbase) }));
  }
  return [...set.values()];
}

export function saldo(c, dir) {
  const alturaActual = punta(c).altura;
  let disponible = 0, inmaduro = 0, pendiente = 0;
  for (const u of utxos(c)) {
    if (u.direccion !== dir) continue;
    if (u.altura === null) pendiente += u.valor;
    else if (u.coinbase && !madura(alturaActual - u.altura + 1)) inmaduro += u.valor;
    else disponible += u.valor;
  }
  return { disponible, inmaduro, pendiente };
}

export function confirmaciones(c, altura) {
  return altura === null ? 0 : punta(c).altura - altura + 1;
}

/** Arma una transacción eligiendo monedas, con vuelto al remitente. */
export function enviar(c, { de, a, monto, comision }) {
  monto = Math.round(monto);
  comision = Math.round(comision);
  if (!(monto > 0)) throw new ErrorCadena("El monto debe ser mayor que 0.");
  if (comision < 0) throw new ErrorCadena("La comisión no puede ser negativa.");
  if (de === a) throw new ErrorCadena("El remitente y el destinatario son la misma dirección.");
  const alturaActual = punta(c).altura;
  const disponibles = utxos(c)
    .filter((u) => u.direccion === de && u.altura !== null)
    .filter((u) => !u.coinbase || madura(alturaActual - u.altura + 1))
    .sort((x, y) => y.valor - x.valor);
  const necesario = monto + comision;
  const elegidas = [];
  let suma = 0;
  for (const u of disponibles) {
    if (suma >= necesario) break;
    elegidas.push(u);
    suma += u.valor;
  }
  if (suma < necesario) {
    const { inmaduro } = saldo(c, de);
    throw new ErrorCadena(
      inmaduro > 0 && suma + inmaduro >= necesario
        ? `Ese saldo todavía no madura: las monedas de minería necesitan más de ${MADUREZ_COINBASE} confirmaciones.`
        : `Saldo insuficiente: hay ${btc(suma)} BTC disponibles y se necesitan ${btc(necesario)} BTC.`,
    );
  }
  const salidas = [{ direccion: a, valor: monto }];
  if (suma - necesario > 0) salidas.push({ direccion: de, valor: suma - necesario }); // vuelto
  const tx = { entradas: elegidas.map((u) => ({ tx: u.tx, salida: u.salida, valor: u.valor, direccion: u.direccion })), salidas };
  tx.id = idTx(tx);
  tx.comision = comision;
  c.mempool.push(tx);
  return tx;
}

/** Arma la plantilla del próximo bloque: coinbase + mempool. */
export function plantillaBloque(c, minero, tiempo = punta(c).tiempo + 600) {
  const altura = punta(c).altura + 1;
  const comisiones = c.mempool.reduce((s, tx) => s + tx.comision, 0);
  const coinbase = {
    coinbase: `bloque ${altura}`,
    entradas: [],
    salidas: [{ direccion: minero, valor: recompensa(altura) + comisiones }],
  };
  coinbase.id = idTx(coinbase);
  const transacciones = [coinbase, ...c.mempool];
  return {
    version: 1,
    altura,
    anterior: punta(c).hash,
    tiempo,
    dificultad: c.dificultad,
    transacciones,
    merkle: raizMerkle(transacciones.map((t) => t.id)).raiz,
    nonce: 0,
  };
}

export function agregarBloque(c, bloque) {
  const problemas = validarBloque(c, bloque, punta(c));
  if (problemas.length) throw new ErrorCadena(problemas.join(" "));
  c.bloques.push(bloque);
  c.mempool = c.mempool.filter((tx) => !bloque.transacciones.some((t) => t.id === tx.id));
  return bloque;
}

export function minarBloque(c, minero, opciones) {
  return agregarBloque(c, minar(plantillaBloque(c, minero), opciones));
}

/** Revisa un bloque contra su anterior. Devuelve la lista de problemas. */
export function validarBloque(c, b, anterior) {
  const problemas = [];
  if (b.anterior !== anterior.hash) problemas.push("No apunta al hash del bloque anterior.");
  const ids = b.transacciones.map((t) => t.id);
  b.transacciones.forEach((t) => {
    if (idTx(t) !== t.id) problemas.push(`La transacción ${t.id.slice(0, 8)}… fue modificada: su id ya no coincide.`);
  });
  if (raizMerkle(ids).raiz !== b.merkle) problemas.push("La raíz de Merkle no coincide con las transacciones.");
  const h = hashBloque(b);
  if (h !== b.hash) problemas.push("El hash guardado no es el hash de la cabecera.");
  if (!cumpleDificultad(h, b.dificultad)) problemas.push(`El hash no empieza con ${b.dificultad} ceros.`);
  return problemas;
}

/** Valida toda la cadena: si alguien cambia un bloque viejo, se rompe desde ahí. */
export function validarCadena(c) {
  return c.bloques.map((b, i) => ({
    altura: b.altura,
    problemas: i === 0 ? (hashBloque(b) === b.hash ? [] : ["El bloque génesis fue modificado."]) : validarBloque(c, b, c.bloques[i - 1]),
  }));
}

/** Simula a alguien que cambia el monto de una transacción ya confirmada. */
export function manipular(c, altura, indiceTx, nuevoValor) {
  const b = c.bloques[altura];
  const tx = b.transacciones[indiceTx];
  if (!tx) throw new ErrorCadena("Esa transacción no existe.");
  tx.salidas[0].valor = Math.round(nuevoValor);
}
