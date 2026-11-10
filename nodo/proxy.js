// Puente de solo lectura entre el navegador y un nodo Bitcoin Core en regtest.
// El navegador no puede hablar RPC directo (usuario/contraseña, CORS), así que
// este servidor pequeño reenvía solo métodos de consulta.
//
//   BITCOIN_RPC_USER=usuario BITCOIN_RPC_PASS=clave npm run nodo
//   (o BITCOIN_RPC_COOKIE=~/.bitcoin/regtest/.cookie)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const METODOS_PERMITIDOS = new Set([
  "getblockchaininfo",
  "getblockcount",
  "getblockhash",
  "getblock",
  "getrawmempool",
  "getmempoolinfo",
  "getmininginfo",
  "getrawtransaction",
]);

const ORIGENES = [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^https:\/\/acruzc23-crypto\.github\.io$/];

function credenciales(env) {
  if (env.BITCOIN_RPC_COOKIE) return readFileSync(env.BITCOIN_RPC_COOKIE.replace(/^~/, env.HOME ?? ""), "utf8").trim();
  if (env.BITCOIN_RPC_USER) return `${env.BITCOIN_RPC_USER}:${env.BITCOIN_RPC_PASS ?? ""}`;
  throw new Error("Falta BITCOIN_RPC_USER/BITCOIN_RPC_PASS o BITCOIN_RPC_COOKIE.");
}

export function crearProxy({ env = process.env, rpcUrl = env.BITCOIN_RPC_URL ?? "http://127.0.0.1:18443" } = {}) {
  const auth = "Basic " + Buffer.from(credenciales(env)).toString("base64");

  return createServer(async (req, res) => {
    const origen = req.headers.origin;
    if (origen && ORIGENES.some((r) => r.test(origen))) {
      res.setHeader("Access-Control-Allow-Origin", origen);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Private-Network", "true"); // Chrome, desde GitHub Pages a localhost
    }
    const responder = (estado, cuerpo) => {
      res.writeHead(estado, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.method !== "POST") return responder(405, { error: "Usa POST con { method, params }." });

    let texto = "";
    for await (const trozo of req) {
      texto += trozo;
      if (texto.length > 10_000) return responder(413, { error: "Petición demasiado grande." });
    }
    let pedido;
    try {
      pedido = JSON.parse(texto);
    } catch {
      return responder(400, { error: "El cuerpo no es JSON." });
    }
    const { method, params = [] } = pedido;
    if (!METODOS_PERMITIDOS.has(method)) return responder(403, { error: `Método no permitido: ${method}. Este puente es solo de lectura.` });
    if (!Array.isArray(params)) return responder(400, { error: "params debe ser una lista." });

    try {
      const r = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ jsonrpc: "1.0", id: "explorador", method, params }),
      });
      if (r.status === 401) return responder(502, { error: "El nodo rechazó el usuario o la contraseña." });
      const datos = await r.json();
      if (datos.error) return responder(400, { error: datos.error.message });
      responder(200, { result: datos.result });
    } catch (e) {
      responder(502, { error: `No pude conectar con el nodo en ${rpcUrl}. ¿Está corriendo bitcoind -regtest?` });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const puerto = Number(process.env.PORT ?? 18080);
  crearProxy().listen(puerto, "127.0.0.1", () => {
    console.log(`Puente listo en http://127.0.0.1:${puerto}. Ábrelo desde el explorador con "Conectar a mi nodo".`);
  });
}
