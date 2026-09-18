/*
  Servidor del Marcador de Pádel - Patio Padel
  ---------------------------------------------
  Reemplaza al ESP32 como "servidor": ahora el ESP32 se conecta hacia
  afuera (como un cliente más) a este servidor, igual que lo hacen los
  celulares y la smart TV. Este servidor solo retransmite mensajes
  entre todos los que están conectados a la MISMA cancha (mismo
  código "cancha" en la URL) — no guarda base de datos ni hace nada
  más complejo que eso.

  Por qué así:
  - El ESP32 inicia la conexión (saliente), así que no hace falta
    abrir puertos en el router del club ni pelear con CGNAT.
  - Los celulares de los jugadores entran por una URL pública
    (https://tu-dominio/config?cancha=cancha1), sin necesidad de
    estar en el WiFi del club.
  - La TV abre una URL fija (https://tu-dominio/marcador?cancha=cancha1)
    que no cambia aunque el ESP32 cambie de IP o de red.

  Cómo correrlo:
    npm install
    node server.js
  (o desplegarlo en un servicio como Render, Railway, Fly.io, etc.)
*/

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const path = require("path");
const db = require("./db");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.use(express.json());

// ---------- Archivos estáticos (index.html, config.html) ----------
app.use(express.static(path.join(__dirname, "public")));

app.get("/marcador", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/config", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "config.html"));
});
app.get("/unirse", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "unirse.html"));
});
app.get("/historial", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "historial.html"));
});

// ---------- API de historial ----------
// Ruta temporal de diagnóstico: muestra en qué puerto interno escucha
// la app, para poder configurar el proxy de WebSocket en nginx.
// Se puede borrar una vez resuelto el tema del WebSocket.
app.get("/api/debug-puerto", (req, res) => {
  res.type("text/plain").send(
    "PORT: " + (process.env.PORT || "(no definido)") + "\n" +
    "Escuchando en: " + PUERTO
  );
});

app.get("/api/partidos", (req, res) => {
  const limite = parseInt(req.query.limite, 10) || 100;
  res.json(db.listarPartidos(limite));
});
app.get("/api/partidos/:id", (req, res) => {
  const partido = db.obtenerPartido(parseInt(req.params.id, 10));
  if (!partido) return res.status(404).json({ error: "No encontrado" });
  res.json(partido);
});

// ---------- Salas por cancha ----------
// Map<codigoCancha, Set<WebSocket>>
const salas = new Map();
// Map<codigoCancha, { id, }>  -> partido actualmente en curso en esa cancha
const partidosActivos = new Map();

function obtenerSala(codigo) {
  if (!salas.has(codigo)) salas.set(codigo, new Set());
  return salas.get(codigo);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const cancha = url.searchParams.get("cancha") || "sin-cancha";
  const sala = obtenerSala(cancha);
  sala.add(ws);
  ws.cancha = cancha;
  ws.vivo = true;
  ws.on("pong", () => { ws.vivo = true; });

  console.log(`+ Cliente conectado a "${cancha}" (${sala.size} en la sala)`);

  ws.on("message", (data) => {
    let mensaje;
    try {
      mensaje = JSON.parse(data.toString());
    } catch (e) {
      mensaje = null;
    }

    // ---------- Persistencia: guardar partidos y sets en la base ----------
    if (mensaje) {
      if (mensaje.tipo === "config") {
        // Se guardó una nueva configuración -> arranca un partido nuevo
        const id = db.crearPartido({
          cancha,
          nombreA: mensaje.nombreA, nombreB: mensaje.nombreB,
          goldenPoint: mensaje.goldenPoint, bestOf: mensaje.bestOf,
          gamesPerSet: mensaje.gamesPerSet, tiebreak: mensaje.tiebreak,
          desempate: mensaje.desempate, conteoModo: mensaje.conteoModo
        });
        partidosActivos.set(cancha, { id });
        console.log(`Partido #${id} iniciado en "${cancha}"`);
      } else if (mensaje.tipo === "set_completado") {
        const activo = partidosActivos.get(cancha);
        if (activo) {
          db.agregarSet(activo.id, mensaje);
        }
      } else if (mensaje.tipo === "partido_completado") {
        const activo = partidosActivos.get(cancha);
        if (activo) {
          db.cerrarPartido(activo.id, mensaje);
          partidosActivos.delete(cancha);
          console.log(`Partido #${activo.id} finalizado en "${cancha}"`);
        }
      }
    }

    // Retransmite el mensaje a todos los demás clientes de la MISMA cancha
    for (const cliente of sala) {
      if (cliente !== ws && cliente.readyState === cliente.OPEN) {
        cliente.send(data.toString());
      }
    }
  });

  ws.on("close", () => {
    sala.delete(ws);
    console.log(`- Cliente desconectado de "${cancha}" (${sala.size} restantes)`);
    if (sala.size === 0) salas.delete(cancha);
  });
});

const PUERTO = process.env.PORT || 3000;
server.listen(PUERTO, () => {
  console.log(`Servidor del marcador corriendo en el puerto ${PUERTO}`);
});

// ---------- Heartbeat ----------
// Render (y servicios similares) cortan las conexiones WebSocket que
// quedan sin tráfico un rato. Este ping cada 25s mantiene la conexión
// viva mientras nadie está tocando nada, y de paso descarta clientes
// que quedaron colgados sin avisar (ej: se cerró el navegador de golpe).
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.vivo === false) {
      console.log(`Cliente sin respuesta en "${ws.cancha}", cerrando conexión.`);
      return ws.terminate();
    }
    ws.vivo = false;
    ws.ping();
  });
}, 25000);
