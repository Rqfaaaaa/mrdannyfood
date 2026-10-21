/* =====================================================================
   Editor del menú (solo rol "dueno").
   Trabaja sobre una COPIA del menú; nada cambia en la carta hasta pulsar «Guardar cambios».
   ===================================================================== */

import { exigirSesion } from "./acceso.js";
import { leerMenu, guardarMenu } from "./firebase.js";
import { h, $, DIAS, ORDEN_DIAS, textoHorario } from "./utils.js";

let menu = null;               // el menú que se está editando
let sinGuardar = false;
const abiertas = new Set();    // categorías desplegadas (para no cerrarlas al redibujar)

const copia = (x) => JSON.parse(JSON.stringify(x));
const aleatorio = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const slug = (texto) => texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "categoria";

/* ---------- Estado de guardado ---------- */

function mostrarError(texto) {
  $("errorAdmin").hidden = !texto;
  $("errorAdmin").textContent = texto || "";
}

function marcarCambio() {
  sinGuardar = true;
  $("estadoGuardado").textContent = "Hay cambios sin guardar";
  $("estadoGuardado").className = "pendiente";
  $("botonGuardar").disabled = false;
}

function marcarGuardado() {
  sinGuardar = false;
  $("estadoGuardado").textContent = "Todo guardado";
  $("estadoGuardado").className = "";
  $("botonGuardar").disabled = true;
}

window.addEventListener("beforeunload", (e) => {
  if (sinGuardar) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- Dibujar ---------- */

const CAMPOS_NEGOCIO = [
  ["nombre", "Nombre del negocio"],
  ["whatsapp", "WhatsApp con indicativo, sin + (ej. 573001234567)"],
  ["datosPago", "Datos para transferencias (lo ve el cliente)"],
  ["direccion", "Dirección"],
  ["instagram", "Instagram"],
];

function dibujarNegocio() {
  const bloque = $("negocio");
  bloque.replaceChildren(h("h2", {}, "Datos del negocio"));
  menu.negocio = menu.negocio || {};
  for (const [clave, etiqueta] of CAMPOS_NEGOCIO) {
    const entrada = h("input", { type: "text", value: menu.negocio[clave] || "", maxlength: "200" });
    entrada.addEventListener("input", () => { menu.negocio[clave] = entrada.value; marcarCambio(); });
    bloque.append(h("label", { class: "admin__campo" }, h("span", {}, etiqueta), entrada));
  }
}

// Días y horas en que se aceptan pedidos de clientes. Fuera de ese horario pueden ver la carta
// pero no enviar pedidos (el mesero no tiene esta restricción).
function dibujarHorario() {
  const hs = menu.negocio.horarioServicio;
  const vista = h("p", { class: "aviso" });
  const actualizarVista = () => { vista.textContent = "Se mostrará así: " + textoHorario(hs); };

  const dias = h("div", { class: "opciones" }, ORDEN_DIAS.map((d) => {
    const casilla = h("input", { type: "checkbox" });
    casilla.checked = hs.dias.includes(d);
    casilla.addEventListener("change", () => {
      hs.dias = casilla.checked ? [...new Set([...hs.dias, d])] : hs.dias.filter((x) => x !== d);
      actualizarVista();
      marcarCambio();
    });
    return h("label", {}, casilla, DIAS[d]);
  }));

  const campoHora = (clave, etiqueta) => {
    const entrada = h("input", { type: "time", value: hs[clave] === "24:00" ? "00:00" : hs[clave] });
    entrada.addEventListener("input", () => { if (entrada.value) { hs[clave] = entrada.value; actualizarVista(); marcarCambio(); } });
    return h("label", { class: "admin__campo" }, h("span", {}, etiqueta), entrada);
  };

  actualizarVista();
  return h("div", { class: "admin__bloque" },
    h("h2", {}, "Horario de servicio"),
    h("p", { class: "aviso" }, "Fuera de este horario, los clientes pueden ver la carta pero no pueden enviar pedidos."),
    h("div", { class: "admin__campo" }, h("span", {}, "Días de servicio"), dias),
    campoHora("desde", "Abre a las"),
    campoHora("hasta", "Cierra a las (00:00 = medianoche)"),
    vista,
  );
}

function filaProducto(cat, p) {
  const nombre = h("input", { type: "text", value: p.nombre || "", maxlength: "80" });
  nombre.addEventListener("input", () => { p.nombre = nombre.value; marcarCambio(); });

  const precio = h("input", { type: "number", min: "0", step: "500", inputmode: "numeric", value: String(p.precio ?? 0) });
  precio.addEventListener("input", () => { p.precio = Number(precio.value); marcarCambio(); });

  const descripcion = h("textarea", { rows: "2", maxlength: "300" }, p.descripcion || "");
  descripcion.addEventListener("input", () => { p.descripcion = descripcion.value; marcarCambio(); });

  const agotado = h("input", { type: "checkbox" });
  agotado.checked = Boolean(p.agotado);
  agotado.addEventListener("change", () => { p.agotado = agotado.checked; marcarCambio(); });

  const eliminar = h("button", { type: "button", class: "boton-texto", onclick: () => {
    if (!confirm(`¿Eliminar «${p.nombre || "este producto"}» del menú?`)) return;
    cat.productos = cat.productos.filter((x) => x !== p);
    marcarCambio();
    dibujar();
  } }, "Eliminar");

  return h("div", { class: "fila-producto" },
    h("label", { class: "admin__campo" }, h("span", {}, "Nombre"), nombre),
    h("label", { class: "admin__campo" }, h("span", {}, "Precio (COP)"), precio),
    h("label", { class: "admin__campo ancho" }, h("span", {}, "Descripción / ingredientes"), descripcion),
    h("div", { class: "fila-producto__pie" },
      h("label", {}, agotado, "Agotado (no se puede pedir)"),
      eliminar,
    ),
  );
}

function bloqueCategoria(cat) {
  const nombreCategoria = h("input", { type: "text", value: cat.nombre || "", maxlength: "60" });
  nombreCategoria.addEventListener("input", () => { cat.nombre = nombreCategoria.value; marcarCambio(); });

  const prefijo = h("input", { type: "text", value: cat.prefijo || "", maxlength: "30", placeholder: "Ej: Perro" });
  prefijo.addEventListener("input", () => {
    const texto = prefijo.value.trim();
    if (texto) cat.prefijo = texto; else delete cat.prefijo;
    marcarCambio();
  });

  const agregar = h("button", { type: "button", class: "boton boton--suave", onclick: () => {
    cat.productos.push({ id: "p-" + aleatorio(), nombre: "Nuevo producto", descripcion: "", precio: 0 });
    abiertas.add(cat.id);
    marcarCambio();
    dibujar();
  } }, "+ Agregar producto");

  const detalle = h("details", { class: "admin__seccion" },
    h("summary", {}, h("span", {}, cat.nombre), h("span", {}, cat.productos.length + " productos")),
    h("div", { class: "admin__cuerpo" },
      cat.id === "adicionales"
        ? h("p", { class: "aviso" }, "Estos adicionales aparecen como opciones dentro de cada producto.")
        : null,
      h("label", { class: "admin__campo" }, h("span", {}, "Nombre de la categoría"), nombreCategoria),
      h("label", { class: "admin__campo" }, h("span", {}, "Prefijo en el pedido y la comanda (opcional)"), prefijo),
      h("p", { class: "aviso" }, "Se antepone al nombre del producto para evitar confusiones, por ejemplo «Perro Mr. Danny». Déjalo vacío si no hace falta."),
      cat.productos.map((p) => filaProducto(cat, p)),
      agregar,
    ),
  );
  detalle.open = abiertas.has(cat.id);
  detalle.addEventListener("toggle", () => { detalle.open ? abiertas.add(cat.id) : abiertas.delete(cat.id); });
  return detalle;
}

function dibujar() {
  dibujarNegocio();
  $("negocio").after($("horarioBloque"));
  $("horarioBloque").replaceChildren(dibujarHorario());
  const contenedor = $("categorias");
  contenedor.replaceChildren(...menu.categorias.map(bloqueCategoria));
  $("nuevaCategoria").hidden = false;
}

/* ---------- Guardar ---------- */

async function guardar() {
  mostrarError("");
  const ids = new Set();
  for (const cat of menu.categorias) {
    if (!cat.nombre.trim()) return mostrarError("Hay una categoría sin nombre.");
    for (const p of cat.productos) {
      if (!p.nombre.trim()) return mostrarError(`Hay un producto sin nombre en «${cat.nombre}».`);
      if (!Number.isFinite(p.precio) || p.precio < 0) return mostrarError(`El precio de «${p.nombre}» no es válido.`);
      if (ids.has(p.id)) return mostrarError(`Hay dos productos con el mismo identificador (${p.id}).`);
      ids.add(p.id);
    }
  }

  $("botonGuardar").disabled = true;
  $("estadoGuardado").textContent = "Guardando…";
  try {
    await guardarMenu(menu);
    $("avisoArchivo").hidden = true;
    marcarGuardado();
  } catch (error) {
    console.error(error);
    mostrarError("No se pudo guardar. Revisa la conexión e inténtalo de nuevo.");
    marcarCambio();
  }
}

/* ---------- Cargar ---------- */

async function cargar() {
  $("estadoGuardado").textContent = "Cargando…";
  let datos = null;
  try {
    datos = await leerMenu();
  } catch (error) {
    console.error(error);
  }
  const desdeArchivo = !datos;
  if (desdeArchivo) {
    const respuesta = await fetch("menu.json");
    if (!respuesta.ok) return mostrarError("No se pudo cargar el menú.");
    datos = await respuesta.json();
  }

  menu = copia(datos);
  menu.negocio = menu.negocio || {};
  menu.negocio.horarioServicio = menu.negocio.horarioServicio || { dias: [0, 1, 2, 3, 4, 5, 6], desde: "18:00", hasta: "00:00" };
  delete menu.negocio.horario; // el texto del horario ahora se genera solo
  delete menu.actualizadoEn;
  delete menu.nota_precios;
  for (const cat of menu.categorias) {
    for (const p of cat.productos) delete p.verificar; // el dueño confirma al guardar
  }

  $("avisoArchivo").hidden = !desdeArchivo;
  dibujar();
  if (desdeArchivo) marcarCambio(); else marcarGuardado();
}

/* ---------- Inicio ---------- */

$("botonGuardar").addEventListener("click", guardar);

$("nuevaCategoria").addEventListener("click", () => {
  const nombre = (prompt("Nombre de la nueva categoría:") || "").trim();
  if (!nombre) return;
  let id = slug(nombre);
  if (menu.categorias.some((c) => c.id === id)) id += "-" + aleatorio();
  menu.categorias.push({ id, nombre, nota: "", productos: [] });
  abiertas.add(id);
  marcarCambio();
  dibujar();
});

exigirSesion({
  roles: ["admin"],
  alEntrar: () => { if (!menu) cargar(); },
  alSalir: () => {
    menu = null;
    sinGuardar = false;
    $("negocio").replaceChildren();
    $("horarioBloque").replaceChildren();
    $("categorias").replaceChildren();
    $("nuevaCategoria").hidden = true;
    $("estadoGuardado").textContent = "";
  },
});
