/* Entrada única del personal: inicia sesión y te lleva a tu pantalla según tu rol. */

import { exigirSesion } from "./acceso.js";
import { $ } from "./utils.js";

// A dónde va cada rol. El dueño no está aquí: él elige entre las dos pantallas.
const DESTINO = { mesero: "mesero.html", caja: "pedidos.html" };

exigirSesion({
  roles: ["mesero", "caja", "dueno"],
  alEntrar: (usuario, rol) => {
    if (DESTINO[rol]) {
      $("mensaje").textContent = "Entrando a tu pantalla…";
      window.location.href = DESTINO[rol];
    } else {
      $("mensaje").textContent = "Hola. ¿A dónde quieres ir?";
      $("destinos").hidden = false;
    }
  },
  alSalir: () => {
    $("destinos").hidden = true;
    $("mensaje").textContent = "Inicia sesión para continuar.";
  },
});
