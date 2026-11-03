/* Cálculos del panel de ventas. No toca la pantalla ni Firebase: solo recibe pedidos y devuelve totales.
   (Así se puede probar por separado.) */

// Pedidos que cuentan como venta: no cuentan los pendientes de pago ni los cancelados.
import { pagoDe } from "./cuentas.js";

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

// Hora del día (0 a 23) en Colombia
export const horaDe = (fecha) => Number(new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Bogota", hour: "numeric", hourCycle: "h23",
}).format(fecha));

// Todos los días del periodo (incluso los que no tuvieron ventas), de más antiguo a más reciente
export function diasDelPeriodo(periodo, ahora = new Date()) {
  const inicio = inicioDe(periodo, ahora).getTime();
  const hoy = claveDia(ahora);
  const dias = [];
  for (let t = inicio; dias.length < 40; t += 24 * 60 * 60 * 1000) {
    const clave = claveDia(new Date(t + 12 * 60 * 60 * 1000)); // mediodía de ese día, para evitar bordes
    dias.push(clave);
    if (clave >= hoy) break;
  }
  return dias;
}

// "En el local" = mesa + para llevar (el cliente está en el restaurante). "Domicilio" = lo que sale a la calle.
export const canalDe = (pedido) => (pedido.modalidad === "domicilio" ? "domicilio" : "local");

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
    porCanal: { local: { cantidad: 0, total: 0 }, domicilio: { cantidad: 0, total: 0 } },
    porPago: {},
    porMesero: {},
    porHora: Array(24).fill(0),
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
    const canal = resumen.porCanal[canalDe(p)];
    canal.cantidad += 1;
    canal.total += p.totalProductos;
    sumar(resumen.porPago, pagoDe(p) || "Sin definir", p.totalProductos);
    if (p.atendidoPor) sumar(resumen.porMesero, p.atendidoPor, p.totalProductos);

    const fecha = p.creadoEn?.toDate?.();
    if (fecha) {
      const dia = claveDia(fecha);
      dias.set(dia, (dias.get(dia) || 0) + p.totalProductos);
      resumen.porHora[horaDe(fecha)] += p.totalProductos;
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
  resumen.totalPorDia = dias; // Map "2026-10-21" -> total
  return resumen;
}
