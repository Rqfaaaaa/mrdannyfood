/* Acceso del personal: inicio de sesión + verificación del ROL.
   Cada pantalla dice qué roles puede usarla, por ejemplo:
   exigirSesion({ roles: ["caja", "dueno"], alEntrar, alSalir }) */

import { iniciarSesion, cerrarSesion, alCambiarSesion, obtenerRol } from "./firebase.js";
import { $ } from "./utils.js";

export function exigirSesion({ roles, alEntrar, alSalir }) {
  const ventana = $("dlgLogin");
  ventana.addEventListener("cancel", (e) => e.preventDefault()); // no se puede cerrar con Escape

  const mostrarError = (texto) => {
    $("loginError").textContent = texto;
    $("loginError").hidden = false;
  };

  $("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginError").hidden = true;
    try {
      await iniciarSesion($("loginCorreo").value.trim(), $("loginClave").value);
      $("loginClave").value = "";
    } catch (error) {
      console.error(error);
      mostrarError("Correo o contraseña incorrectos.");
    }
  });

  const botonSalir = $("botonSalir");
  if (botonSalir) {
    botonSalir.addEventListener("click", async () => {
      await cerrarSesion();
      // Fuera de personal.html, la salida lleva a la entrada única para elegir de nuevo
      if (!window.location.pathname.endsWith("personal.html")) window.location.href = "personal.html";
    });
  }

  // Se ejecuta cada vez que alguien entra o sale
  alCambiarSesion(async (usuario) => {
    if (!usuario) {
      alSalir?.();
      if (!ventana.open) ventana.showModal();
      return;
    }

    let rol = null;
    try {
      rol = await obtenerRol(usuario.uid);
    } catch (error) {
      console.error(error);
    }

    if (!roles.includes(rol)) {
      // Entró con una cuenta válida pero sin permiso para esta pantalla: se cierra su sesión
      mostrarError(rol
        ? "Tu usuario no tiene permiso para esta pantalla."
        : "Tu usuario todavía no tiene un rol asignado. Avísale al dueño.");
      await cerrarSesion();
      return;
    }

    if (ventana.open) ventana.close();
    alEntrar?.(usuario, rol);
  });
}
