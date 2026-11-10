import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { crearProxy } from "../nodo/proxy.js";

// Un falso bitcoind que responde como el RPC de Bitcoin Core
let falso, proxy, base, ultimaAuth;
before(async () => {
  falso = createServer(async (req, res) => {
    ultimaAuth = req.headers.authorization;
    let t = "";
    for await (const c of req) t += c;
    const { method, params } = JSON.parse(t);
    const respuestas = {
      getblockcount: 101,
      getblockhash: "0".repeat(60) + "beef",
      getblockchaininfo: { chain: "regtest", blocks: 101 },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(method in respuestas ? { result: respuestas[method], error: null } : { result: null, error: { message: `falló ${method} ${params}` } }));
  });
  await new Promise((ok) => falso.listen(0, ok));
  proxy = crearProxy({ env: { BITCOIN_RPC_USER: "alfredo", BITCOIN_RPC_PASS: "clave" }, rpcUrl: `http://127.0.0.1:${falso.address().port}` });
  await new Promise((ok) => proxy.listen(0, ok));
  base = `http://127.0.0.1:${proxy.address().port}`;
});
after(() => {
  falso.close();
  proxy.close();
});

const rpc = (method, params, origin) =>
  fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ method, params }),
  });

test("reenvía métodos de lectura con las credenciales", async () => {
  const r = await rpc("getblockcount", []);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).result, 101);
  assert.equal(ultimaAuth, "Basic " + Buffer.from("alfredo:clave").toString("base64"));
});

test("bloquea métodos que gastan o cambian algo", async () => {
  for (const m of ["sendtoaddress", "generatetoaddress", "stop", "dumpprivkey"]) {
    const r = await rpc(m, []);
    assert.equal(r.status, 403, m);
  }
});

test("solo da permiso CORS a localhost y a GitHub Pages", async () => {
  const bueno = await rpc("getblockcount", [], "https://acruzc23-crypto.github.io");
  assert.equal(bueno.headers.get("access-control-allow-origin"), "https://acruzc23-crypto.github.io");
  const malo = await rpc("getblockcount", [], "https://sitio-raro.com");
  assert.equal(malo.headers.get("access-control-allow-origin"), null);
});

test("devuelve el error del nodo de forma legible", async () => {
  const r = await rpc("getblock", ["abc"]);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /falló getblock/);
});
