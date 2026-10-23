/* Cálculos del panel de ventas. No toca la pantalla ni Firebase: solo recibe pedidos y devuelve totales.
   (Así se puede probar por separado.) */

// Pedidos que cuentan como venta: no cuentan los pendientes de pago ni los cancelados.
export const CUENTAN = ["confirmado", "preparando", "listo", "entregado"];

// Fecha desde la cual se piden los pedidos, en hora de Colombia (la medianoche de Bogotá es 05:00 UTC).
export function inicioDe(periodo, ahora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(ahora);
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo).value);
  const dia = periodo === "mes" ? 1 : valor("day");
  let inicio = Date.UTC(valor("year"), valor("month") - 1, dia, 5, 0, 0);
  if (periodo === "semana") inicio -= 6 * 24 * 60 * 60 * 1000; // hoy y los 6 días anteriores
  return new Date(inicio);
}

// "2026-10-21" (día en hora de Colombia)
export const claveDia = (fecha) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(fecha);

function sumar(grupo, clave, valor) {
  const actual = grupo[clave] || { cantidad: 0, total: 0 };
  actual.cantidad += 1;
  actual.total += valor;
  grupo[clave] = actual;
}

export function resumir(pedidos) {
  const validos = pedidos.filter((p) => CUENTAN.includes(p.estado));
  const resumen = {
    total: 0,
    cantidad: validos.length,
    promedio: 0,
    porModalidad: {},
    porPago: {},
    productos: [],
    porDia: [],
    pendientes: pedidos.filter((p) => p.estado === "pendiente_pago").length,
    cancelados: pedidos.filter((p) => p.estado === "cancelado").length,
  };
  const productos = new Map();
  const dias = new Map();

  for (const p of validos) {
    resumen.total += p.totalProductos;
    sumar(resumen.porModalidad, p.modalidad, p.totalProductos);
    sumar(resumen.porPago, p.pago, p.totalProductos);

    const fecha = p.creadoEn?.toDate?.();
    if (fecha) {
      const dia = claveDia(fecha);
      dias.set(dia, (dias.get(dia) || 0) + p.totalProductos);
    }

    for (const i of p.items) {
      const acumulado = productos.get(i.nombre) || { nombre: i.nombre, cantidad: 0, total: 0 };
      acumulado.cantidad += i.cantidad;
      acumulado.total += i.precioUnidad * i.cantidad;
      productos.set(i.nombre, acumulado);
    }
  }

  resumen.promedio = resumen.cantidad ? Math.round(resumen.total / resumen.cantidad) : 0;
  resumen.productos = [...productos.values()].sort((a, b) => b.cantidad - a.cantidad || b.total - a.total);
  resumen.porDia = [...dias.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([dia, total]) => ({ dia, total }));
  return resumen;
}
