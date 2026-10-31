/* =====================================================================
   Pantalla de pedidos (caja): ve los pedidos en vivo, confirma pagos,
   cambia estados e imprime comandas.
   ===================================================================== */

import { escucharPedidos, cambiarEstado, marcarRevisado, actualizarPedido, leerMenu } from "./firebase.js";
import { exigirSesion } from "./acceso.js";
import { pesos, h, $, textoModalidad, nombreCompleto } from "./utils.js";

/* ---------- Configuración ---------- */

const NOMBRE_ESTADO = {
  pendiente_pago: "Pendiente de pago",
  confirmado: "Confirmado",
  preparando: "En preparación",
  listo: "Listo",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

// Después de cada estado, cuál sigue y cómo se llama el botón
const SIGUIENTE = {
  confirmado: ["preparando", "Pasar a preparación"],
  preparando: ["listo", "Marcar listo"],
  listo: ["entregado", "Marcar entregado"],
};

const FILTROS = [
  { id: "pagar",    nombre: "Por confirmar", estados: ["pendiente_pago"] },
  { id: "cocina",   nombre: "En cocina",     estados: ["confirmado", "preparando"] },
  { id: "listos",   nombre: "Listos",        estados: ["listo"] },
  { id: "cerrados", nombre: "Terminados",    estados: ["entregado", "cancelado"] },
];

const NOMBRE_NEGOCIO = "Mr Danny Food";

/* ---------- Estado ---------- */

let pedidos = [];
let filtro = "cocina";
let detener = null;           // función para dejar de escuchar
let conocidos = null;         // pedidos ya vistos (para avisar solo de lo nuevo o modificado)

/* ---------- Utilidades ---------- */

const hora = (pedido) => {
  const fecha = pedido.creadoEn?.toDate?.();
  return fecha ? fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : "";
};

// Pitido corto cuando llega un pedido nuevo
function pitar() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const volumen = ctx.createGain();
    osc.connect(volumen);
    volumen.connect(ctx.destination);
    osc.frequency.value = 880;
    volumen.gain.value = 0.15;
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* sin sonido, no pasa nada */ }
}

// Número en formato internacional para WhatsApp (celular colombiano de 10 dígitos → 57 + número)
const telefonoWa = (t) => (t.length === 10 ? "57" + t : t);

/* ---------- Dibujar ---------- */

function dibujarTabs() {
  const nav = $("tabs");
  nav.replaceChildren();
  for (const f of FILTROS) {
    const cuantos = pedidos.filter((p) => f.estados.includes(p.estado)).length;
    nav.append(
      h("button", {
        type: "button",
        class: "tab" + (filtro === f.id ? " activa" : "") + (f.id === "pagar" && cuantos > 0 ? " alerta" : ""),
        onclick: () => { filtro = f.id; dibujar(); },
      }, f.nombre, h("span", { class: "tab__cuenta" }, cuantos)),
    );
  }
}

function tarjeta(p) {
  const detalleCliente = [
    p.nombre || null,
    p.telefono ? "Tel. " + p.telefono : null,
    p.direccion ? p.direccion : null,
  ].filter(Boolean).join(" · ");

  const botones = [];

  if (p.modificado) {
    botones.push(h("button", { class: "boton boton--suave", onclick: () => marcarRevisado(p.id) }, "Marcar como visto"));
  }
  if (p.estado === "pendiente_pago") {
    botones.push(h("button", { class: "boton", onclick: () => cambiarEstado(p.id, "confirmado") }, "Confirmar pago"));
  }
  if (SIGUIENTE[p.estado]) {
    const [nuevo, texto] = SIGUIENTE[p.estado];
    botones.push(h("button", { class: "boton", onclick: () => cambiarEstado(p.id, nuevo) }, texto));
  }
  if (EDITABLES.includes(p.estado)) {
    botones.push(h("button", { class: "boton boton--suave", onclick: () => abrirEditor(p) }, "Editar pedido"));
  }
  if (!["pendiente_pago", "cancelado"].includes(p.estado)) {
    botones.push(h("button", { class: "boton boton--suave", onclick: () => imprimir(p) }, "Imprimir comanda"));
  }
  if (p.telefono && p.origen === "cliente") {
    const mensaje = `Hola ${p.nombre}, te escribimos de ${NOMBRE_NEGOCIO} por tu pedido #${p.numero}.`;
    botones.push(h("a", {
      class: "boton boton--suave enlace-boton", target: "_blank", rel: "noopener",
      href: `https://wa.me/${telefonoWa(p.telefono)}?text=${encodeURIComponent(mensaje)}`,
    }, "WhatsApp"));
  }
  if (!["entregado", "cancelado"].includes(p.estado)) {
    botones.push(h("button", {
      class: "boton-texto",
      onclick: () => { if (confirm(`¿Cancelar el pedido #${p.numero}?`)) cambiarEstado(p.id, "cancelado"); },
    }, "Cancelar"));
  }

  return h("article", { class: "pedido pedido--" + p.estado },
    h("div", { class: "pedido__cabeza" },
      h("strong", { class: "pedido__numero" }, "#" + p.numero),
      h("span", { class: "pedido__tipo" }, textoModalidad(p)),
      h("span", { class: "pedido__hora" }, hora(p)),
      p.modificado ? h("span", { class: "etiqueta etiqueta--modificado" }, "MODIFICADO") : null,
      h("span", { class: "etiqueta etiqueta--" + p.estado }, NOMBRE_ESTADO[p.estado] || p.estado),
    ),
    detalleCliente ? h("p", { class: "pedido__cliente" }, detalleCliente) : null,
    h("ul", { class: "pedido__items" },
      p.items.map((i) => h("li", {},
        h("span", {}, `${i.cantidad} × ${i.nombre}`),
        i.extras?.length ? h("small", {}, "Con: " + i.extras.join(", ")) : null,
        i.nota ? h("small", { class: "nota" }, "Nota: " + i.nota) : null,
      )),
    ),
    h("p", { class: "pedido__pie" },
      h("span", {}, `${p.pago}${p.pagaCon ? " · paga con " + pesos(p.pagaCon) : ""}`),
      h("strong", {}, pesos(p.totalProductos)),
    ),
    h("div", { class: "pedido__acciones" }, botones),
  );
}

function dibujar() {
  dibujarTabs();
  const lista = $("lista");
  lista.replaceChildren();
  const f = FILTROS.find((x) => x.id === filtro);
  const visibles = pedidos.filter((p) => f.estados.includes(p.estado));
  if (visibles.length === 0) {
    lista.append(h("p", { class: "vacio" }, "No hay pedidos en esta lista."));
    return;
  }
  // Los más antiguos primero en cocina (salen en orden de llegada); en el resto, los más nuevos primero
  if (f.id === "cocina") visibles.reverse();
  visibles.forEach((p) => lista.append(tarjeta(p)));
}

/* ---------- Editar un pedido ---------- */
/* Caja, dueño y administrador pueden cambiar los productos, las cantidades, las notas y los datos
   del cliente mientras el pedido no esté listo. Queda marcado como MODIFICADO para reimprimir la comanda. */

const EDITABLES = ["pendiente_pago", "confirmado", "preparando"];
let edicion = null;      // pedido que se está editando
let menuCargado = null;  // menú, para agregar productos
let categoriaElegida = null;

// Mismo origen del menú que usan las demás pantallas: Firebase, y menu.json si no está
async function obtenerMenu() {
  if (menuCargado) return menuCargado;
  try {
    const guardado = await leerMenu();
    if (guardado && Array.isArray(guardado.categorias)) { menuCargado = guardado; return menuCargado; }
  } catch (error) {
    console.warn("No se pudo leer el menú del sistema, se usa menu.json:", error);
  }
  const respuesta = await fetch("menu.json");
  if (!respuesta.ok) throw new Error("No se encontró menu.json");
  menuCargado = await respuesta.json();
  return menuCargado;
}

const totalEdicion = () => edicion.lineas.reduce((s, l) => s + l.precioUnidad * l.cantidad, 0);

function errorEdicion(texto) {
  $("editError").hidden = !texto;
  $("editError").textContent = texto || "";
}

function campo(clave, etiqueta, valor, tipo = "text") {
  const entrada = h("input", { type: tipo, value: valor == null ? "" : String(valor), maxlength: "160" });
  edicion.entradas[clave] = entrada;
  return h("label", { class: "ed-campo" }, h("span", {}, etiqueta), entrada);
}

function dibujarCampos() {
  const e = edicion;
  const campos = [];
  if (e.modalidad === "mesa") {
    campos.push(campo("mesa", "Mesa", e.original.mesa), campo("nombre", "Nombre del cliente", e.original.nombre));
  } else {
    campos.push(campo("nombre", "Nombre", e.original.nombre), campo("telefono", "Teléfono", e.original.telefono, "tel"));
    if (e.modalidad === "domicilio") campos.push(campo("direccion", "Dirección de entrega", e.original.direccion));
    if (e.modalidad === "domicilio" && e.original.pago === "Efectivo") campos.push(campo("pagaCon", "Paga con (opcional)", e.original.pagaCon, "text"));
  }
  $("editCampos").replaceChildren(...campos);
}

function dibujarLineas() {
  const contenedor = $("editLineas");
  contenedor.replaceChildren();
  edicion.lineas.forEach((l, indice) => {
    const nota = h("input", { type: "text", value: l.nota || "", maxlength: "120", placeholder: "Nota (ej: sin cebolla)" });
    nota.addEventListener("input", () => { l.nota = nota.value; });
    contenedor.append(
      h("div", { class: "ed-linea" },
        h("div", { class: "ed-linea__fila" }, h("strong", {}, l.nombre), h("span", {}, pesos(l.precioUnidad * l.cantidad))),
        l.extras.length ? h("small", {}, "Con: " + l.extras.join(", ")) : null,
        h("div", { class: "ed-linea__ctrl" },
          h("button", { type: "button", "aria-label": "Quitar uno", onclick: () => cambiarCantidadLinea(indice, -1) }, "−"),
          h("output", {}, String(l.cantidad)),
          h("button", { type: "button", "aria-label": "Agregar uno", onclick: () => cambiarCantidadLinea(indice, 1) }, "+"),
          nota,
          h("button", { type: "button", class: "boton-texto", onclick: () => { edicion.lineas.splice(indice, 1); dibujarLineas(); } }, "Quitar"),
        ),
      ),
    );
  });
  $("editTotal").textContent = pesos(totalEdicion());
}

function cambiarCantidadLinea(indice, delta) {
  const linea = edicion.lineas[indice];
  linea.cantidad += delta;
  if (linea.cantidad <= 0) edicion.lineas.splice(indice, 1);
  dibujarLineas();
}

function agregarProductoEdicion(categoria, producto) {
  const nombre = categoria.id === "adicionales" ? "Adicional " + producto.nombre : nombreCompleto(categoria, producto);
  const existente = edicion.lineas.find((l) => l.id === producto.id && l.extras.length === 0 && !l.nota);
  if (existente) existente.cantidad += 1;
  else edicion.lineas.push({ id: producto.id, nombre, cantidad: 1, precioUnidad: producto.precio, extras: [], nota: "" });
  dibujarLineas();
}

function dibujarCatalogo(menu) {
  $("editCats").replaceChildren(...menu.categorias.map((c) =>
    h("button", {
      type: "button", class: "tab" + (c.id === categoriaElegida ? " activa" : ""),
      onclick: () => { categoriaElegida = c.id; dibujarCatalogo(menu); },
    }, c.nombre)));

  const categoria = menu.categorias.find((c) => c.id === categoriaElegida) || menu.categorias[0];
  $("editProductos").replaceChildren(...categoria.productos.map((producto) => {
    const atributos = { type: "button", class: "ed-producto", onclick: () => agregarProductoEdicion(categoria, producto) };
    if (producto.agotado) atributos.disabled = "";
    return h("button", atributos, h("span", {}, producto.nombre + (producto.agotado ? " (agotado)" : "")), h("strong", {}, pesos(producto.precio)));
  }));
}

async function mostrarCatalogo() {
  try {
    const menu = await obtenerMenu();
    categoriaElegida = categoriaElegida || menu.categorias[0].id;
    $("editCatalogo").hidden = false;
    dibujarCatalogo(menu);
  } catch (error) {
    console.error(error);
    errorEdicion("No se pudo cargar el menú para agregar productos.");
  }
}

function abrirEditor(pedido) {
  edicion = {
    id: pedido.id, numero: pedido.numero, modalidad: pedido.modalidad, original: pedido, entradas: {},
    lineas: pedido.items.map((i) => ({
      id: i.id || i.nombre, nombre: i.nombre, cantidad: i.cantidad, precioUnidad: i.precioUnidad,
      extras: i.extras || [], nota: i.nota || "",
    })),
  };
  $("editTitulo").textContent = `Editar pedido #${pedido.numero} · ${textoModalidad(pedido)}`;
  $("editCatalogo").hidden = true;
  errorEdicion("");
  dibujarCampos();
  dibujarLineas();
  $("dlgEditar").showModal();
}

async function guardarEdicion() {
  const e = edicion;
  const valor = (clave) => (e.entradas[clave] ? e.entradas[clave].value.trim() : "");
  errorEdicion("");

  if (e.lineas.length === 0) return errorEdicion("El pedido no puede quedar vacío. Para anularlo, usa «Cancelar» en la tarjeta.");

  const cambios = {
    items: e.lineas.map((l) => ({ id: l.id, nombre: l.nombre, cantidad: l.cantidad, precioUnidad: l.precioUnidad, extras: l.extras, nota: (l.nota || "").trim() })),
    totalProductos: totalEdicion(),
  };
  if (e.modalidad === "mesa") {
    cambios.mesa = valor("mesa");
    cambios.nombre = valor("nombre");
    if (!cambios.mesa) return errorEdicion("Escribe el número de mesa.");
  } else {
    cambios.nombre = valor("nombre");
    cambios.telefono = valor("telefono").replace(/\D/g, "");
    if (!cambios.nombre) return errorEdicion("Escribe el nombre del cliente.");
    if (e.modalidad === "domicilio") {
      cambios.direccion = valor("direccion");
      if (!cambios.direccion) return errorEdicion("Escribe la dirección de entrega.");
      if (e.entradas.pagaCon) cambios.pagaCon = Number(valor("pagaCon").replace(/\D/g, "")) || null;
    }
  }

  $("editGuardar").disabled = true;
  $("editGuardar").textContent = "Guardando…";
  try {
    await actualizarPedido(e.id, cambios);
    $("dlgEditar").close();
    edicion = null;
  } catch (error) {
    console.error(error);
    errorEdicion("No se pudo guardar el cambio. Revisa la conexión e inténtalo de nuevo.");
  } finally {
    $("editGuardar").disabled = false;
    $("editGuardar").textContent = "Guardar cambios";
  }
}

/* ---------- Imprimir comanda ---------- */

function imprimir(p) {
  const linea = (texto, clase) => h("p", { class: clase || "" }, texto);
  const domicilio = p.modalidad === "domicilio";

  // Lista de piezas del ticket. Las que no aplican quedan como null y se descartan con filter(Boolean)
  const partes = [
    linea(NOMBRE_NEGOCIO, "t-titulo"),
    p.modificado ? linea("*** MODIFICADA ***", "t-titulo") : null,
    linea("#" + p.numero, "t-numero"),
    linea(`${textoModalidad(p)}  ${hora(p)}`, "t-fuerte"),
    p.nombre ? linea("Cliente: " + p.nombre) : null,
    p.direccion ? linea("Dir: " + p.direccion) : null,
    p.telefono ? linea("Tel: " + p.telefono) : null,
    h("hr"),
    // Un bloque por producto: cantidad y nombre, adicionales y nota
    ...p.items.map((i) => h("div", { class: "t-item" },
      linea(`${i.cantidad} x ${i.nombre}`, "t-fuerte"),
      i.extras?.length ? linea("   + " + i.extras.join(", ")) : null,
      i.nota ? linea("   NOTA: " + i.nota, "t-fuerte") : null,
    )),
    h("hr"),
    // El total y el pago se imprimen solo en domicilio, para el domiciliario
    domicilio ? linea(`Pago: ${p.pago}`) : null,
    domicilio ? linea(`Total productos: ${pesos(p.totalProductos)}`, "t-fuerte") : null,
    domicilio && p.pagaCon ? linea(`Paga con: ${pesos(p.pagaCon)}`) : null,
  ].filter(Boolean);

  $("ticket").replaceChildren(...partes);
  window.print();
  if (p.modificado) marcarRevisado(p.id).catch((error) => console.error(error));
}

/* ---------- Conexión en vivo ---------- */

function empezarAEscuchar() {
  if (detener) return;
  $("conexion").textContent = "Conectando…";
  detener = escucharPedidos(
    (lista) => {
      // Aviso sonoro solo para pedidos nuevos que ya requieren atención
      if (conocidos) {
        const aviso = lista.some((p) => {
          const antes = conocidos.get(p.id);
          if (!antes) return ["pendiente_pago", "confirmado"].includes(p.estado); // pedido nuevo
          return Boolean(p.modificado) && !antes.modificado;                       // pedido modificado
        });
        if (aviso) pitar();
      }
      conocidos = new Map(lista.map((p) => [p.id, { modificado: Boolean(p.modificado) }]));
      pedidos = lista;
      $("conexion").textContent = "En vivo";
      dibujar();
    },
    (error) => {
      console.error(error);
      $("conexion").textContent = "Sin conexión con la base de datos";
    },
  );
}

function dejarDeEscuchar() {
  if (detener) detener();
  detener = null;
  conocidos = null;
  pedidos = [];
  dibujar();
}

// Ventana de edición: solo se cierra con «Cancelar» o la ✕ (no al tocar fuera, para no perder cambios por error)
$("dlgEditar").addEventListener("click", (evento) => {
  if (evento.target.hasAttribute("data-cerrar")) { $("dlgEditar").close(); edicion = null; }
});
$("editGuardar").addEventListener("click", guardarEdicion);
$("editAgregar").addEventListener("click", mostrarCatalogo);
$("dlgEditar").addEventListener("cancel", () => { edicion = null; });

dibujar();
exigirSesion({ roles: ["caja", "dueno", "admin"], alEntrar: empezarAEscuchar, alSalir: dejarDeEscuchar });
