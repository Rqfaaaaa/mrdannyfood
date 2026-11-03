/* =====================================================================
   Panel de ventas (roles "dueno" y "admin").
   Se calcula con los pedidos que ya guarda el sistema (ver ventas-calculo.js).
   ===================================================================== */

import { exigirSesion } from "./acceso.js";
import { escucharPedidosDesde } from "./firebase.js";
import { h, $, pesos } from "./utils.js";
import { inicioDe, resumir, diasDelPeriodo } from "./ventas-calculo.js";

const PERIODOS = [
  { id: "hoy", nombre: "Hoy" },
  { id: "semana", nombre: "Últimos 7 días" },
  { id: "mes", nombre: "Este mes" },
];
const NOMBRE_PAGO = { "Sin definir": "Sin definir (caja aún no marcó cómo pagó)" };

let periodo = "hoy";
let detener = null;
let animar = true; // las animaciones solo corren al abrir o al cambiar de periodo, no en cada pedido nuevo

/* ---------- Utilidades ---------- */

const porcentaje = (parte, total) => (total ? (parte / total) * 100 : 0);
const entero = (n) => Math.round(n);

// 45000 -> "45k", 1250000 -> "1,3M"
function corto(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Barra que "crece" hasta su tamaño (o aparece directo si no hay que animar)
function conTamano(elemento, propiedad, valor) {
  if (animar && !reducirMovimiento) {
    elemento.style[propiedad] = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => { elemento.style[propiedad] = valor + "%"; }));
  } else {
    elemento.style[propiedad] = valor + "%";
  }
  return elemento;
}

// El número "sube" hasta su valor final
function numeroAnimado(valorFinal) {
  const el = h("span", {}, pesos(animar && !reducirMovimiento ? 0 : valorFinal));
  if (animar && !reducirMovimiento) {
    const inicio = performance.now();
    const duracion = 700;
    const paso = (ahora) => {
      const t = Math.min(1, (ahora - inicio) / duracion);
      el.textContent = pesos(entero(valorFinal * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
  return el;
}

/* ---------- Piezas ---------- */

function filaBarra(texto, valor, pct, { rango, verde } = {}) {
  return h("div", { class: "v-fila" + (rango && rango <= 3 ? " v-fila--podio" : "") },
    h("div", { class: "v-fila__texto" },
      h("span", {}, rango ? h("span", { class: "v-rango" }, String(rango)) : null, texto),
      h("strong", {}, pesos(valor))),
    h("div", { class: "v-pista" }, conTamano(h("div", { class: "v-barra" + (verde ? " v-barra--verde" : "") }), "width", pct)),
  );
}

function grafica(columnas) {
  const maximo = Math.max(1, ...columnas.map((c) => c.valor));
  return h("div", { class: "v-grafica" }, columnas.map((c) => {
    const barra = conTamano(h("div", { class: "v-col__barra" }), "height", c.valor ? Math.max(2, porcentaje(c.valor, maximo)) : 0);
    return h("div", { class: "v-col" + (c.valor === maximo && c.valor > 0 ? " v-col--maxima" : ""), title: `${c.titulo}: ${pesos(c.valor)}` },
      h("span", { class: "v-col__valor" }, c.valor ? corto(c.valor) : ""),
      h("div", { class: "v-col__area" }, barra),
      h("span", { class: "v-col__etiqueta" }, c.etiqueta),
    );
  }));
}

function tarjetaCanal(clase, titulo, datos, total, detalle) {
  return h("div", { class: "v-canal v-canal--" + clase },
    h("p", { class: "v-canal__titulo" }, titulo, h("span", { class: "v-canal__pct" }, entero(porcentaje(datos.total, total)) + " % del total")),
    h("p", { class: "v-canal__valor" }, pesos(datos.total)),
    h("p", { class: "v-canal__detalle" }, `${datos.cantidad} pedidos · ticket promedio ${pesos(datos.cantidad ? entero(datos.total / datos.cantidad) : 0)}`),
    detalle,
  );
}

/* ---------- Dibujar ---------- */

function dibujarTabs() {
  $("tabs").replaceChildren(...PERIODOS.map((p) =>
    h("button", {
      type: "button", class: "tab" + (p.id === periodo ? " activa" : ""),
      onclick: () => { periodo = p.id; animar = true; dibujarTabs(); escuchar(); },
    }, p.nombre)));
}

function dibujar(pedidos) {
  const r = resumir(pedidos);

  if (r.cantidad === 0) {
    $("contenido").replaceChildren(h("section", { class: "v-bloque" },
      h("p", { class: "v-vacio" }, "Todavía no hay ventas en este periodo."),
      h("p", { class: "v-nota" }, `Fuera de la cuenta: ${r.pendientes} pendientes de pago y ${r.cancelados} cancelados.`)));
    animar = false;
    return;
  }

  const { local, domicilio } = r.porCanal;
  const mesa = r.porModalidad.mesa || { cantidad: 0, total: 0 };
  const llevar = r.porModalidad.llevar || { cantidad: 0, total: 0 };

  /* --- Total --- */
  const total = h("section", { class: "v-total" },
    h("p", { class: "v-total__etiqueta" }, "Ventas totales"),
    h("p", { class: "v-total__valor" }, numeroAnimado(r.total)),
    h("div", { class: "v-chips" },
      h("span", { class: "v-chip" }, h("strong", {}, String(r.cantidad)), " pedidos"),
      h("span", { class: "v-chip" }, "Ticket promedio ", h("strong", {}, pesos(r.promedio)))),
  );

  /* --- En el local vs domicilio --- */
  const reparto = h("div", { class: "v-reparto", role: "img", "aria-label": "Reparto de ventas entre el local y domicilio" },
    conTamano(h("div", { class: "v-reparto__local" }), "width", porcentaje(local.total, r.total)),
    conTamano(h("div", { class: "v-reparto__domicilio" }), "width", porcentaje(domicilio.total, r.total)),
  );
  const canales = h("section", { class: "v-bloque" },
    h("h2", {}, "¿Dónde se vendió?"),
    reparto,
    h("div", { class: "v-canales" },
      tarjetaCanal("local", "En el local", local, r.total,
        h("div", { class: "v-canal__sub" },
          h("span", {}, h("span", {}, `Mesa · ${mesa.cantidad} pedidos`), h("strong", {}, pesos(mesa.total))),
          h("span", {}, h("span", {}, `Para llevar · ${llevar.cantidad} pedidos`), h("strong", {}, pesos(llevar.total))))),
      tarjetaCanal("domicilio", "Domicilio", domicilio, r.total, null),
    ),
  );

  /* --- Formas de pago --- */
  const pagos = Object.entries(r.porPago).sort((a, b) => b[1].total - a[1].total);
  const formasDePago = h("section", { class: "v-bloque" },
    h("h2", {}, "Formas de pago"),
    pagos.map(([clave, v]) => filaBarra(`${NOMBRE_PAGO[clave] || clave} · ${v.cantidad} pedidos`, v.total, porcentaje(v.total, r.total), { verde: clave === "Transferencia" })),
  );

  /* --- Por mesero (solo si hay pedidos con nombre de quien atendió) --- */
  const meseros = Object.entries(r.porMesero).sort((a, b) => b[1].total - a[1].total);
  const porMesero = meseros.length === 0 ? null : h("section", { class: "v-bloque" },
    h("h2", {}, "Ventas por mesero"),
    meseros.map(([nombre, v]) => filaBarra(`${nombre} · ${v.cantidad} pedidos`, v.total, porcentaje(v.total, r.total))),
  );

  /* --- Por hora --- */
  const conVentas = r.porHora.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const desdeHora = Math.min(...conVentas);
  const hastaHora = Math.max(...conVentas);
  const nombreHora = (hh) => `${hh % 12 || 12}${hh >= 12 ? " PM" : " AM"}`;
  const horas = [];
  for (let hh = desdeHora; hh <= hastaHora; hh++) horas.push({ valor: r.porHora[hh], etiqueta: nombreHora(hh), titulo: nombreHora(hh) });
  const porHora = h("section", { class: "v-bloque" },
    h("h2", {}, "Ventas por hora", h("small", {}, "la barra verde es la hora más fuerte")),
    grafica(horas),
  );

  /* --- Productos más vendidos --- */
  const maximoCantidad = Math.max(1, ...r.productos.map((p) => p.cantidad));
  const productos = h("section", { class: "v-bloque" },
    h("h2", {}, "Productos más vendidos"),
    r.productos.slice(0, 10).map((p, i) => filaBarra(`${p.cantidad} × ${p.nombre}`, p.total, porcentaje(p.cantidad, maximoCantidad), { rango: i + 1 })),
  );

  /* --- Por día (no aplica para "Hoy") --- */
  let porDia = null;
  if (periodo !== "hoy") {
    const columnas = diasDelPeriodo(periodo).map((dia) => {
      const fecha = new Date(dia + "T12:00:00-05:00");
      const etiqueta = periodo === "semana"
        ? fecha.toLocaleDateString("es-CO", { weekday: "short", day: "numeric", timeZone: "America/Bogota" })
        : String(Number(dia.slice(8)));
      const titulo = fecha.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" });
      return { valor: r.totalPorDia.get(dia) || 0, etiqueta, titulo };
    });
    porDia = h("section", { class: "v-bloque" },
      h("h2", {}, "Ventas por día", h("small", {}, "la barra verde es el mejor día")),
      grafica(columnas),
    );
  }

  const nota = h("p", { class: "v-nota" },
    `Se cuentan los pedidos confirmados y siguientes, sin el valor del domicilio ni propinas. Fuera de la cuenta: ${r.pendientes} pendientes de pago y ${r.cancelados} cancelados. “En el local” incluye mesa y para llevar.`);

  // replaceChildren escribe "null" si recibe null, por eso se filtran los vacíos
  $("contenido").replaceChildren(...[total, canales, formasDePago, porMesero, porHora, productos, porDia, nota].filter(Boolean));
  animar = false;
}

/* ---------- Conexión en vivo ---------- */

// Texto del indicador de arriba; el puntito verde que parpadea solo se ve cuando está "En vivo"
function estado(texto, enVivo) {
  $("estadoVentas").textContent = texto;
  $("estadoVentas").classList.toggle("v-envivo", enVivo);
}

function escuchar() {
  if (detener) detener();
  estado("Cargando…", false);
  detener = escucharPedidosDesde(
    inicioDe(periodo),
    (pedidos) => { estado("En vivo", true); dibujar(pedidos); },
    (error) => { console.error(error); estado("No se pudieron cargar las ventas", false); },
  );
}

function dejarDeEscuchar() {
  if (detener) detener();
  detener = null;
  $("contenido").replaceChildren();
  estado("", false);
}

dibujarTabs();
exigirSesion({ roles: ["dueno", "admin"], alEntrar: () => { animar = true; escuchar(); }, alSalir: dejarDeEscuchar });
