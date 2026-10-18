/* =====================================================================
   Menú digital + pedidos (pantalla del cliente y pantalla del mesero)
   La misma lógica sirve para las dos; cambia según <body data-modo="...">.

   Orden del archivo:
   1. Configuración
   2. Estado
   3. Carrito
   4. Dibujar el menú
   5. Ventana de producto
   6. Ventana del carrito y envío del pedido
   7. Inicio
   ===================================================================== */

import { pesos, h, $, generarNumero } from "./utils.js";
import { crearPedido, escucharPedidos, actualizarPedido } from "./firebase.js";
import { exigirSesion } from "./acceso.js";

/* ---------- 1. Configuración ---------- */

const MODO = document.body.dataset.modo; // "cliente", "mesero" o "carta"

const CATEGORIA_ADICIONALES = "adicionales"; // no sale como sección: son opciones dentro de cada producto
const CATEGORIAS_SIN_OPCIONES = ["bebidas"];  // se agregan directo al carrito
const DOMICILIO_DESDE = 6000;                 // valor normal; según la distancia puede ser 7.000 u 8.000

// Horario (hora de Colombia). Días: 0 = domingo ... 6 = sábado
const HORARIO = { dias: [0, 3, 4, 5, 6], desde: "18:30", hasta: "23:00" };

const CLAVE_GUARDADO = "mrdanny-carrito-" + MODO;

// Cada pantalla solo conserva los campos que le corresponden
document.querySelectorAll("[data-solo]").forEach((el) => {
  if (el.dataset.solo !== MODO) el.remove();
});

/* ---------- 2. Estado ---------- */

let datos = null;            // contenido de menu.json
let carrito = [];            // [{ clave, id, nombre, precioUnidad, extras, nota, cantidad }]
let producto = null;
let extrasElegidos = new Set();
let cantidadProducto = 1;
let enviando = false;
let editando = null;         // pedido de mesa que el mesero está editando: { id, numero }
let pedidosMesa = [];        // pedidos de mesa activos (solo mesero)
let detener = null;          // función para dejar de escuchar pedidos

/* ---------- 3. Carrito ---------- */

function guardarCarrito() {
  if (editando) return;
  try { localStorage.setItem(CLAVE_GUARDADO, JSON.stringify(carrito)); } catch { /* sin guardado, no pasa nada */ }
}

function cargarCarrito() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_GUARDADO));
    if (Array.isArray(guardado)) carrito = guardado;
  } catch { carrito = []; }
}

function agregarAlCarrito(prod, extras, nota, cantidad) {
  const precioExtras = extras.reduce((suma, e) => suma + e.precio, 0);
  const nombresExtras = extras.map((e) => e.nombre).sort();
  const clave = [prod.id, nombresExtras.join("+"), nota.toLowerCase()].join("|");
  const existente = carrito.find((l) => l.clave === clave);
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.push({
      clave, id: prod.id, nombre: prod.nombre,
      precioUnidad: prod.precio + precioExtras,
      extras: nombresExtras, nota, cantidad,
    });
  }
  actualizarCarrito();
}

function cambiarCantidad(clave, delta) {
  const linea = carrito.find((l) => l.clave === clave);
  if (!linea) return;
  linea.cantidad += delta;
  if (linea.cantidad <= 0) carrito = carrito.filter((l) => l.clave !== clave);
  actualizarCarrito();
}

const itemsDelCarrito = () => carrito.map((l) => ({
  id: l.id, nombre: l.nombre, cantidad: l.cantidad, precioUnidad: l.precioUnidad, extras: l.extras, nota: l.nota,
}));

const totalCarrito = () => carrito.reduce((s, l) => s + l.precioUnidad * l.cantidad, 0);
const cantidadTotal = () => carrito.reduce((s, l) => s + l.cantidad, 0);

function actualizarCarrito() {
  guardarCarrito();
  const cant = cantidadTotal();
  $("barraCarrito").hidden = cant === 0;
  $("barraCantidad").textContent = cant;
  $("barraTotal").textContent = pesos(totalCarrito());
  dibujarCarrito();
}

/* ---------- 4. Dibujar el menú ---------- */

function dibujarMenu() {
  const menu = $("menu");
  const nav = $("categorias");
  menu.replaceChildren();
  nav.replaceChildren();

  const visibles = datos.categorias.filter((c) => c.id !== CATEGORIA_ADICIONALES);

  for (const cat of visibles) {
    nav.append(h("a", {
      href: "#cat-" + cat.id, "data-cat": cat.id,
      onclick: (e) => { e.preventDefault(); abrirCategoria(cat.id); },
    }, cat.nombre));

    const cuerpo = h("div", { class: "seccion__cuerpo" },
      cat.nota ? h("p", { class: "seccion__nota" }, cat.nota) : null,
    );
    for (const p of cat.productos) {
      const contenido = [
        h("span", { class: "producto__nombre" }, p.nombre),
        h("span", { class: "producto__precio" }, pesos(p.precio)),
        p.descripcion ? h("span", { class: "producto__desc" }, p.descripcion) : null,
      ];
      if (MODO === "carta") {
        // Carta para ver en la mesa: solo se lee, no se pide desde aquí
        cuerpo.append(h("div", { class: "producto producto--carta" }, ...contenido));
      } else {
        cuerpo.append(
          h("button", { class: "producto", type: "button", onclick: () => alTocarProducto(cat, p) },
            ...contenido,
            h("span", { class: "producto__mas", "aria-hidden": "true" }, "+"),
          ),
        );
      }
    }

    const cantidad = cat.productos.length;
    const seccion = h("details", { class: "seccion", id: "cat-" + cat.id, "data-cat": cat.id },
      h("summary", {},
        h("span", { class: "seccion__titulo" }, cat.nombre),
        h("span", { class: "seccion__cuenta" }, cantidad + (cantidad === 1 ? " opción" : " opciones")),
      ),
      cuerpo,
    );
    seccion.addEventListener("toggle", () => alAlternarCategoria(seccion));
    menu.append(seccion);
  }
}

function abrirCategoria(id) {
  document.querySelectorAll(".seccion").forEach((s) => { s.open = s.dataset.cat === id; });
  $("cat-" + id).scrollIntoView({ behavior: "smooth", block: "start" });
}

function alAlternarCategoria(seccion) {
  if (seccion.open) {
    document.querySelectorAll(".seccion[open]").forEach((s) => { if (s !== seccion) s.open = false; });
  }
  const abierta = document.querySelector(".seccion[open]");
  document.querySelectorAll("#categorias a").forEach((a) => {
    const activa = Boolean(abierta) && a.dataset.cat === abierta.dataset.cat;
    a.classList.toggle("activa", activa);
    if (activa) a.scrollIntoView({ inline: "center", block: "nearest" });
  });
}

function dibujarEstado() {
  const el = $("estado");
  if (!el) return; // en modo mesero no existe
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday"));
  const minutos = Number(valor("hour")) * 60 + Number(valor("minute"));
  const aMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  const abierto = HORARIO.dias.includes(dia) && minutos >= aMin(HORARIO.desde) && minutos < aMin(HORARIO.hasta);
  el.className = "estado " + (abierto ? "abierto" : "cerrado");
  el.textContent = abierto
    ? "Abierto ahora · hasta las 11:00 PM"
    : "Cerrado ahora · abrimos miércoles a domingo desde las 6:30 PM";
}

function dibujarPie() {
  const n = datos.negocio;
  $("pie").replaceChildren(
    h("p", {}, n.direccion),
    h("p", {}, n.horario),
    h("p", {}, "Instagram " + n.instagram),
  );
}

/* ---------- 5. Ventana de producto ---------- */

function alTocarProducto(categoria, p) {
  if (CATEGORIAS_SIN_OPCIONES.includes(categoria.id)) {
    agregarAlCarrito(p, [], "", 1);
    return;
  }
  abrirProducto(p);
}

function abrirProducto(p) {
  producto = p;
  extrasElegidos = new Set();
  cantidadProducto = 1;

  $("prodNombre").textContent = p.nombre;
  $("prodDescripcion").textContent = p.descripcion || "";
  $("prodNota").value = "";

  const adicionales = datos.categorias.find((c) => c.id === CATEGORIA_ADICIONALES);
  const contenedor = $("prodExtras");
  contenedor.replaceChildren();

  if (adicionales && adicionales.productos.length) {
    const lista = h("div", { class: "extras" }, h("h3", {}, "Adicionales"));
    for (const e of adicionales.productos) {
      const casilla = h("input", { type: "checkbox", id: "x-" + e.id });
      casilla.addEventListener("change", () => {
        casilla.checked ? extrasElegidos.add(e) : extrasElegidos.delete(e);
        actualizarBotonAgregar();
      });
      lista.append(
        h("div", { class: "extra" },
          h("label", { for: "x-" + e.id }, casilla, e.nombre),
          h("span", {}, "+ " + pesos(e.precio)),
        ),
      );
    }
    contenedor.append(lista);
  }

  actualizarBotonAgregar();
  $("dlgProducto").showModal();
}

function actualizarBotonAgregar() {
  $("prodCant").textContent = cantidadProducto;
  const extras = [...extrasElegidos].reduce((s, e) => s + e.precio, 0);
  $("prodAgregar").textContent = "Agregar · " + pesos((producto.precio + extras) * cantidadProducto);
}

/* ---------- 6. Ventana del carrito y envío del pedido ---------- */

function dibujarCarrito() {
  const lista = $("carLista");
  lista.replaceChildren();

  if (carrito.length === 0) {
    lista.append(h("p", { class: "vacio" }, "El pedido está vacío. Toca un producto del menú para agregarlo."));
  }

  for (const l of carrito) {
    const detalle = [
      l.extras.length ? "Con: " + l.extras.join(", ") : null,
      l.nota ? "Nota: " + l.nota : null,
    ].filter(Boolean).join(" · ");

    lista.append(
      h("div", { class: "linea" },
        h("div", { class: "linea__fila" },
          h("span", { class: "linea__nombre" }, l.cantidad + " × " + l.nombre),
          h("span", {}, pesos(l.precioUnidad * l.cantidad)),
        ),
        detalle ? h("p", { class: "linea__det" }, detalle) : null,
        h("div", { class: "linea__ctrl" },
          h("button", { type: "button", "aria-label": "Quitar uno", onclick: () => cambiarCantidad(l.clave, -1) }, "−"),
          h("button", { type: "button", "aria-label": "Agregar uno", onclick: () => cambiarCantidad(l.clave, 1) }, "+"),
        ),
      ),
    );
  }

  $("carTotal").textContent = pesos(totalCarrito());
  if (carrito.length === 0 && $("dlgCarrito").open) $("dlgCarrito").close();
}

const valor = (id) => ($(id) ? $(id).value.trim() : "");
const modalidadElegida = () => document.querySelector('input[name="modalidad"]:checked').value;
const pagoElegido = () => document.querySelector('input[name="pago"]:checked').value;

// Muestra solo los campos que corresponden (solo pantalla del cliente)
function ajustarCamposCliente() {
  const m = modalidadElegida();
  const domicilio = m === "domicilio";
  $("campoDireccion").hidden = !domicilio;
  $("campoPagaCon").hidden = !(domicilio && pagoElegido() === "Efectivo");
  $("avisoDomicilio").textContent = domicilio
    ? `El domicilio cuesta desde ${pesos(DOMICILIO_DESDE)} según la distancia. El restaurante te confirma el valor exacto por WhatsApp.`
    : "";
}

/* Reglas de confirmación:
   - Mesa: confirmado (el cliente está ahí).
   - Domicilio o para llevar con efectivo: confirmado (se paga al recibir).
   - Domicilio o para llevar con transferencia: pendiente hasta confirmar el pago. */
function estadoInicial(modalidad, pago) {
  if (modalidad === "mesa") return "confirmado";
  return pago === "Transferencia" ? "pendiente_pago" : "confirmado";
}

function mostrarError(texto) {
  const el = $("error");
  el.hidden = !texto;
  el.textContent = texto || "";
}

// Lee el formulario y arma el pedido. Si algo falta, muestra el error y devuelve null.
function armarPedido() {
  const nombre = valor("fNombre");
  let pedido;

  if (MODO === "mesero") {
    const mesa = valor("fMesa");
    if (!mesa) { mostrarError("Escribe el número de mesa."); return null; }
    pedido = { origen: "mesero", modalidad: "mesa", mesa, nombre, telefono: "", direccion: "", pago: "En mesa", pagaCon: null };
  } else {
    const modalidad = modalidadElegida();
    const pago = pagoElegido();
    const telefono = valor("fTelefono").replace(/\D/g, "");
    const direccion = modalidad === "domicilio" ? valor("fDireccion") : "";
    if (!nombre) { mostrarError("Escribe tu nombre."); return null; }
    if (telefono.length < 7) { mostrarError("Escribe un teléfono válido."); return null; }
    if (modalidad === "domicilio" && !direccion) { mostrarError("Escribe la dirección de entrega."); return null; }
    const pagaCon = modalidad === "domicilio" && pago === "Efectivo"
      ? Number(valor("fPagaCon").replace(/\D/g, "")) || null
      : null;
    pedido = { origen: "cliente", modalidad, mesa: "", nombre, telefono, direccion, pago, pagaCon };
  }

  pedido.items = itemsDelCarrito();
  pedido.totalProductos = totalCarrito();
  pedido.estado = estadoInicial(pedido.modalidad, pedido.pago);
  pedido.numero = generarNumero();
  return pedido;
}

// Mensaje de WhatsApp con el detalle completo del pedido
function mensajePedido(pedido) {
  const lineas = [`*Pedido #${pedido.numero} · ${datos.negocio.nombre}*`, ""];
  lineas.push(`Modalidad: ${pedido.modalidad === "domicilio" ? "Domicilio" : "Para llevar"}`);
  lineas.push(`Nombre: ${pedido.nombre}`, `Teléfono: ${pedido.telefono}`);
  if (pedido.direccion) lineas.push(`Dirección: ${pedido.direccion}`);
  lineas.push("", "*Pedido:*");
  for (const i of pedido.items) {
    lineas.push(`${i.cantidad} × ${i.nombre} — ${pesos(i.precioUnidad * i.cantidad)}`);
    if (i.extras.length) lineas.push(`   Con: ${i.extras.join(", ")}`);
    if (i.nota) lineas.push(`   Nota: ${i.nota}`);
  }
  lineas.push("", `*Total productos: ${pesos(pedido.totalProductos)}*`);
  if (pedido.modalidad === "domicilio") lineas.push(`Domicilio: aparte, desde ${pesos(DOMICILIO_DESDE)} según la distancia`);
  if (pedido.pago === "Transferencia") {
    lineas.push("Pago: transferencia (adjunto el comprobante en este chat)");
  } else {
    lineas.push(`Pago: efectivo${pedido.pagaCon ? ` (pago con ${pesos(pedido.pagaCon)})` : ""}`);
  }
  return lineas.join("\n");
}

const enlaceWhatsApp = (texto) => `https://wa.me/${datos.negocio.whatsapp}?text=${encodeURIComponent(texto)}`;

// Aviso sencillo (reutiliza la ventana de "pedido enviado")
function mostrarMensaje(titulo, texto) {
  $("listoTitulo").textContent = titulo;
  $("listoTexto").textContent = texto;
  $("listoWa").hidden = true;
  $("dlgListo").showModal();
}

async function enviarPedido(evento) {
  evento.preventDefault();
  if (enviando) return;
  mostrarError("");
  if (MODO === "cliente") $("respaldoWa").hidden = true;

  const modoEdicion = MODO === "mesero" && Boolean(editando);

  if (carrito.length === 0) {
    return mostrarError(modoEdicion
      ? "El pedido no puede quedar vacío. Para anularlo, usa «Cancelar pedido» en Mis pedidos."
      : "Agrega al menos un producto.");
  }
  if (modoEdicion && !valor("fMesa")) return mostrarError("Escribe el número de mesa.");

  const pedido = modoEdicion ? null : armarPedido();
  if (!modoEdicion && !pedido) return;

  enviando = true;
  const boton = $("botonEnviar");
  const textoBoton = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Enviando…";

  try {
    if (modoEdicion) {
      const numero = editando.numero;
      await actualizarPedido(editando.id, {
        items: itemsDelCarrito(),
        totalProductos: totalCarrito(),
        mesa: valor("fMesa"),
        nombre: valor("fNombre"),
      });
      salirDeEdicion();
      $("dlgCarrito").close();
      mostrarMensaje(`Pedido #${numero} actualizado`, "Caja verá que fue modificado y recibirá un aviso.");
    } else {
      await crearPedido(pedido);
      carrito = [];
      actualizarCarrito();
      $("dlgCarrito").close();
      $("formPedido").reset();
      if (MODO === "cliente") ajustarCamposCliente();
      mostrarListo(pedido);
    }
  } catch (error) {
    console.error(error);
    mostrarError(modoEdicion
      ? "No se pudo guardar el cambio. Revisa la conexión e inténtalo de nuevo."
      : "No se pudo enviar el pedido. Revisa tu conexión a internet e inténtalo de nuevo.");
    if (MODO === "cliente") {
      $("respaldoWa").href = enlaceWhatsApp(mensajePedido(pedido));
      $("respaldoWa").hidden = false;
    }
  } finally {
    enviando = false;
    boton.disabled = false;
    if (MODO === "mesero") mostrarModoEdicion(); else boton.textContent = textoBoton;
  }
}

// Pantalla de "pedido enviado"
function mostrarListo(pedido) {
  const titulo = $("listoTitulo");
  const texto = $("listoTexto");
  const wa = $("listoWa");
  wa.hidden = true;

  if (MODO === "mesero") {
    titulo.textContent = `Comanda #${pedido.numero} enviada`;
    texto.textContent = `Mesa ${pedido.mesa}. Ya aparece en la pantalla de pedidos.`;
    $("dlgListo").showModal();
    return;
  }

  titulo.textContent = `Pedido #${pedido.numero} registrado`;
  const parrafos = ["Tu pedido ya quedó registrado en el sistema del restaurante."];

  if (pedido.pago === "Transferencia") {
    const datosPago = datos.negocio.datosPago;
    parrafos.push(datosPago
      ? `Paga por transferencia a: ${datosPago}. El valor del domicilio (desde ${pesos(DOMICILIO_DESDE)}) se suma al total de los productos. Después envía el comprobante en el chat de WhatsApp.`
      : "Para pagar por transferencia, envíanos el pedido por WhatsApp y te damos los datos de pago ahí mismo.");
    parrafos.push("Empezamos a prepararlo cuando se confirme tu pago.");
  } else if (pedido.modalidad === "domicilio") {
    parrafos.push(`Ya lo estamos preparando. Pagas en efectivo al recibirlo: los productos y el domicilio (desde ${pesos(DOMICILIO_DESDE)}).`);
  } else {
    parrafos.push("Ya lo estamos preparando. Pagas al recogerlo.");
  }
  parrafos.push("Para tu seguridad, envíalo también por WhatsApp: el restaurante lo ve al instante y tú guardas el detalle de lo que pediste.");

  texto.textContent = parrafos.join("\n\n");
  wa.textContent = "Enviar mi pedido por WhatsApp";
  wa.href = enlaceWhatsApp(mensajePedido(pedido));
  wa.hidden = false;
  $("dlgListo").showModal();
}

/* ---------- Pedidos de mesa del mesero: ver, editar y cancelar ---------- */

const NOMBRE_ESTADO = { confirmado: "Recién enviado", preparando: "En preparación", listo: "Listo para servir" };
const EDITABLES = ["confirmado", "preparando"]; // hasta aquí el mesero puede cambiar el pedido (igual que en las reglas)

function empezarAEscuchar() {
  if (detener) return;
  detener = escucharPedidos(
    (lista) => {
      pedidosMesa = lista.filter((p) => p.modalidad === "mesa" && ["confirmado", "preparando", "listo"].includes(p.estado));
      $("cuentaPedidos").textContent = pedidosMesa.length;
      if ($("dlgMisPedidos").open) dibujarMisPedidos();
    },
    (error) => console.error(error),
  );
}

function dejarDeEscuchar() {
  if (detener) detener();
  detener = null;
  pedidosMesa = [];
  $("cuentaPedidos").textContent = "0";
}

function dibujarMisPedidos() {
  const lista = $("misPedidosLista");
  lista.replaceChildren();
  if (pedidosMesa.length === 0) {
    lista.append(h("p", { class: "vacio" }, "No hay pedidos de mesa activos."));
    return;
  }
  for (const p of pedidosMesa) {
    const editable = EDITABLES.includes(p.estado);
    lista.append(
      h("article", { class: "pedido pedido--" + p.estado },
        h("div", { class: "pedido__cabeza" },
          h("strong", { class: "pedido__numero" }, "#" + p.numero),
          h("span", { class: "pedido__tipo" }, "Mesa " + p.mesa),
          h("span", { class: "etiqueta etiqueta--" + p.estado }, NOMBRE_ESTADO[p.estado]),
        ),
        p.nombre ? h("p", { class: "pedido__cliente" }, p.nombre) : null,
        h("ul", { class: "pedido__items" },
          p.items.map((i) => h("li", {},
            h("span", {}, `${i.cantidad} × ${i.nombre}`),
            i.extras?.length ? h("small", {}, "Con: " + i.extras.join(", ")) : null,
            i.nota ? h("small", { class: "nota" }, "Nota: " + i.nota) : null,
          )),
        ),
        editable
          ? h("div", { class: "pedido__acciones" },
              h("button", { class: "boton", type: "button", onclick: () => empezarEdicion(p) }, "Editar"),
              h("button", { class: "boton-texto", type: "button", onclick: () => cancelarPedido(p) }, "Cancelar pedido"),
            )
          : null,
      ),
    );
  }
}

// Carga los productos del pedido en el carrito para poder cambiarlos
function empezarEdicion(p) {
  if (!editando && carrito.length > 0 &&
      !confirm(`Tienes productos sin enviar. ¿Reemplazarlos por los del pedido #${p.numero}?`)) return;

  editando = { id: p.id, numero: p.numero };
  carrito = p.items.map((i) => {
    const extras = i.extras || [];
    const nota = i.nota || "";
    const id = i.id || i.nombre;
    return {
      clave: [id, [...extras].sort().join("+"), nota.toLowerCase()].join("|"),
      id, nombre: i.nombre, precioUnidad: i.precioUnidad, extras, nota, cantidad: i.cantidad,
    };
  });
  $("fMesa").value = p.mesa;
  $("fNombre").value = p.nombre || "";
  $("dlgMisPedidos").close();
  mostrarModoEdicion();
  actualizarCarrito();
  $("dlgCarrito").showModal();
}

function mostrarModoEdicion() {
  const activo = Boolean(editando);
  $("avisoEdicion").hidden = !activo;
  $("cancelarEdicion").hidden = !activo;
  if (activo) {
    $("avisoEdicion").textContent = `Editando el pedido #${editando.numero}. Cambia lo que necesites y guarda: caja verá que fue modificado.`;
  }
  $("botonEnviar").textContent = activo ? "Guardar cambios" : "Enviar a caja";
}

function salirDeEdicion() {
  editando = null;
  carrito = [];
  $("formPedido").reset();
  mostrarModoEdicion();
  actualizarCarrito();
}

async function cancelarPedido(p) {
  if (!confirm(`¿Cancelar el pedido #${p.numero} de la mesa ${p.mesa}?`)) return;
  try {
    await actualizarPedido(p.id, { estado: "cancelado" });
  } catch (error) {
    console.error(error);
    alert("No se pudo cancelar. Revisa la conexión e inténtalo de nuevo.");
  }
}

/* ---------- 7. Inicio ---------- */

function conectarEventos() {
  if (MODO === "carta") return; // la carta no tiene carrito ni ventanas

  document.querySelectorAll("dialog").forEach((dlg) => {
    if (dlg.hasAttribute("data-fijo")) return; // el acceso del personal no se cierra tocando fuera
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.hasAttribute("data-cerrar")) dlg.close();
    });
  });

  $("prodMenos").addEventListener("click", () => {
    if (cantidadProducto > 1) { cantidadProducto--; actualizarBotonAgregar(); }
  });
  $("prodMas").addEventListener("click", () => { cantidadProducto++; actualizarBotonAgregar(); });

  $("prodAgregar").addEventListener("click", () => {
    agregarAlCarrito(producto, [...extrasElegidos], $("prodNota").value.trim(), cantidadProducto);
    $("dlgProducto").close();
  });

  $("barraCarrito").addEventListener("click", () => { dibujarCarrito(); $("dlgCarrito").showModal(); });

  if (MODO === "cliente") {
    document.querySelectorAll('input[name="modalidad"], input[name="pago"]')
      .forEach((r) => r.addEventListener("change", ajustarCamposCliente));
  }
  $("formPedido").addEventListener("submit", enviarPedido);
  $("vaciar").addEventListener("click", () => {
    if (editando) { salirDeEdicion(); return; }
    carrito = [];
    actualizarCarrito();
  });

  if (MODO === "mesero") {
    $("botonMisPedidos").addEventListener("click", () => { dibujarMisPedidos(); $("dlgMisPedidos").showModal(); });
    $("cancelarEdicion").addEventListener("click", () => { salirDeEdicion(); $("dlgCarrito").close(); });
  }
}

async function iniciar() {
  if (MODO === "mesero") {
    $("etiquetaNombre").textContent = "Nombre del cliente (opcional)";
    $("botonEnviar").textContent = "Enviar a caja";
    exigirSesion({
      roles: ["mesero", "dueno"],
      alEntrar: (usuario, rol) => {
        $("enlaceInicio").hidden = rol !== "dueno"; // solo el dueño puede pasar a la otra pantalla
        empezarAEscuchar();
      },
      alSalir: dejarDeEscuchar,
    });
  } else if (MODO === "cliente") {
    ajustarCamposCliente();
    dibujarEstado();
  }

  conectarEventos();

  try {
    const respuesta = await fetch("menu.json");
    if (!respuesta.ok) throw new Error("No se encontró menu.json");
    datos = await respuesta.json();
  } catch (error) {
    $("menu").replaceChildren(h("p", { class: "fallo" },
      "No se pudo cargar el menú. Revisa que menu.json esté en la misma carpeta y que abras la página con Live Server."));
    console.error(error);
    return;
  }
  dibujarMenu();
  dibujarPie();
  if (MODO !== "carta") {
    cargarCarrito();
    actualizarCarrito();
  }
}

iniciar();
