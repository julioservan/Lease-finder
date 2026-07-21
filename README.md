# 🚗 Lease Finder

Aplicación web para **calcular, guardar y comparar ofertas de lease** de autos,
inspirada en la [calculadora de Leasehackr](https://leasehackr.com/calculator).

Es 100 % HTML + CSS + JavaScript sin dependencias: basta con abrir
`index.html` en el navegador (o servirla con GitHub Pages / cualquier
servidor estático). Las ofertas se guardan en `localStorage`, así que tus
datos nunca salen de tu navegador.

La interfaz se organiza en pestañas: **Modelos** (tus SUVs con foto, stock
real cerca y estado del lease), **Comparar** (modelos de cualquier marca lado
a lado: stock, precio más barato, mejor lease), **Ofertas** (lo que encontró
el robot + tus guardadas + escáner de anuncios), **Calculadora** y
**¿Lease o compra?**. Las búsquedas de stock se guardan en `localStorage`
y sobreviven a la recarga de la página; el botón ↻ las actualiza.

## Funciones

- **Calculadora de lease en vivo** con el modelo estándar de lease cerrado:
  costo capitalizado, valor residual, money factor (o TAE), tarifas
  capitalizadas o pagadas al inicio, e impuestos (sobre cada pago o por
  adelantado).
- **Métricas de comparación** al estilo Leasehackr:
  - **Costo efectivo mensual** — costo total del lease dividido entre el plazo
    (incluye drive-off, tarifas e impuestos, no solo el pago mensual).
  - **Regla del 1 %** — costo efectivo mensual como % del MSRP; ≤ 1 % suele
    ser una buena oferta.
  - **Score (años)** — `MSRP ÷ (costo efectivo mensual × 12)`: cuántos años
    de lease equivalen al precio de lista. Más alto = mejor; ≥ 8 suele ser
    excelente.
- **Guardado de ofertas** en el navegador, con nombre, fecha y notas.
- **Tabla comparativa** ordenable que resalta en verde la mejor oferta de
  cada columna; clic en una fila para recargarla y editarla.
- **Exportar / importar JSON** para respaldar tus ofertas o moverlas de
  dispositivo.
- **Enlaces compartibles**: la oferta actual se codifica en la URL para
  mandarla por chat o correo.
- Símbolo de **moneda configurable** y decimales con coma o punto.
- **Escáner de ofertas** (web y CLI): pega el texto de anuncios y extrae
  automáticamente los datos para puntuarlos y compararlos.

## Escáner de ofertas

No siempre tienes el desglose completo del lease: muchas veces solo tienes el
anuncio ("$499/mes con $3,500 due at signing…"). El escáner lo entiende:

- **En la app**: pega uno o varios anuncios en la sección *Escáner de
  ofertas* (separados por una línea de `---` o dos líneas en blanco).
  Detecta en español e inglés: mensualidad, plazo, pago inicial/enganche
  (incluido *sign and drive* → $0), MSRP/precio de lista, km o millas por
  año, residual, money factor y TAE. Cada oferta detectada se puntúa y se
  puede guardar en el comparador junto a las calculadas (aparecen con la
  insignia 🔍).
- **Desde la terminal**: escanea URLs o archivos de texto/HTML completos:

  ```bash
  node scanner/scan.js https://ejemplo.com/promociones
  node scanner/scan.js anuncios.txt pagina.html --json ofertas.json
  ```

  Imprime las ofertas ordenadas por costo efectivo mensual y, con `--json`,
  genera un archivo listo para "Importar JSON" en la app.

Cómo puntúa una oferta escaneada (sin residual/MF, solo con lo publicado):
si el pago inicial ≥ mensualidad se asume que ya incluye el primer mes
(`total = inicial + mensualidad × (plazo − 1)`); si es menor (enganche puro
o $0), `total = inicial + mensualidad × plazo`. Con el MSRP del anuncio se
calculan la regla del 1 % y el score.

## Vigilancia automática de fuentes

`scanner/watch.js` escanea todas las fuentes de `scanner/sources.json`
(preconfigurada con agencias cercanas a Downtown Brooklyn y New Jersey:
Brooklyn, Queens, Manhattan, Jersey City, Hillside, Edison…) más los
archivos que dejes en `data/inbox/`, y compara contra la corrida anterior:

```bash
node scanner/watch.js
```

- Detecta ofertas **nuevas**, ofertas que **bajaron de precio** y las marca
  como **⭐ destacadas** si su score ≥ `settings.alertScoreMin` (default 7).
- Mantiene el histórico en `data/offers-latest.json` (las ofertas que
  desaparecen se conservan `settings.staleDays` días para evitar falsos
  "nueva oferta" cuando una fuente falla un día).
- Si hay novedades escribe `data/report.md`.

El workflow `.github/workflows/lease-scan.yml` lo corre **todos los días a
las ~9 am hora de Nueva York**, guarda el estado en el repo y **abre un
issue** con el reporte cuando hay ofertas nuevas o mejoradas (también se
puede lanzar a mano desde la pestaña Actions → *Run workflow*).

### Navegador headless para fuentes con JavaScript

Si una fuente falla o no da ofertas con la petición simple, el vigilante la
reintenta automáticamente con **Chromium headless** (ejecutando el
JavaScript de la página). Es opcional: se activa instalando playwright —

```bash
npm install -D playwright && npx playwright install chromium
```

— y se controla con `settings.useBrowser` en `scanner/sources.json`
(`"auto"` por defecto; `false` para desactivarlo). También aplica al CLI
`scan.js`. El workflow de GitHub ya lo instala en cada corrida. Si tienes
un Chromium propio, apúntalo con la variable `LEASE_SCANNER_CHROMIUM`.

⚠️ **Realidad de las fuentes**: muchos sitios de agencias (plataformas
Dealer.com / DealerInspire) bloquean peticiones desde servidores en la nube
con 403 — a veces incluso a navegadores headless. Por eso cada corrida
incluye el **estado de cada fuente**, para que veas cuáles responden.
Consejos:

- Corre `node scanner/watch.js` desde tu propia máquina (IP residencial):
  la tasa de éxito es mucho mayor. Puedes agendarlo con `cron`/Atajos.
- El **inbox siempre funciona**: guarda en `data/inbox/` cualquier anuncio
  (texto o HTML descargado del navegador) y entra a la vigilancia.
- Ajusta `scanner/sources.json` con las agencias que te interesen: cada
  fuente acepta varias URLs candidatas y se usa la primera que dé ofertas.

## Fórmulas

```
costo capitalizado bruto   = precio negociado + tarifas capitalizadas
reducción de cap. cost     = enganche + incentivos
costo capitalizado ajustado = bruto − reducción
valor residual             = MSRP × residual %
depreciación mensual       = (cap ajustado − residual) ÷ plazo
cargo financiero mensual   = (cap ajustado + residual) × money factor
money factor               = TAE % ÷ 2400
pago inicial (drive-off)   = enganche + primer mes + tarifas al inicio + impuesto adelantado
costo total del lease      = drive-off + pagos restantes + tarifa de devolución
```

## Estructura

```
index.html                — la aplicación (formulario, resultados, escáner, comparador)
css/styles.css            — estilos (tema oscuro, responsivo)
js/lease-calc.js          — lógica de cálculo pura (funciona en navegador y Node)
js/offer-parser.js        — escáner: extrae datos de anuncios en texto libre
js/app.js                 — UI: cálculo en vivo, guardado, escáner, comparador
scanner/scan.js           — CLI para escanear URLs o archivos
scanner/watch.js          — vigilante: escanea fuentes, detecta nuevas/mejoradas
scanner/sources.json      — fuentes vigiladas (Brooklyn / NJ, editable)
scanner/lib.js            — utilidades compartidas del CLI
scanner/browser.js        — renderizado opcional con Chromium headless
data/inbox/               — deja aquí anuncios para incluirlos en la vigilancia
.github/workflows/lease-scan.yml — escaneo diario + issue con novedades
test/lease-calc.test.js   — tests de la lógica de cálculo
test/offer-parser.test.js — tests del escáner
```

## Tests

```bash
npm test
```

## Ideas futuras

- Depósitos de seguridad múltiples (MSD) para bajar el money factor.
- Comparación lease vs. compra financiada.
- Sincronización opcional en la nube para compartir entre dispositivos.

## Inventario real en stock (Auto.dev)

El botón "📦 Ver stock cerca" de cada modelo consulta inventario real de
concesionarios cerca del ZIP 11201 vía la API de [Auto.dev](https://www.auto.dev)
(1.000 consultas/mes gratis). Para activarlo:

1. Regístrate en https://www.auto.dev y copia tu **API key**.
2. En Vercel → proyecto `lease-finder` → Settings → Environment Variables:
   crea `AUTO_DEV_KEY` con esa clave (entorno Production) → Save.
3. Deployments → último deploy → menú "⋯" → **Redeploy**.

Sin la clave, el botón degrada al enlace de cars.com. Diagnóstico:
`/api/inventory?make=Honda&model=CR-V&debug=1` devuelve el primer registro
crudo para ajustar el mapeo de campos si hiciera falta.
