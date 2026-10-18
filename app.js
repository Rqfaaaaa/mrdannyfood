/* =====================================================================
   Menú digital con pedidos por WhatsApp
   Orden del archivo:
   1. Configuración
   2. Utilidades (precios, crear elementos)
   3. Estado (los datos que cambian mientras se usa la página)
   4. Carrito (agregar, quitar, guardar)
   5. Dibujar el menú
   6. Ventana de producto
   7. Ventana del carrito y envío a WhatsApp
   8. Inicio
   ===================================================================== */

/* ---------- 1. Configuración ---------- */

// Categorías especiales según el "id" que tienen en menu.json
const CATEGORIA_ADICIONALES = "adicionales"; // no sale como sección: aparece como opciones dentro de cada producto
const CATEGORIAS_SIN_OPCIONES = ["bebidas"];  // se agregan directo, sin abrir la ventana de opciones

// Horario (hora de Colombia). Días: 0 = domingo ... 6 = sábado
const HORARIO = { dias: [0, 3, 4, 5, 6], desde: "18:30", hasta: "23:00" };

const CLAVE_GUARDADO = "mrdanny-carrito";

/* ---------- 2. Utilidades ---------- */

const formatoPesos = new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
});
const pesos = (n) => formatoPesos.format(n);

// Crea un elemento HTML de forma segura (el texto nunca se interpreta como código)
function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (clave === "class") el.className = valor;
    else if (clave.startsWith("on")) el.addEventListener(clave.slice(2), valor);
    else el.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(hijo));
  }
  return el;
}

const $ = (id) => document.getElementById(id);

/* ---------- 3. Estado ---------- */

let datos = null;          // contenido de menu.json
let carrito = [];          // [{ clave, id, nombre, precioUnidad, extras: [..], nota, cantidad }]
let producto = null;       // producto abierto en la ventana
let extrasElegidos = new Set();
let cantidadProducto = 1;

/* ---------- 4. Carrito ---------- */

function guardarCarrito() {
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
  // Si es exactamente lo mismo (producto + extras + nota), se suma la cantidad
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

/* ---------- 5. Dibujar el menú ---------- */

function dibujarMenu() {
  const menu = $("menu");
  const nav = $("categorias");
  menu.replaceChildren();
  nav.replaceChildren();

  const visibles = datos.categorias.filter((c) => c.id !== CATEGORIA_ADICIONALES);

  for (const cat of visibles) {
    nav.append(h("a", { href: "#cat-" + cat.id, "data-cat": cat.id }, cat.nombre));

    const seccion = h("section", { class: "seccion", id: "cat-" + cat.id },
      h("h2", {}, cat.nombre),
      cat.nota ? h("p", { class: "seccion__nota" }, cat.nota) : null,
    );

    for (const p of cat.productos) {
      seccion.append(
        h("button", { class: "producto", type: "button", onclick: () => alTocarProducto(cat, p) },
          h("span", { class: "producto__nombre" }, p.nombre),
          h("span", { class: "producto__precio" }, pesos(p.precio)),
          p.descripcion ? h("span", { class: "producto__desc" }, p.descripcion) : null,
          h("span", { class: "producto__mas", "aria-hidden": "true" }, "+"),
        ),
      );
    }
    menu.append(seccion);
  }

  resaltarCategoriaActiva();
}

// Marca en la barra la categoría que se está viendo mientras haces scroll
function resaltarCategoriaActiva() {
  const secciones = document.querySelectorAll(".seccion");
  const observador = new IntersectionObserver((entradas) => {
    for (const e of entradas) {
      if (!e.isIntersecting) continue;
      const id = e.target.id.replace("cat-", "");
      document.querySelectorAll("#categorias a").forEach((a) => {
        const activa = a.dataset.cat === id;
        a.classList.toggle("activa", activa);
        if (activa) a.scrollIntoView({ inline: "center", block: "nearest" });
      });
    }
  }, { rootMargin: "-20% 0px -70% 0px" });
  secciones.forEach((s) => observador.observe(s));
}

function dibujarEstado() {
  // Hora actual en Colombia, sin importar dónde esté el celular
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday"));
  const minutos = Number(valor("hour")) * 60 + Number(valor("minute"));
  const aMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

  const abierto = HORARIO.dias.includes(dia) && minutos >= aMin(HORARIO.desde) && minutos < aMin(HORARIO.hasta);
  const el = $("estado");
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

/* ---------- 6. Ventana de producto ---------- */

function alTocarProducto(categoria, p) {
  if (CATEGORIAS_SIN_OPCIONES.includes(categoria.id)) {
    agregarAlCarrito(p, [], "", 1); // bebidas: directo al carrito
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
  const total = (producto.precio + extras) * cantidadProducto;
  $("prodAgregar").textContent = "Agregar · " + pesos(total);
}

/* ---------- 7. Ventana del carrito y envío a WhatsApp ---------- */

function dibujarCarrito() {
  const lista = $("carLista");
  lista.replaceChildren();

  if (carrito.length === 0) {
    lista.append(h("p", { class: "vacio" }, "Tu pedido está vacío. Toca un producto del menú para agregarlo."));
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

const modalidadElegida = () => document.querySelector('input[name="modalidad"]:checked').value;
const pagoElegido = () => document.querySelector('input[name="pago"]:checked').value;

// Muestra solo los campos que corresponden a cada modalidad
function ajustarCamposModalidad() {
  const m = modalidadElegida();
  $("campoMesa").hidden = m !== "mesa";
  $("campoDireccion").hidden = m !== "domicilio";
  $("avisoDomicilio").hidden = m !== "domicilio";
}

function armarMensaje() {
  const m = modalidadElegida();
  const etiquetaModalidad = { mesa: "En el restaurante", domicilio: "Domicilio", llevar: "Para llevar" }[m];

  const lineas = [`*Pedido nuevo · ${datos.negocio.nombre}*`, ""];
  lineas.push(`Modalidad: ${etiquetaModalidad}`);
  lineas.push(`Nombre: ${$("fNombre").value.trim()}`);
  if (m === "mesa") lineas.push(`Mesa: ${$("fMesa").value.trim()}`);
  if (m === "domicilio") lineas.push(`Dirección: ${$("fDireccion").value.trim()}`);
  lineas.push("", "*Pedido:*");

  for (const l of carrito) {
    lineas.push(`${l.cantidad} × ${l.nombre} — ${pesos(l.precioUnidad * l.cantidad)}`);
    if (l.extras.length) lineas.push(`   Con: ${l.extras.join(", ")}`);
    if (l.nota) lineas.push(`   Nota: ${l.nota}`);
  }

  lineas.push("", `*Total productos: ${pesos(totalCarrito())}*`);
  if (m === "domicilio") lineas.push("(Domicilio por confirmar)");
  lineas.push(`Pago: ${pagoElegido()}`);
  return lineas.join("\n");
}

function mostrarError(texto) {
  const el = $("error");
  el.hidden = !texto;
  el.textContent = texto || "";
}

function enviarPedido(evento) {
  evento.preventDefault();
  mostrarError("");

  if (carrito.length === 0) return mostrarError("Agrega al menos un producto.");
  if (!$("fNombre").value.trim()) return mostrarError("Escribe tu nombre.");
  const m = modalidadElegida();
  if (m === "mesa" && !$("fMesa").value.trim()) return mostrarError("Escribe tu número de mesa.");
  if (m === "domicilio" && !$("fDireccion").value.trim()) return mostrarError("Escribe la dirección de entrega.");

  const url = `https://wa.me/${datos.negocio.whatsapp}?text=${encodeURIComponent(armarMensaje())}`;
  window.open(url, "_blank", "noopener");
}

/* ---------- 8. Inicio ---------- */

function conectarEventos() {
  // Cerrar ventanas con la X o tocando fuera
  document.querySelectorAll("dialog").forEach((dlg) => {
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

  document.querySelectorAll('input[name="modalidad"]').forEach((r) => r.addEventListener("change", ajustarCamposModalidad));
  $("formPedido").addEventListener("submit", enviarPedido);
  $("vaciar").addEventListener("click", () => { carrito = []; actualizarCarrito(); });
}

async function iniciar() {
  conectarEventos();
  ajustarCamposModalidad();
  dibujarEstado();
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
  cargarCarrito();
  actualizarCarrito();
}

iniciar();
