/* Funciones sencillas para las cuentas por persona y la forma de pago. No dependen de la pantalla. */

// Agrupa los productos de un pedido por "cuenta" (persona). Sin cuenta definida = cuenta "1".
export function agruparPorCuenta(items) {
  const grupos = new Map();
  for (const i of items) {
    const cuenta = i.cuenta || "1";
    if (!grupos.has(cuenta)) grupos.set(cuenta, []);
    grupos.get(cuenta).push(i);
  }
  return [...grupos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es", { numeric: true }))
    .map(([cuenta, lista]) => ({
      cuenta,
      items: lista,
      total: lista.reduce((suma, i) => suma + i.precioUnidad * i.cantidad, 0),
    }));
}

// Cómo se pagó el pedido: lo que marcó caja al cobrar, o lo que eligió el cliente. null = aún sin definir.
export const pagoDe = (pedido) =>
  pedido.formaDePago || (pedido.pago && pedido.pago !== "En mesa" ? pedido.pago : null);
