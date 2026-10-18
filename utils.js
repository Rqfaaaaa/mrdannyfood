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
