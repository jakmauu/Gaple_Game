"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const bot = require("./bot");
const engine = require("./engine");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS || 1500);
const NEXT_ROUND_DELAY_MS = Number(process.env.NEXT_ROUND_DELAY_MS || 5600);
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS || "*");
const TEAM_SEATS = {
  A: [0, 2],
  B: [1, 3]
};
const BOT_NAMES_BY_SEAT = ["Bot Bawah", "Bot Kanan", "Bot Atas", "Bot Kiri"];

const rooms = new Map();

const server = http.createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true,
        service: "domino-gaple-2v2-online",
        uptime: Math.round(process.uptime())
      });
    }

    if (url.pathname === "/events") {
      return handleEvents(req, res, url);
    }

    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, res, url);
    }

    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 500, {
      ok: false,
      error: error.code || "INTERNAL_ERROR",
      message: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`Domino Gaple server listening on port ${PORT}`);
});

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;

  const allowedOrigin = getAllowedCorsOrigin(origin);
  if (!allowedOrigin) return;

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (allowedOrigin !== "*") {
    res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Origin"));
  }
}

function getAllowedCorsOrigin(origin) {
  if (ALLOWED_ORIGINS.has("*")) return "*";
  const normalized = normalizeOrigin(origin);
  return ALLOWED_ORIGINS.has(normalized) ? normalized : null;
}

function parseAllowedOrigins(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeOrigin)
      .filter(Boolean)
  );
}

function normalizeOrigin(origin) {
  const value = String(origin || "").trim();
  return value === "*" ? value : value.replace(/\/+$/, "");
}

function appendVary(current, value) {
  if (!current) return value;
  const values = String(current).split(",").map((item) => item.trim().toLowerCase());
  return values.includes(value.toLowerCase()) ? current : `${current}, ${value}`;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const room = createRoom();
    return sendJson(res, 201, { ok: true, roomId: room.id });
  }

  if (parts[0] !== "api" || parts[1] !== "rooms" || !parts[2]) {
    return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
  }

  const room = rooms.get(parts[2].toUpperCase());
  if (!room) {
    return sendJson(res, 404, {
      ok: false,
      error: "ROOM_NOT_FOUND",
      message: "Room tidak ditemukan. Buat room baru atau cek kode room."
    });
  }

  if (req.method === "GET" && parts.length === 3) {
    const token = url.searchParams.get("token");
    return sendJson(res, 200, { ok: true, state: publicStateFor(room, token) });
  }

  if (req.method === "POST" && parts[3] === "join") {
    const body = await readJsonBody(req);
    const joined = joinRoom(room, body);
    broadcast(room);
    return sendJson(res, 200, { ok: true, ...joined, state: publicStateFor(room, joined.token) });
  }

  if (req.method === "POST" && parts[3] === "start") {
    const token = getBearerOrBodyToken(req, await readJsonBody(req));
    const player = room.playersByToken.get(token);
    if (!player) return sendJson(res, 401, { ok: false, error: "BAD_TOKEN" });

    const body = req.cachedBody || {};
    if (body.aiPartner) fillAiPartner(room);
    const started = startRoom(room);
    if (!started.ok) return sendJson(res, 409, started);

    broadcast(room);
    scheduleBotIfNeeded(room);
    return sendJson(res, 200, { ok: true, state: publicStateFor(room, token) });
  }

  if (req.method === "POST" && parts[3] === "leave") {
    const body = await readJsonBody(req);
    const token = getBearerOrBodyToken(req, body);
    const result = leaveRoom(room, token);
    if (!result.ok) return sendJson(res, 200, { ok: true, left: false });
    if (!result.deleted) {
      broadcast(room);
      if (room.game.status === "roundOver") scheduleNextRound(room);
      scheduleBotIfNeeded(room);
    }
    return sendJson(res, 200, { ok: true, left: true, deleted: result.deleted });
  }

  if (req.method === "POST" && parts[3] === "next-round") {
    const body = await readJsonBody(req);
    const token = getBearerOrBodyToken(req, body);
    if (!room.playersByToken.has(token)) return sendJson(res, 401, { ok: false, error: "BAD_TOKEN" });
    const next = startNextRound(room);
    if (!next.ok) return sendJson(res, 409, next);
    broadcast(room);
    scheduleBotIfNeeded(room);
    return sendJson(res, 200, { ok: true, state: publicStateFor(room, token) });
  }

  if (req.method === "POST" && parts[3] === "action") {
    const body = await readJsonBody(req);
    const token = getBearerOrBodyToken(req, body);
    const player = room.playersByToken.get(token);
    if (!player) return sendJson(res, 401, { ok: false, error: "BAD_TOKEN" });

    const action = body.action || body;
    if (Number(action.seat) !== player.seat) {
      return sendJson(res, 403, { ok: false, error: "SEAT_MISMATCH" });
    }
    if (room.game.seats[player.seat].type !== "human") {
      return sendJson(res, 403, { ok: false, error: "BOT_SEAT" });
    }

    const result = engine.applyPlayerAction(room.game, action);
    if (!result.ok) return sendJson(res, 409, result);

    broadcast(room);
    if (room.game.status === "roundOver") scheduleNextRound(room);
    scheduleBotIfNeeded(room);
    return sendJson(res, 200, { ok: true, event: result.event, state: publicStateFor(room, token) });
  }

  return sendJson(res, 404, { ok: false, error: "NOT_FOUND" });
}

function createRoom() {
  let id;
  do {
    id = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(id));

  const game = engine.createGameState(id, `${id}:${Date.now()}`);

  const room = {
    id,
    game,
    playersByToken: new Map(),
    clients: new Map(),
    botTimer: null,
    nextRoundTimer: null
  };
  rooms.set(id, room);
  return room;
}

function joinRoom(room, body = {}) {
  if (room.game.status !== "waiting") {
    throw httpError(409, "GAME_ALREADY_STARTED", "Game sudah dimulai.");
  }

  const team = normalizeTeam(body.team);
  const preferredSeat = Number(body.preferredSeat);
  let seat = Number.isInteger(preferredSeat)
    && preferredSeat >= 0
    && preferredSeat <= 3
    && (!team || engine.teamOfSeat(preferredSeat) === team)
    && room.game.seats[preferredSeat].type !== "human"
    ? preferredSeat
    : null;

  if (seat === null) {
    const candidates = team ? TEAM_SEATS[team] : [0, 2, 1, 3];
    seat = candidates.find((candidate) => room.game.seats[candidate].type !== "human");
  }
  if (!Number.isInteger(seat)) {
    throw httpError(409, "TEAM_FULL", team ? `Team ${team} sudah penuh.` : "Room sudah penuh.");
  }

  const token = crypto.randomBytes(18).toString("base64url");
  const name = cleanName(body.name || `Player Team ${engine.teamOfSeat(seat)}`);
  engine.setSeat(room.game, seat, { name, type: "human", connected: true });
  room.playersByToken.set(token, { token, seat, name });
  engine.addLog(room.game, `${name} masuk Team ${engine.teamOfSeat(seat)} sebagai Seat ${seat}.`, "room");
  return { roomId: room.id, token, seat, team: engine.teamOfSeat(seat) };
}

function leaveRoom(room, token) {
  const player = room.playersByToken.get(token);
  if (!player) return { ok: false };

  const seat = player.seat;
  const previousSeat = room.game.seats[seat];
  const name = player.name || previousSeat?.name || `Seat ${seat}`;

  room.playersByToken.delete(token);
  closeClientResponses(room, token);

  if (room.game.status === "waiting") {
    engine.setSeat(room.game, seat, {
      name: previousSeat?.label || `Seat ${seat}`,
      type: "open",
      connected: false
    });
    engine.addLog(room.game, `${name} keluar dari room. Seat ${seat} kosong lagi.`, "room");
  } else if (room.game.status === "gameOver") {
    engine.setSeat(room.game, seat, { connected: false });
    engine.addLog(room.game, `${name} keluar setelah game selesai.`, "room");
  } else {
    engine.setSeat(room.game, seat, {
      name: seat === 0 ? "Bot Pengganti Bawah" : "Bot Pengganti Atas",
      type: "bot",
      connected: true
    });
    engine.addLog(room.game, `${name} keluar. Seat ${seat} diambil alih bot agar game tetap lanjut.`, "room");
  }

  if (room.playersByToken.size === 0) {
    closeRoom(room);
    return { ok: true, deleted: true };
  }

  return { ok: true, deleted: false };
}

function fillAiPartner(room) {
  fillOpenSeatsWithBots(room, "mode solo.");
}

function startRoom(room) {
  if (room.game.status !== "waiting") {
    return { ok: false, error: "ALREADY_STARTED", message: "Game sudah berjalan." };
  }
  if (!room.game.seats.some((seat) => seat.type === "human")) {
    return { ok: false, error: "NEED_USER", message: "Minimal satu pemain manusia harus join." };
  }
  fillOpenSeatsWithBots(room, "sebelum game dimulai.");
  return engine.startRound(room.game);
}

function fillOpenSeatsWithBots(room, reason) {
  for (let seat = 0; seat < 4; seat += 1) {
    if (room.game.seats[seat].type === "human" || room.game.seats[seat].type === "bot") continue;
    engine.setSeat(room.game, seat, {
      name: BOT_NAMES_BY_SEAT[seat],
      type: "bot",
      connected: true
    });
    engine.addLog(room.game, `Seat ${seat} diisi ${BOT_NAMES_BY_SEAT[seat]} ${reason}`, "room");
  }
}

function normalizeTeam(team) {
  const value = String(team || "").trim().toUpperCase();
  return value === "A" || value === "B" ? value : null;
}

function startNextRound(room) {
  if (room.game.status !== "roundOver") {
    return { ok: false, error: "ROUND_NOT_READY", message: "Ronde belum selesai." };
  }
  return engine.startRound(room.game);
}

function scheduleBotIfNeeded(room) {
  if (room.botTimer || room.game.status !== "playing") return;
  const seat = room.game.currentTurn;
  if (room.game.seats[seat]?.type !== "bot") return;
  const thinkingDelay = BOT_DELAY_MS + Math.min(1300, engine.getLegalMoves(room.game, seat).length * 180);

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.game.status !== "playing" || room.game.seats[room.game.currentTurn]?.type !== "bot") return;

    const botSeat = room.game.currentTurn;
    const action = bot.chooseBotAction(room.game, botSeat);
    const result = engine.applyPlayerAction(room.game, action);
    if (result.ok && action.ai?.reason) {
      engine.addLog(room.game, `${room.game.seats[botSeat].name}: ${action.ai.reason}`, "ai");
    }

    broadcast(room);
    if (room.game.status === "roundOver") scheduleNextRound(room);
    scheduleBotIfNeeded(room);
  }, thinkingDelay);
}

function scheduleNextRound(room) {
  if (room.nextRoundTimer || room.game.status !== "roundOver") return;
  room.nextRoundTimer = setTimeout(() => {
    room.nextRoundTimer = null;
    if (room.game.status !== "roundOver") return;
    engine.startRound(room.game);
    broadcast(room);
    scheduleBotIfNeeded(room);
  }, NEXT_ROUND_DELAY_MS);
}

function publicStateFor(room, token) {
  const player = room.playersByToken.get(token);
  return engine.getPublicState(room.game, player?.seat ?? null);
}

function broadcast(room) {
  for (const [token, responses] of room.clients.entries()) {
    const payload = JSON.stringify({ ok: true, state: publicStateFor(room, token) });
    for (const res of responses) {
      res.write(`event: state\n`);
      res.write(`data: ${payload}\n\n`);
    }
  }
}

function closeClientResponses(room, token) {
  const responses = room.clients.get(token);
  if (!responses) return;
  for (const res of responses) {
    res.end();
  }
  room.clients.delete(token);
}

function closeRoom(room) {
  if (room.botTimer) clearTimeout(room.botTimer);
  if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
  for (const token of room.clients.keys()) {
    closeClientResponses(room, token);
  }
  rooms.delete(room.id);
}

function handleEvents(req, res, url) {
  const roomId = (url.searchParams.get("roomId") || "").toUpperCase();
  const token = url.searchParams.get("token") || "";
  const room = rooms.get(roomId);
  if (!room || !room.playersByToken.has(token)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Room atau token tidak valid.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`retry: 1000\n\n`);

  if (!room.clients.has(token)) room.clients.set(token, new Set());
  room.clients.get(token).add(res);
  const initial = JSON.stringify({ ok: true, state: publicStateFor(room, token) });
  res.write(`event: state\n`);
  res.write(`data: ${initial}\n\n`);

  req.on("close", () => {
    const bucket = room.clients.get(token);
    if (!bucket) return;
    bucket.delete(res);
    if (bucket.size === 0) room.clients.delete(token);
  });
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = path.normalize(pathname).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, safePath);
  const publicRoot = path.resolve(PUBLIC_DIR);
  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[ext] || "application/octet-stream";
}

function readJsonBody(req) {
  if (req.cachedBody) return Promise.resolve(req.cachedBody);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(httpError(413, "BODY_TOO_LARGE", "Body terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        req.cachedBody = {};
        resolve(req.cachedBody);
        return;
      }
      try {
        req.cachedBody = JSON.parse(raw);
        resolve(req.cachedBody);
      } catch {
        reject(httpError(400, "BAD_JSON", "JSON tidak valid."));
      }
    });
    req.on("error", reject);
  });
}

function getBearerOrBodyToken(req, body = {}) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return body.token || "";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function cleanName(name) {
  return String(name).trim().replace(/\s+/g, " ").slice(0, 24) || "Player";
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
