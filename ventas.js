/* =====================================================================
   Panel de ventas (roles "dueno" y "admin"): totales por periodo, por tipo de pedido,
   por forma de pago, productos más vendidos y ventas por día.
   Se calcula con los pedidos que ya guarda el sistema; no necesita datos nuevos.
   ===================================================================== */

import { exigirSesion } from "./acceso.js";
import { escucharPedidosDesde } from "./firebase.js";
import { h, $, pesos } from "./utils.js";
import { inicioDe, resumir } from "./ventas-calculo.js";

const PERIODOS = [
  { id: "hoy", nombre: "Hoy" },
  { id: "semana", nombre: "Últimos 7 días" },
  { id: "mes", nombre: "Este mes" },
];
const NOMBRE_MODALIDAD = { mesa: "En mesa", domicilio: "Domicilio", llevar: "Para llevar" };

let periodo = "hoy";
let detener = null;

/* ---------- Dibujar ---------- */

function dibujarTabs() {
  $("tabs").replaceChildren(...PERIODOS.map((p) =>
    h("button", {
      type: "button", class: "tab" + (p.id === periodo ? " activa" : ""),
      onclick: () => { periodo = p.id; dibujarTabs(); escuchar(); },
    }, p.nombre)));
}

const dato = (etiqueta, valor) => h("div", { class: "dato" }, h("span", { class: "dato__etiqueta" }, etiqueta), h("strong", { class: "dato__valor" }, valor));

function bloqueGrupo(titulo, grupo, nombres) {
  const filas = Object.entries(grupo).sort((a, b) => b[1].total - a[1].total);
  return h("section", { class: "admin__bloque" },
    h("h2", {}, titulo),
    filas.length === 0
      ? h("p", { class: "vacio" }, "Sin datos.")
      : filas.map(([clave, v]) => h("div", { class: "fila-dato" },
          h("span", {}, `${nombres?.[clave] || clave} · ${v.cantidad} pedidos`),
          h("strong", {}, pesos(v.total)))),
  );
}

function dibujar(pedidos) {
  const r = resumir(pedidos);
  const maximoDia = Math.max(1, ...r.porDia.map((d) => d.total));
  const etiquetaDia = (dia) => new Date(dia + "T12:00:00-05:00")
    .toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short", timeZone: "America/Bogota" });

  $("contenido").replaceChildren(
    h("div", { class: "resumen" },
      dato("Ventas", pesos(r.total)),
      dato("Pedidos", String(r.cantidad)),
      dato("Ticket promedio", pesos(r.promedio)),
    ),
    h("p", { class: "aviso" },
      `Se cuentan los pedidos confirmados y siguientes. No incluyen el valor del domicilio. Fuera de la cuenta: ${r.pendientes} pendientes de pago y ${r.cancelados} cancelados.`),
    bloqueGrupo("Por tipo de pedido", r.porModalidad, NOMBRE_MODALIDAD),
    bloqueGrupo("Por forma de pago", r.porPago),
    h("section", { class: "admin__bloque" },
      h("h2", {}, "Productos más vendidos"),
      r.productos.length === 0
        ? h("p", { class: "vacio" }, "Sin datos.")
        : r.productos.slice(0, 10).map((p) => h("div", { class: "fila-dato" },
            h("span", {}, `${p.cantidad} × ${p.nombre}`),
            h("strong", {}, pesos(p.total)))),
    ),
    periodo === "hoy" ? null : h("section", { class: "admin__bloque" },
      h("h2", {}, "Ventas por día"),
      r.porDia.map((d) => h("div", { class: "dia" },
        h("div", { class: "fila-dato" }, h("span", {}, etiquetaDia(d.dia)), h("strong", {}, pesos(d.total))),
        h("div", { class: "barra-dia", style: `width:${Math.round((d.total / maximoDia) * 100)}%` }),
      )),
    ),
  );
}

/* ---------- Conexión en vivo ---------- */

function escuchar() {
  if (detener) detener();
  $("estadoVentas").textContent = "Cargando…";
  detener = escucharPedidosDesde(
    inicioDe(periodo),
    (pedidos) => { $("estadoVentas").textContent = "En vivo"; dibujar(pedidos); },
    (error) => { console.error(error); $("estadoVentas").textContent = "No se pudieron cargar las ventas"; },
  );
}

function dejarDeEscuchar() {
  if (detener) detener();
  detener = null;
  $("contenido").replaceChildren();
  $("estadoVentas").textContent = "";
}

dibujarTabs();
exigirSesion({ roles: ["dueno", "admin"], alEntrar: escuchar, alSalir: dejarDeEscuchar });
