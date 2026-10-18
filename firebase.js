/* Conexión con Firebase (base de datos Firestore + inicio de sesión del personal).
   Los datos de firebaseConfig NO son una contraseña: solo indican a qué proyecto conectarse.
   Lo que protege los datos son las reglas de seguridad (archivo firestore.rules). */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp,
  query, orderBy, limit, onSnapshot, doc, updateDoc, getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFra1t_1CqfpFykd-UNTvEDdZZx6svA_U",
  authDomain: "mr-danny-food.firebaseapp.com",
  projectId: "mr-danny-food",
  storageBucket: "mr-danny-food.firebasestorage.app",
  messagingSenderId: "681985963009",
  appId: "1:681985963009:web:e86f2f3b1649aecb02bc00",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

/* ---------- Pedidos ---------- */

// Guarda un pedido nuevo. Se queda esperando la confirmación del servidor,
// por eso ponemos un límite de tiempo (si no hay internet, avisamos).
export function crearPedido(pedido, esperaMs = 12000) {
  const guardar = addDoc(collection(db, "pedidos"), { ...pedido, creadoEn: serverTimestamp() });
  const limiteDeTiempo = new Promise((_, rechazar) =>
    setTimeout(() => rechazar(new Error("Tiempo agotado: revisa la conexión a internet")), esperaMs));
  return Promise.race([guardar, limiteDeTiempo]);
}

// Escucha los últimos pedidos EN VIVO: cada cambio llama a "alCambiar" con la lista actualizada.
// Devuelve una función para dejar de escuchar.
export function escucharPedidos(alCambiar, alFallar) {
  const consulta = query(collection(db, "pedidos"), orderBy("creadoEn", "desc"), limit(100));
  return onSnapshot(
    consulta,
    (instantanea) => alCambiar(instantanea.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))),
    alFallar,
  );
}

export function cambiarEstado(idPedido, estado) {
  return updateDoc(doc(db, "pedidos", idPedido), { estado });
}

// El mesero cambia un pedido (productos, mesa, nombre o cancelarlo).
// Queda marcado como "modificado" para que caja se entere.
export function actualizarPedido(idPedido, cambios) {
  return updateDoc(doc(db, "pedidos", idPedido), { ...cambios, modificado: true });
}

// Caja confirma que ya vio la modificación
export function marcarRevisado(idPedido) {
  return updateDoc(doc(db, "pedidos", idPedido), { modificado: false });
}

/* ---------- Sesión y roles del personal ---------- */

// Cada persona del personal tiene un documento en la colección "personal" (con su UID como nombre)
// que dice su rol: "mesero", "caja" o "dueno". Devuelve el rol, o null si no tiene.
export async function obtenerRol(uid) {
  const documento = await getDoc(doc(db, "personal", uid));
  return documento.exists() ? documento.data().rol : null;
}


export const iniciarSesion = (correo, clave) => signInWithEmailAndPassword(auth, correo, clave);
export const cerrarSesion = () => signOut(auth);
export const alCambiarSesion = (funcion) => onAuthStateChanged(auth, funcion);
