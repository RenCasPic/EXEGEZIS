# buggy-shop — Bugs conocidos (laboratorio de EXEGEZIS)

`buggy-shop` contiene **exactamente 3 bugs sembrados**. Su suite convencional
(`pnpm --filter buggy-shop test`) **pasa** aunque los 3 bugs existen. Esa es la
tesis que el laboratorio demuestra:

> Pasar una suite convencional ≠ software verificado.

## Reglas del laboratorio

- **El código fuente no contiene comentarios que señalen los bugs.** Es
  deliberado: en fases posteriores, EXEGEZIS investigará estos bugs y no debe
  encontrar la respuesta escrita en el código. La ubicación exacta solo está
  en este documento.
- Cada bug tiene un test en `tests/known-bugs/` que afirma el comportamiento
  **correcto** y está marcado con `test.fail()`. `pnpm --filter buggy-shop
  test:known-bugs` pasa **solo mientras los 3 bugs existen**. Si alguien corrige
  un bug, ese test pasa inesperadamente, Playwright lo reporta como fallo y hay
  que actualizar este documento.
- Cada bug tiene un escenario de reproducción como plan de datos en
  `scenarios/`, ejecutable con EXEGEZIS:

  ```bash
  pnpm exegezis observe --url http://localhost:3000 --actions examples/buggy-shop/scenarios/<escenario>.json
  ```

| ID | Tipo | Capa | Escenario |
|---|---|---|---|
| BUG-001 | UI/state | Frontend (`public/app.js`) | `scenarios/bug-001-stale-badge.json` |
| BUG-002 | API/data | Backend (`src/shop.ts`) | `scenarios/bug-002-coupon-quantity.json` |
| BUG-003 | Workflow | Contrato frontend ↔ backend | `scenarios/bug-003-cart-not-cleared.json` |

---

## BUG-001 — El badge del carrito no se actualiza al eliminar un producto

**Tipo:** UI/state. Una acción del usuario deja la UI en un estado inconsistente.

**Descripción.** Tras eliminar un producto del carrito, la lista del carrito y
los totales se actualizan, pero el badge del header (`Cart (N)`) conserva el
número anterior hasta recargar la página.

**Pasos manuales**
1. Abrir `http://localhost:3000`.
2. Pulsar **Add to cart** en *Wireless Mouse*. El badge muestra `Cart (1)`.
3. En el carrito, pulsar **Remove** junto a *Wireless Mouse*.

**Comportamiento esperado.** El carrito muestra "Your cart is empty" y el badge `Cart (0)`.

**Comportamiento observado.** El carrito muestra "Your cart is empty", pero el badge sigue en `Cart (1)`.

**Evidencia que EXEGEZIS captura** (escenario `bug-001-stale-badge.json`):
- `network.json`: `DELETE /api/cart/items/mouse` responde `200` con `"itemCount": 0`.
  **El servidor tiene el estado correcto.**
- `accessibility.json` (última snapshot): `link "Cart (1)"`. **La UI contradice al servidor.**

**Por qué la suite convencional no lo detecta.** El test
`removing a product empties the cart` (`tests/conventional/ui.spec.ts`) verifica
el mensaje de carrito vacío y el total, pero no el badge. El único test que mira
el badge (`adding a product updates the cart and the badge`) solo cubre la
acción de añadir.

**Ubicación (solo para el laboratorio).** `public/app.js`, `removeFromCart()`:
llama a `renderCart(cart)` pero no a `renderBadge(cart)`, a diferencia de `addToCart()`.

---

## BUG-002 — El descuento del cupón ignora la cantidad

**Tipo:** API/data. Una operación produce una respuesta con datos incorrectos.

**Descripción.** El cupón `SAVE10` (10%) se calcula sobre la suma de los
**precios unitarios** en lugar de sobre el **subtotal** (precio × cantidad).
Con cantidad 1 el resultado es correcto. Con cantidad > 1 el descuento es menor
del debido.

**Pasos manuales**
1. Abrir `http://localhost:3000`.
2. Pulsar **Add to cart** en *Mechanical Keyboard* dos veces (`× 2`, subtotal `$179.80`).
3. Escribir `SAVE10` en **Coupon code** y pulsar **Apply coupon**.

**Comportamiento esperado.** Descuento `-$17.98`, total `$161.82`.

**Comportamiento observado.** Descuento `-$8.99`, total `$170.81`.

**Evidencia que EXEGEZIS captura** (escenario `bug-002-coupon-quantity.json`):
- `network.json`: `POST /api/cart/coupon` responde
  `"subtotalCents": 17980, "discountCents": 899`. El dato incorrecto **nace en
  la API**: no es un problema de presentación.
- `accessibility.json` / screenshot: la UI muestra fielmente el valor incorrecto.

**Por qué la suite convencional no lo detecta.** Tanto el test de API
`applies a 10% coupon` como el de UI `applying a coupon shows the discount` usan
**cantidad 1**, el único caso en el que la suma de precios unitarios coincide
con el subtotal.

**Ubicación (solo para el laboratorio).** `src/shop.ts`, `discountBase()`:
suma `item.unitPriceCents` en lugar de `item.lineTotalCents`.

---

## BUG-003 — Los productos comprados vuelven a aparecer en el carrito

**Tipo:** workflow. Un flujo aparentemente válido termina en un comportamiento inesperado.

**Descripción.** El checkout crea el pedido y la UI muestra el carrito vacío,
pero el carrito **del servidor** no se vacía. Al seguir comprando, los productos
ya pagados reaparecen, y un segundo checkout los cobraría otra vez.

**Pasos manuales**
1. Abrir `http://localhost:3000`.
2. Añadir *Mechanical Keyboard* y pulsar **Checkout**. Aparece "Order confirmed"
   (`ORD-…`, total `$89.90`) y el carrito se ve vacío.
3. Pulsar **Continue shopping** y añadir *Wireless Mouse*.

**Comportamiento esperado.** El carrito contiene solo *Wireless Mouse × 1*, total `$29.90`.

**Comportamiento observado.** El carrito contiene *Mechanical Keyboard × 1* **y**
*Wireless Mouse × 1*, total `$119.80`. Recargar la página tras el checkout
también muestra el teclado ya comprado.

**Evidencia que EXEGEZIS captura** (escenario `bug-003-cart-not-cleared.json`):
- `network.json`: `POST /api/checkout` → `201` con el pedido `ORD-1001`; el
  siguiente `POST /api/cart/items` responde con **dos** líneas (keyboard + mouse).
- `observations.json`: la observación `order-confirmed` muestra el carrito vacío
  en la UI. Es el estado *aparente*, que contradice el estado real del servidor.

**Por qué la suite convencional no lo detecta.** Cada pieza está probada por
separado y funciona: `places an order` verifica el pedido, `clears the cart`
verifica que `DELETE /api/cart` vacía el carrito y `checkout shows an order
confirmation` verifica que la UI muestra el carrito vacío (que la UI construye
**localmente**). Ningún test continúa el flujo después del checkout ni consulta
el carrito del servidor. Tampoco lo detecta el análisis estático: no hay código
muerto ni asignaciones inútiles, solo una llamada que **falta**.

**Ubicación (solo para el laboratorio).** Es un bug de contrato entre capas:
`Shop.checkout()` (`src/shop.ts`) crea el pedido sin vaciar `session.cart`, y
`checkout()` (`public/app.js`) pinta un carrito vacío local sin llamar a
`DELETE /api/cart`, que existe para eso. Hay dos correcciones razonables
(vaciar en el servidor dentro del checkout, o que el cliente llame al
endpoint). Decidir cuál es la causa raíz es parte del ejercicio: la del
servidor es más robusta porque no depende de cada cliente.

> Nota de diseño del laboratorio: la primera versión de este bug
> (`cart = emptyCart()` reasignando una variable local) la detectaba la regla
> `no-useless-assignment` de ESLint. Se rediseñó porque un bug que el linter
> del propio proyecto detecta no representa el caso que nos interesa.

---

## Por qué estos tres

Cubren tres lugares distintos donde "la suite pasa" y el software falla:

1. **BUG-001:** el servidor tiene razón y la UI miente. Solo se ve comparando
   la evidencia de red con la de accesibilidad.
2. **BUG-002:** la API miente y la UI lo repite fielmente. Solo se ve con datos
   fuera del caso feliz (cantidad > 1).
3. **BUG-003:** cada paso individual es correcto. El bug está en la
   **secuencia** y solo aparece si el flujo continúa más allá de donde terminan los tests.
