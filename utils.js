/* Herramientas compartidas por todas las pantallas */

const formatoPesos = new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0,
});
export const pesos = (n) => formatoPesos.format(n);

export const $ = (id) => document.getElementById(id);

// Crea un elemento HTML de forma segura (el texto nunca se interpreta como código)
export function h(etiqueta, atributos = {}, ...hijos) {
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

// Código corto del pedido, fácil de leer en voz alta (sin letras que se confunden: I, O, 0, 1)
export function generarNumero() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 4; i++) codigo += letras[Math.floor(Math.random() * letras.length)];
  return codigo;
}

export function textoModalidad(pedido) {
  if (pedido.modalidad === "mesa") return "Mesa " + (pedido.mesa || "?");
  return { domicilio: "Domicilio", llevar: "Para llevar" }[pedido.modalidad] || pedido.modalidad;
}

/* ---------- Horario de servicio (hora de Colombia) ---------- */

export const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0]; // para mostrar de lunes a domingo

// "18:00" -> "6:00 PM"   ("24:00" o "00:00" -> "12:00 AM")
export function hora12(hhmm) {
  let [horas, minutos] = hhmm.split(":").map(Number);
  if (horas === 24) horas = 0;
  const sufijo = horas >= 12 ? "PM" : "AM";
  return `${horas % 12 || 12}:${String(minutos).padStart(2, "0")} ${sufijo}`;
}

// [1,2,3,4,5,6,0] -> "Todos los días";  [3,4,5,6,0] -> "Miércoles a domingo"
export function textoDias(dias) {
  const activos = ORDEN_DIAS.filter((d) => dias.includes(d));
  if (activos.length === 0) return "Sin días de servicio";
  if (activos.length === 7) return "Todos los días";
  const tramos = [];
  let tramo = [];
  for (const d of ORDEN_DIAS) {
    if (dias.includes(d)) tramo.push(d);
    else if (tramo.length) { tramos.push(tramo); tramo = []; }
  }
  if (tramo.length) tramos.push(tramo);
  return tramos.map((t) => {
    if (t.length === 1) return DIAS[t[0]];
    if (t.length === 2) return `${DIAS[t[0]]} y ${DIAS[t[1]]}`;
    return `${DIAS[t[0]]} a ${DIAS[t[t.length - 1]]}`;
  }).join(", ");
}

export const textoHorario = (hs) => `${textoDias(hs.dias)} · ${hora12(hs.desde)} a ${hora12(hs.hasta)}`;

const aMinutos = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

// Día de la semana y minutos transcurridos del día, en hora de Colombia (sin importar dónde esté el celular)
function ahoraEnBogota(fecha) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return {
    dia: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday")),
    minutos: Number(valor("hour")) * 60 + Number(valor("minute")),
  };
}

export function estaAbierto(hs, fecha = new Date()) {
  const { dia, minutos } = ahoraEnBogota(fecha);
  const desde = aMinutos(hs.desde);
  let hasta = aMinutos(hs.hasta);
  if (hasta === 0) hasta = 1440; // "00:00" y "24:00" significan medianoche
  if (hasta > desde) return hs.dias.includes(dia) && minutos >= desde && minutos < hasta;
  // El horario cruza la medianoche (por ejemplo 6:00 PM a 2:00 AM)
  return (hs.dias.includes(dia) && minutos >= desde) || (hs.dias.includes((dia + 6) % 7) && minutos < hasta);
}

// Frase para decirle al cliente cuándo vuelve el servicio
export function cuandoAbrimos(hs, fecha = new Date()) {
  const { dia, minutos } = ahoraEnBogota(fecha);
  const hora = hora12(hs.desde);
  if (hs.dias.includes(dia) && minutos < aMinutos(hs.desde)) return `hoy desde las ${hora} en adelante`;
  for (let i = 1; i <= 7; i++) {
    const d = (dia + i) % 7;
    if (hs.dias.includes(d)) {
      return i === 1 ? `mañana desde las ${hora} en adelante` : `el ${DIAS[d].toLowerCase()} desde las ${hora} en adelante`;
    }
  }
  return "muy pronto";
}
