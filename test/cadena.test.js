import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256, hash256 } from "../src/sha256.js";
import * as C from "../src/cadena.js";

test("sha256 coincide con el de Node para textos de varios tamaños", () => {
  for (const t of ["", "abc", "hola Milagro", "x".repeat(55), "x".repeat(56), "y".repeat(64), "ñandú ₿".repeat(30)]) {
    assert.equal(sha256(t), createHash("sha256").update(t).digest("hex"));
  }
  const doble = createHash("sha256").update(createHash("sha256").update("abc").digest()).digest("hex");
  assert.equal(hash256("abc"), doble);
});

test("la recompensa empieza en 50 BTC y se reduce a la mitad cada 150 bloques", () => {
  assert.equal(C.recompensa(1), 50 * C.SATS);
  assert.equal(C.recompensa(149), 50 * C.SATS);
  assert.equal(C.recompensa(150), 25 * C.SATS);
  assert.equal(C.recompensa(300), 12.5 * C.SATS);
});

test("minar produce un hash con la cantidad de ceros pedida", () => {
  const c = C.crearCadena({ dificultad: 2 });
  const b = C.minarBloque(c, c.carteras.Alfredo);
  assert.ok(b.hash.startsWith("00"));
  assert.equal(b.anterior, c.bloques[0].hash);
  assert.equal(C.hashBloque(b), b.hash);
});

test("la coinbase madura con más de 100 confirmaciones, como en regtest", () => {
  const c = C.crearCadena({ dificultad: 1 });
  const yo = c.carteras.Alfredo;
  for (let i = 0; i < 100; i++) C.minarBloque(c, yo);
  assert.equal(C.saldo(c, yo).disponible, 0);
  assert.equal(C.saldo(c, yo).inmaduro, 100 * 50 * C.SATS);
  assert.throws(() => C.enviar(c, { de: yo, a: c.carteras.Ana, monto: C.SATS, comision: 1000 }), /madura/);
  C.minarBloque(c, yo); // bloque 101
  assert.equal(C.saldo(c, yo).disponible, 50 * C.SATS);
});

test("enviar usa UTXO, da vuelto y la comisión se la lleva el minero", () => {
  const c = C.crearCadena({ dificultad: 1 });
  const { Alfredo: yo, Ana: ana, Tienda: minero } = c.carteras;
  for (let i = 0; i < 101; i++) C.minarBloque(c, yo);
  const tx = C.enviar(c, { de: yo, a: ana, monto: 10 * C.SATS, comision: 20_000 });
  assert.equal(tx.salidas.length, 2);
  assert.equal(tx.salidas[1].valor, 50 * C.SATS - 10 * C.SATS - 20_000);
  assert.equal(C.saldo(c, ana).pendiente, 10 * C.SATS);
  const b = C.minarBloque(c, minero);
  assert.equal(b.transacciones.length, 2);
  assert.equal(b.transacciones[0].salidas[0].valor, 50 * C.SATS + 20_000);
  assert.equal(c.mempool.length, 0);
  assert.equal(C.saldo(c, ana).disponible, 10 * C.SATS);
  assert.throws(() => C.enviar(c, { de: ana, a: yo, monto: 11 * C.SATS, comision: 0 }), /insuficiente/);
});

test("no se puede gastar dos veces la misma moneda", () => {
  const c = C.crearCadena({ dificultad: 1 });
  const { Alfredo: yo, Ana: ana } = c.carteras;
  for (let i = 0; i < 101; i++) C.minarBloque(c, yo);
  C.enviar(c, { de: yo, a: ana, monto: 49 * C.SATS, comision: 0 });
  assert.throws(() => C.enviar(c, { de: yo, a: ana, monto: 49 * C.SATS, comision: 0 }), /madura|insuficiente/);
});

test("la raíz de Merkle duplica el último cuando hay un número impar", () => {
  const { raiz, niveles } = C.raizMerkle(["a", "b", "c"]);
  assert.equal(niveles[1].length, 2);
  assert.equal(niveles[1][1], hash256("cc"));
  assert.equal(raiz, hash256(hash256("ab") + hash256("cc")));
});

test("cambiar una transacción vieja rompe la cadena desde ese bloque", () => {
  const c = C.crearCadena({ dificultad: 1 });
  for (let i = 0; i < 4; i++) C.minarBloque(c, c.carteras.Alfredo);
  assert.ok(C.validarCadena(c).every((r) => r.problemas.length === 0));
  C.manipular(c, 2, 0, 1000 * C.SATS);
  const r = C.validarCadena(c);
  assert.equal(r[1].problemas.length, 0);
  assert.match(r[2].problemas.join(" "), /modificada/);
});
