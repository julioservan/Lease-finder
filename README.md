# 🚗 Lease Finder

Aplicación web para **calcular, guardar y comparar ofertas de lease** de autos,
inspirada en la [calculadora de Leasehackr](https://leasehackr.com/calculator).

Es 100 % HTML + CSS + JavaScript sin dependencias: basta con abrir
`index.html` en el navegador (o servirla con GitHub Pages / cualquier
servidor estático). Las ofertas se guardan en `localStorage`, así que tus
datos nunca salen de tu navegador.

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
index.html              — la aplicación (formulario, resultados, comparador)
css/styles.css          — estilos (tema oscuro, responsivo)
js/lease-calc.js        — lógica de cálculo pura (funciona en navegador y Node)
js/app.js               — UI: cálculo en vivo, guardado, comparador, compartir
test/lease-calc.test.js — tests de la lógica de cálculo
```

## Tests

```bash
node test/lease-calc.test.js
```

## Ideas futuras

- Depósitos de seguridad múltiples (MSD) para bajar el money factor.
- Comparación lease vs. compra financiada.
- Historial de precios por modelo y alertas cuando baje una oferta.
- Sincronización opcional en la nube para compartir entre dispositivos.
