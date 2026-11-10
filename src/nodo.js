// Lee bloques reales de Bitcoin Core a través del puente nodo/proxy.js
// y los convierte al mismo formato que usa la simulación.
import { SATS } from "./cadena.js";

export async function rpc(url, method, params = []) {
  let r;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method, params }) });
  } catch {
    throw new Error(`No hay respuesta en ${url}. ¿Arrancaste el puente con npm run nodo?`);
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error ?? `El puente respondió ${r.status}.`);
  return datos.result;
}

const aSats = (btc) => Math.round(btc * SATS);

export function vistaReal(b) {
  return {
    altura: b.height,
    hash: b.hash,
    anterior: b.previousblockhash ?? null,
    merkle: b.merkleroot,
    tiempo: b.time,
    dificultad: `bits ${b.bits} (dificultad ${b.difficulty})`,
    nonce: b.nonce,
    problemas: [],
    simulado: false,
    txs: b.tx.map((tx) => {
      const coinbase = tx.vin.some((v) => v.coinbase);
      return {
        id: tx.txid,
        coinbase,
        entradas: coinbase ? [] : tx.vin.map((v) => ({ texto: `${v.txid.slice(0, 8)}…:${v.vout}`, valor: v.prevout ? aSats(v.prevout.value) : 0 })),
        salidas: tx.vout.map((o) => ({ texto: o.scriptPubKey?.address ?? o.scriptPubKey?.type ?? "salida", valor: aSats(o.value) })),
        comision: typeof tx.fee === "number" ? aSats(tx.fee) : null,
      };
    }),
  };
}

export async function conectarNodo(url, cuantos = 12) {
  const info = await rpc(url, "getblockchaininfo");
  const desde = Math.max(0, info.blocks - cuantos + 1);
  const bloques = [];
  for (let h = desde; h <= info.blocks; h++) {
    const hash = await rpc(url, "getblockhash", [h]);
    bloques.push(vistaReal(await rpc(url, "getblock", [hash, 2])));
  }
  const ids = await rpc(url, "getrawmempool");
  const mempool = [];
  for (const id of ids.slice(0, 20)) {
    const tx = await rpc(url, "getrawtransaction", [id, true]).catch(() => null);
    if (tx) {
      mempool.push({
        entradas: [{ direccion: `${id.slice(0, 8)}…` }],
        salidas: [{ direccion: tx.vout[0]?.scriptPubKey?.address ?? "salida", valor: aSats(tx.vout[0]?.value ?? 0) }],
      });
    }
  }
  return { info, bloques, mempool };
}
