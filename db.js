/*
  Base de datos del historial de partidos - Patio Padel
  --------------------------------------------------------
  Versión sin dependencias nativas: guarda todo en un archivo JSON
  (partidos.json) en vez de usar SQLite. No necesita compilador C++,
  así que funciona en cualquier hosting sin instalar nada extra.

  Para un club de 2 canchas con uso normal, un archivo JSON es más
  que suficiente — no hace falta un motor de base de datos real.
*/

const fs = require("fs");
const path = require("path");

const ARCHIVO_DB = path.join(__dirname, "partidos.json");

function leerDatos() {
  if (!fs.existsSync(ARCHIVO_DB)) return { partidos: [], proximoId: 1 };
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_DB, "utf8"));
  } catch (e) {
    console.error("Error leyendo partidos.json, se arranca de cero:", e.message);
    return { partidos: [], proximoId: 1 };
  }
}

function guardarDatos(datos) {
  fs.writeFileSync(ARCHIVO_DB, JSON.stringify(datos, null, 2));
}

// ---------- Funciones que usa el servidor ----------
function crearPartido({ cancha, nombreA, nombreB, goldenPoint, bestOf, gamesPerSet, tiebreak, desempate, conteoModo }) {
  const datos = leerDatos();
  const id = datos.proximoId++;
  datos.partidos.push({
    id, cancha, nombre_a: nombreA, nombre_b: nombreB,
    golden_point: !!goldenPoint, best_of: bestOf, games_per_set: gamesPerSet,
    tiebreak: !!tiebreak, desempate, conteo_modo: conteoModo,
    fecha_inicio: new Date().toISOString(),
    fecha_fin: null, sets_a: 0, sets_b: 0, ganador: null,
    duracion_total_seg: null, sets: []
  });
  guardarDatos(datos);
  return id;
}

function agregarSet(partidoId, set) {
  const datos = leerDatos();
  const partido = datos.partidos.find(p => p.id === partidoId);
  if (!partido) return;
  partido.sets.push({
    numero_set: set.numeroSet,
    games_a: set.gamesA, games_b: set.gamesB,
    tb_a: set.tbA ?? null, tb_b: set.tbB ?? null,
    ganador: set.ganador, duracion_seg: set.duracionSeg
  });
  guardarDatos(datos);
}

function cerrarPartido(partidoId, { setsA, setsB, ganador, duracionTotalSeg }) {
  const datos = leerDatos();
  const partido = datos.partidos.find(p => p.id === partidoId);
  if (!partido) return;
  partido.fecha_fin = new Date().toISOString();
  partido.sets_a = setsA;
  partido.sets_b = setsB;
  partido.ganador = ganador;
  partido.duracion_total_seg = duracionTotalSeg;
  guardarDatos(datos);
}

function listarPartidos(limite = 100) {
  const datos = leerDatos();
  return [...datos.partidos]
    .sort((a, b) => new Date(b.fecha_inicio) - new Date(a.fecha_inicio))
    .slice(0, limite);
}

function obtenerPartido(id) {
  const datos = leerDatos();
  return datos.partidos.find(p => p.id === id) || null;
}

module.exports = { crearPartido, agregarSet, cerrarPartido, listarPartidos, obtenerPartido };
