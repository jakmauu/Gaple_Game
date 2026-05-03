"use strict";

const $ = (id) => document.getElementById(id);

const els = {
  lobbyPanel: $("lobbyPanel"),
  gamePanel: $("gamePanel"),
  playerName: $("playerName"),
  roomCode: $("roomCode"),
  createRoomBtn: $("createRoomBtn"),
  joinRoomBtn: $("joinRoomBtn"),
  roomBadge: $("roomBadge"),
  statusTitle: $("statusTitle"),
  dealLayer: $("dealLayer"),
  scoreA: $("scoreA"),
  scoreB: $("scoreB"),
  ruleHint: $("ruleHint"),
  numberTracker: $("numberTracker"),
  gameLog: $("gameLog"),
  leftEndpoint: $("leftEndpoint"),
  rightEndpoint: $("rightEndpoint"),
  boardChain: $("boardChain"),
  playerHand: $("playerHand"),
  turnHint: $("turnHint"),
  copyInviteBtn: $("copyInviteBtn"),
  leaveRoomBtn: $("leaveRoomBtn"),
  startBtn: $("startBtn"),
  startSoloBtn: $("startSoloBtn"),
  placeLeftBtn: $("placeLeftBtn"),
  placeRightBtn: $("placeRightBtn"),
  passBtn: $("passBtn"),
  roundBanner: $("roundBanner"),
  roundBannerTitle: $("roundBannerTitle"),
  roundBannerPoints: $("roundBannerPoints"),
  roundBannerDetail: $("roundBannerDetail"),
  roundReveal: $("roundReveal"),
  revealTitle: $("revealTitle"),
  revealTotal: $("revealTotal"),
  revealSubtitle: $("revealSubtitle"),
  revealSeats: $("revealSeats"),
  toast: $("toast")
};

const PIP_POSITIONS = {
  0: [],
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

const API_BASE_URL = normalizeApiBaseUrl(window.GAPLE_API_BASE_URL || "");

const app = {
  roomId: null,
  token: null,
  seat: null,
  state: null,
  selectedTileId: null,
  events: null,
  suppressClickUntil: 0,
  lastAnimatedMoveKey: null,
  lastDealRound: 0,
  lastRevealKey: null,
  scoreHoldKey: null,
  scoreHoldUntil: 0
};

bootstrap();

function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) els.roomCode.value = roomFromUrl.toUpperCase();

  const saved = loadSession();
  if (saved && (!roomFromUrl || saved.roomId === roomFromUrl.toUpperCase())) {
    app.roomId = saved.roomId;
    app.token = saved.token;
    app.seat = saved.seat;
    reconnectSavedSession();
  }

  els.createRoomBtn.addEventListener("click", createAndJoinRoom);
  els.joinRoomBtn.addEventListener("click", joinExistingRoom);
  els.startBtn.addEventListener("click", () => startGame(false));
  els.startSoloBtn.addEventListener("click", () => startGame(true));
  els.copyInviteBtn.addEventListener("click", copyInvite);
  els.leaveRoomBtn.addEventListener("click", leaveGame);
  els.placeLeftBtn.addEventListener("click", () => playSelectedSide("left"));
  els.placeRightBtn.addEventListener("click", () => playSelectedSide("right"));
  els.passBtn.addEventListener("click", passTurn);
}

async function reconnectSavedSession() {
  try {
    const data = await api(`/api/rooms/${app.roomId}?token=${encodeURIComponent(app.token)}`);
    app.state = data.state;
    showGame();
    connectEvents();
    render();
  } catch {
    clearSession();
    app.roomId = null;
    app.token = null;
    app.seat = null;
  }
}

async function createAndJoinRoom() {
  try {
    const created = await api("/api/rooms", { method: "POST", body: {} });
    app.roomId = created.roomId;
    await joinRoom(created.roomId, 0);
    toast(`Room ${created.roomId} dibuat. Bagikan invite kalau mau partner manusia.`);
  } catch (error) {
    toast(error.message || "Gagal membuat room.");
  }
}

async function joinExistingRoom() {
  const roomId = els.roomCode.value.trim().toUpperCase();
  if (!roomId) {
    toast("Isi kode room dulu.");
    return;
  }
  try {
    await joinRoom(roomId, 2);
    toast(`Masuk ke room ${roomId}.`);
  } catch (error) {
    toast(error.message || "Gagal join room.");
  }
}

async function joinRoom(roomId, preferredSeat) {
  const payload = {
    name: els.playerName.value.trim() || (preferredSeat === 0 ? "Player Utama" : "Partner"),
    preferredSeat
  };
  const joined = await api(`/api/rooms/${roomId}/join`, { method: "POST", body: payload });
  app.roomId = joined.roomId;
  app.token = joined.token;
  app.seat = joined.seat;
  app.state = joined.state;
  saveSession();
  history.replaceState(null, "", `?room=${encodeURIComponent(app.roomId)}`);
  showGame();
  connectEvents();
  render();
}

async function startGame(aiPartner) {
  try {
    const data = await api(`/api/rooms/${app.roomId}/start`, {
      method: "POST",
      body: { token: app.token, aiPartner }
    });
    app.state = data.state;
    render();
  } catch (error) {
    toast(error.message || "Gagal mulai game.");
  }
}

async function playSelectedSide(side) {
  if (!app.selectedTileId || !app.state) return;
  const legalForTile = app.state.legalMoves.filter((move) => move.tileId === app.selectedTileId);
  let move = legalForTile.find((item) => item.side === side);
  if (!move) {
    toast("Ujung itu tidak cocok untuk kartu yang dipilih.");
    return;
  }

  try {
    await api(`/api/rooms/${app.roomId}/action`, {
      method: "POST",
      body: {
        token: app.token,
        action: {
          type: "play",
          seat: app.seat,
          tileId: app.selectedTileId,
          side: move.side
        }
      }
    });
    app.selectedTileId = null;
  } catch (error) {
    toast(error.message || "Move ditolak server.");
  }
}

async function passTurn() {
  if (!app.state || app.state.currentTurn !== app.seat) return;
  if (app.state.legalMoves.length > 0) {
    const confirmed = window.confirm("Kamu masih punya kartu legal. PASS akan dianggap PASS salah dan lawan mendapat 1 skor besar. Lanjut?");
    if (!confirmed) return;
  }

  try {
    await api(`/api/rooms/${app.roomId}/action`, {
      method: "POST",
      body: {
        token: app.token,
        action: { type: "pass", seat: app.seat }
      }
    });
  } catch (error) {
    toast(error.message || "PASS ditolak server.");
  }
}

async function leaveGame() {
  if (!app.roomId || !app.token) {
    returnToLobby();
    return;
  }

  if (app.state?.status === "playing") {
    const confirmed = window.confirm("Keluar dari game? Seat kamu akan diambil alih bot supaya game tidak macet.");
    if (!confirmed) return;
  }

  const roomId = app.roomId;
  const token = app.token;
  if (app.events) {
    app.events.close();
    app.events = null;
  }

  try {
    await api(`/api/rooms/${roomId}/leave`, {
      method: "POST",
      body: { token }
    });
  } catch {
    // Tetap keluar dari layar lokal kalau room sudah hilang atau token kedaluwarsa.
  }

  returnToLobby("Kamu sudah keluar dari game.");
}

function connectEvents() {
  if (app.events) app.events.close();
  app.events = new EventSource(apiUrl(`/events?roomId=${encodeURIComponent(app.roomId)}&token=${encodeURIComponent(app.token)}`));
  app.events.addEventListener("state", (event) => {
    const data = JSON.parse(event.data);
    app.state = data.state;
    if (!app.state.playableTileIds.includes(app.selectedTileId)) app.selectedTileId = null;
    render();
  });
  app.events.onerror = () => {
    toast("Koneksi real-time terputus. Browser akan mencoba reconnect.");
  };
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function apiUrl(path) {
  if (!API_BASE_URL) return path;
  const normalizedPath = String(path || "").startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function normalizeApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function render() {
  const state = app.state;
  if (!state) return;
  prepareScoreRevealTiming(state);
  const scores = displayScores(state);

  els.roomBadge.textContent = state.roomId;
  els.statusTitle.textContent = statusText(state);
  els.scoreA.textContent = `${scores.A.big} besar - ${scores.A.small} kecil`;
  els.scoreB.textContent = `${scores.B.big} besar - ${scores.B.small} kecil`;
  els.ruleHint.textContent = ruleText(state);

  renderSeats(state);
  maybeAnimateDeal(state);
  renderNumberTracker(state);
  renderBoard(state);
  renderHand(state);
  renderLog(state);
  renderRoundBanner(state);
  renderRoundReveal(state);
  renderControls(state);
}

function prepareScoreRevealTiming(state) {
  const reveal = state.roundReveal;
  if (!reveal || !state.roundResult?.scoreBefore) return;
  const key = `${state.roundNumber}:${reveal.loserTeam}:${reveal.losingPips}:${reveal.totalCards}`;
  if (app.scoreHoldKey === key) return;
  app.scoreHoldKey = key;
  app.scoreHoldUntil = Date.now() + 1450;
  window.setTimeout(() => {
    if (app.scoreHoldKey === key) render();
  }, 1480);
}

function displayScores(state) {
  if (
    state.roundResult?.scoreBefore
    && app.scoreHoldKey
    && Date.now() < app.scoreHoldUntil
  ) {
    return state.roundResult.scoreBefore;
  }
  return state.scores;
}

function statusText(state) {
  if (state.status === "waiting") return "Menunggu pemain dan start";
  if (state.status === "gameOver") return `Game selesai. Team ${state.gameResult?.winnerTeam} menang.`;
  if (state.status === "roundOver") return state.roundResult?.message || "Ronde selesai";
  const current = state.seats[state.currentTurn];
  return `Ronde ${state.roundNumber}: giliran ${current?.name || `Seat ${state.currentTurn}`}`;
}

function ruleText(state) {
  if (state.gameResult) return `Pemenang game: Team ${state.gameResult.winnerTeam}`;
  if (state.roundResult?.scoreApplied?.note) return state.roundResult.scoreApplied.note;
  if (state.openingRequirement?.label) return state.openingRequirement.label;
  if (state.status === "playing" && state.board.chain.length === 0) return "Board kosong. Pembuka mengikuti aturan set.";
  if (state.status === "playing") return "Cocokkan kartu ke ujung kiri atau kanan. PASS salah terkena penalti.";
  return "Buat room, join partner, lalu mulai.";
}

function renderSeats(state) {
  for (let seat = 0; seat < 4; seat += 1) {
    const player = state.seats[seat];
    const seatNode = document.querySelector(`.seat[data-seat="${seat}"]`);
    seatNode.classList.toggle("active", state.currentTurn === seat && state.status === "playing");
    $(`seat${seat}Name`).textContent = `${player.name} - Team ${player.team}`;
    const mine = seat === state.viewerSeat ? " (kamu)" : "";
    $(`seat${seat}Meta`).textContent = `${state.handCounts[seat]} kartu${mine}`;
    renderMiniHand($(`seat${seat}Mini`), state.handCounts[seat]);
  }
}

function renderMiniHand(container, count) {
  container.replaceChildren();
  container.style.setProperty("--count", count);
  for (let i = 0; i < count; i += 1) {
    const card = document.createElement("span");
    card.className = "mini-card";
    card.style.setProperty("--i", i);
    container.appendChild(card);
  }
  const badge = document.createElement("span");
  badge.className = "mini-count";
  badge.textContent = count;
  container.appendChild(badge);
}

function maybeAnimateDeal(state) {
  if (state.status !== "playing" || state.roundNumber <= 0 || app.lastDealRound === state.roundNumber) return;
  if (!state.handCounts.every((count) => count === 7)) return;

  app.lastDealRound = state.roundNumber;
  const table = document.querySelector(".felt-table");
  const tableRect = table.getBoundingClientRect();
  const center = { x: tableRect.width / 2, y: tableRect.height / 2 };
  els.dealLayer.replaceChildren();
  els.dealLayer.classList.add("dealing");

  let order = 0;
  for (let pass = 0; pass < 7; pass += 1) {
    for (const seat of [0, 1, 2, 3]) {
      const seatNode = document.querySelector(`.seat[data-seat="${seat}"]`);
      const rect = seatNode.getBoundingClientRect();
      const target = {
        x: rect.left - tableRect.left + rect.width / 2,
        y: rect.top - tableRect.top + rect.height / 2
      };
      const card = document.createElement("span");
      card.className = "deal-card";
      card.style.left = `${center.x}px`;
      card.style.top = `${center.y}px`;
      card.style.setProperty("--tx", `${target.x - center.x}px`);
      card.style.setProperty("--ty", `${target.y - center.y}px`);
      card.style.animationDelay = `${order * 55}ms`;
      els.dealLayer.appendChild(card);
      order += 1;
    }
  }

  window.setTimeout(() => {
    els.dealLayer.classList.remove("dealing");
    els.dealLayer.replaceChildren();
  }, order * 55 + 760);
}

function renderNumberTracker(state) {
  els.numberTracker.replaceChildren();
  for (let n = 0; n <= 6; n += 1) {
    const pill = document.createElement("div");
    pill.className = "number-pill";
    const strong = document.createElement("strong");
    strong.textContent = n;
    const small = document.createElement("span");
    small.textContent = `${state.playedNumberCounts[n] || 0}/7`;
    pill.append(strong, small);
    els.numberTracker.appendChild(pill);
  }
}

function renderBoard(state) {
  els.leftEndpoint.textContent = "";
  els.rightEndpoint.textContent = "";
  els.boardChain.replaceChildren();
  els.boardChain.classList.remove("compact", "dense", "micro");
  els.boardChain.style.removeProperty("--board-square");
  els.boardChain.style.removeProperty("--board-gap");
  els.boardChain.removeAttribute("data-drop-side");

  if (state.board.chain.length === 0) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = "Pilih kartu pembuka";
    const canStart = selectedMoves().some((move) => move.side === "start");
    els.boardChain.classList.toggle("drop-target", canStart);
    if (canStart) {
      els.boardChain.dataset.dropSide = "start";
      empty.dataset.dropSide = "start";
      empty.textContent = "Pilih kartu pembuka, lalu tekan tombol taruh";
    } else {
      els.boardChain.classList.remove("drop-target");
    }
    els.boardChain.appendChild(empty);
    return;
  }

  els.boardChain.classList.remove("drop-target");

  const layout = calculateBoardLayout(state.board.chain, els.boardChain);
  for (const [index, placement] of state.board.chain.entries()) {
    const spec = layout[index];
    const tileWrap = document.createElement("div");
    tileWrap.className = "board-tile";
    if (placement.side === "start") tileWrap.classList.add("start-tile");
    const sideTarget = boardSideForIndex(state, index);
    if (sideTarget) tileWrap.classList.add("drop-target", `drop-${sideTarget}`);
    tileWrap.style.left = `${spec.x}px`;
    tileWrap.style.top = `${spec.y}px`;
    tileWrap.style.setProperty("--angle", "0deg");
    tileWrap.style.zIndex = String(spec.z);

    const tileNode = createDomino(
      { a: spec.a, b: spec.b, id: placement.tile.id },
      { horizontal: spec.orientation === "horizontal", vertical: spec.orientation === "vertical" }
    );
    tileNode.classList.add("board-domino", spec.orientation);
    tileNode.tabIndex = -1;
    tileNode.title = `${state.seats[placement.seat]?.name || "Player"} memainkan [${placement.tile.a}|${placement.tile.b}]`;
    tileWrap.appendChild(tileNode);
    els.boardChain.appendChild(tileWrap);
    maybeAnimateOpponentMove(tileNode, placement, state);
  }
}

function maybeAnimateOpponentMove(tileNode, placement, state) {
  const move = state.lastMove;
  if (!move || move.type !== "play" || move.seat === state.viewerSeat) return;
  if (move.tile?.id !== placement.tile.id || move.seat !== placement.seat) return;

  const key = `${state.roundNumber}:${move.turn}:${move.seat}:${move.tile.id}`;
  if (app.lastAnimatedMoveKey === key) return;
  app.lastAnimatedMoveKey = key;

  const fromSeat = document.querySelector(`.seat[data-seat="${move.seat}"]`);
  if (!fromSeat) return;

  requestAnimationFrame(() => {
    const from = fromSeat.getBoundingClientRect();
    const to = tileNode.getBoundingClientRect();
    if (!to.width || !to.height) return;

    const ghost = tileNode.cloneNode(true);
    ghost.classList.add("opponent-fly-ghost");
    ghost.style.width = `${to.width}px`;
    ghost.style.height = `${to.height}px`;
    ghost.style.transform = `translate3d(${from.left + from.width / 2}px, ${from.top + from.height / 2}px, 0) translate(-50%, -50%) scale(0.72)`;
    document.body.appendChild(ghost);

    tileNode.classList.add("arriving-tile");
    requestAnimationFrame(() => {
      ghost.style.transform = `translate3d(${to.left + to.width / 2}px, ${to.top + to.height / 2}px, 0) translate(-50%, -50%) scale(1)`;
      ghost.style.opacity = "0.08";
    });

    window.setTimeout(() => {
      ghost.remove();
      tileNode.classList.remove("arriving-tile");
      tileNode.classList.add("landed-tile");
      window.setTimeout(() => tileNode.classList.remove("landed-tile"), 420);
    }, 520);
  });
}

function selectedMoves() {
  if (!app.selectedTileId || !app.state) return [];
  return app.state.legalMoves.filter((move) => move.tileId === app.selectedTileId);
}

function boardSideForIndex(state, index) {
  const moves = selectedMoves();
  if (moves.length === 0) return null;
  const canLeft = moves.some((move) => move.side === "left");
  const canRight = moves.some((move) => move.side === "right");
  const isLeftEnd = index === 0;
  const isRightEnd = index === state.board.chain.length - 1;

  if (isLeftEnd && canLeft && !(isRightEnd && canRight)) return "left";
  if (isRightEnd && canRight && !(isLeftEnd && canLeft)) return "right";
  if (state.board.chain.length === 1 && canLeft && !canRight) return "left";
  if (state.board.chain.length === 1 && canRight && !canLeft) return "right";
  return null;
}

function calculateBoardLayout(chain, container) {
  const width = container.clientWidth || 760;
  const height = container.clientHeight || 280;
  const styles = getComputedStyle(container);
  const cssSquare = parseFloat(styles.getPropertyValue("--board-square")) || 36;
  const cssGap = parseFloat(styles.getPropertyValue("--board-gap")) || 2;
  const narrow = width < 420 || window.matchMedia("(max-width: 760px)").matches;

  if (narrow) {
    const result = calculateMobileSnakeLayout(chain, width, height, cssSquare, cssGap);
    container.style.setProperty("--board-square", `${result.square}px`);
    container.style.setProperty("--board-gap", `${result.gap}px`);
    container.classList.toggle("compact", result.square <= cssSquare * 0.9);
    container.classList.toggle("dense", result.square <= cssSquare * 0.75);
    container.classList.toggle("micro", result.square <= cssSquare * 0.58);
    return result.layout;
  }

  const maxSquare = Math.min(cssSquare, narrow ? 30 : 42);
  const minSquare = narrow ? 16 : 24;
  const margin = narrow ? 5 : 10;
  let best = null;

  for (let square = maxSquare; square >= minSquare; square -= 1) {
    const candidate = buildBoardLayout(chain, width, height, square, cssGap, margin, narrow);
    if (!best || candidate.overflow < best.overflow) best = candidate;
    if (candidate.overflow <= 0) break;
  }

  const result = best || buildBoardLayout(chain, width, height, minSquare, cssGap, margin, narrow);
  container.style.setProperty("--board-square", `${result.square}px`);
  container.style.setProperty("--board-gap", `${result.gap}px`);
  container.classList.toggle("compact", result.square <= cssSquare * 0.9);
  container.classList.toggle("dense", result.square <= cssSquare * 0.78);
  container.classList.toggle("micro", result.square <= cssSquare * 0.64);
  return result.layout;
}

function calculateMobileSnakeLayout(chain, width, height, cssSquare, cssGap) {
  const maxSquare = Math.min(cssSquare, 26);
  const minSquare = 10;
  const margin = 6;
  let best = null;

  for (let square = maxSquare; square >= minSquare; square -= 1) {
    const maxRun = Math.max(3, Math.floor((width - margin * 2 + cssGap) / ((square * 2) + cssGap)));
    for (let run = Math.min(9, maxRun); run >= 3; run -= 1) {
      const candidate = buildCenteredMobileSnake(chain, width, height, square, cssGap, margin, run);
      if (!best || candidate.overflow < best.overflow || (candidate.overflow === best.overflow && candidate.square > best.square)) {
        best = candidate;
      }
      if (candidate.overflow <= 0) return candidate;
    }
  }

  return best || buildCenteredMobileSnake(chain, width, height, minSquare, 1, margin, 3);
}

function buildCenteredMobileSnake(chain, width, height, square, gap, margin, runLength) {
  const layout = [];
  let x = 0;
  let y = 0;
  let horizontal = "R";
  let inRow = 0;
  let direction = horizontal;

  for (let index = 0; index < chain.length; index += 1) {
    if (index > 0) {
      if (inRow >= runLength) {
        direction = "D";
        inRow = 0;
      } else {
        direction = horizontal;
      }

      const previous = layout[index - 1];
      const orientation = direction === "D" || direction === "U" ? "vertical" : "horizontal";
      const step = centerStep(previous.orientation, orientation, direction, square, gap);
      const unit = directionUnit(direction);
      x += unit.x * step;
      y += unit.y * step;

      if (direction === "D") {
        horizontal = horizontal === "R" ? "L" : "R";
      } else {
        inRow += 1;
      }
    } else {
      inRow = 1;
    }

    const placement = chain[index];
    const baseOrientation = direction === "D" || direction === "U" ? "vertical" : "horizontal";
    const orientation = placement.tile.double
      ? (baseOrientation === "horizontal" ? "vertical" : "horizontal")
      : baseOrientation;
    const visual = snakeVisualValues(placement, direction);
    layout[index] = {
      x,
      y,
      z: 80 - index,
      orientation,
      a: visual.a,
      b: visual.b
    };
  }

  centerBoardLayout(layout, width, height, square);

  return {
    layout,
    square,
    gap,
    overflow: boardOverflow(layout, width, height, square, margin)
  };
}

function centerStep(previousOrientation, nextOrientation, direction, square, gap) {
  const previousHalf = direction === "R" || direction === "L"
    ? (previousOrientation === "horizontal" ? square : square / 2)
    : (previousOrientation === "vertical" ? square : square / 2);
  const nextHalf = direction === "R" || direction === "L"
    ? (nextOrientation === "horizontal" ? square : square / 2)
    : (nextOrientation === "vertical" ? square : square / 2);
  return previousHalf + nextHalf + gap;
}

function snakeVisualValues(placement, direction) {
  if (direction === "L" || direction === "U") {
    return { a: placement.rightValue, b: placement.leftValue };
  }
  return { a: placement.leftValue, b: placement.rightValue };
}

function buildBoardLayout(chain, width, height, square, gap, margin, narrow) {
  const centerX = width / 2;
  const centerY = height / 2;
  const startIndex = Math.max(0, chain.findIndex((placement) => placement.side === "start"));
  const perRun = chooseSnakeRunLength(width, square, gap, margin, narrow);
  const verticalSpan = narrow ? 1 : Math.max(1, Math.min(3, Math.floor(height / (square * 7))));
  const layout = new Array(chain.length);

  layout[startIndex] = {
    x: centerX,
    y: centerY,
    z: 80,
    orientation: chain[startIndex].tile.double ? "vertical" : "horizontal",
    a: chain[startIndex].leftValue,
    b: chain[startIndex].rightValue
  };

  const rightIndexes = [];
  for (let index = startIndex + 1; index < chain.length; index += 1) rightIndexes.push(index);
  const leftIndexes = [];
  for (let index = startIndex - 1; index >= 0; index -= 1) leftIndexes.push(index);

  placeArm(layout, chain, rightIndexes, {
    arm: "right",
    firstConnection: { x: centerX + square / 2, y: centerY },
    directions: createArmDirections("right", rightIndexes.length, perRun, verticalSpan),
    square,
    gap
  });
  placeArm(layout, chain, leftIndexes, {
    arm: "left",
    firstConnection: { x: centerX - square / 2, y: centerY },
    directions: createArmDirections("left", leftIndexes.length, perRun, verticalSpan),
    square,
    gap
  });

  centerBoardLayout(layout, width, height, square);

  return {
    layout,
    square,
    gap,
    overflow: boardOverflow(layout, width, height, square, margin)
  };
}

function chooseSnakeRunLength(width, square, gap, margin, narrow) {
  const availableHalf = width / 2 - margin;
  const firstTileEdge = square * 2.5 + gap;
  const extraSpace = availableHalf - firstTileEdge;
  const extraTiles = extraSpace > 0 ? Math.floor(extraSpace / ((square * 2) + gap)) : 0;
  const maxRun = narrow ? 3 : 10;
  const minRun = narrow ? 1 : 2;
  return Math.max(minRun, Math.min(maxRun, 1 + extraTiles));
}

function boardOverflow(layout, width, height, square, margin) {
  const bounds = boardBounds(layout, square);
  if (!Number.isFinite(bounds.minX)) return 0;
  return Math.max(0, margin - bounds.minX)
    + Math.max(0, bounds.maxX - (width - margin))
    + Math.max(0, margin - bounds.minY)
    + Math.max(0, bounds.maxY - (height - margin));
}

function centerBoardLayout(layout, width, height, square) {
  const bounds = boardBounds(layout, square);
  if (!Number.isFinite(bounds.minX)) return;

  const offsetX = width / 2 - (bounds.minX + bounds.maxX) / 2;
  const offsetY = height / 2 - (bounds.minY + bounds.maxY) / 2;
  for (const item of layout) {
    if (!item) continue;
    item.x += offsetX;
    item.y += offsetY;
  }
}

function boardBounds(layout, square) {
  return layout.reduce((box, item) => {
    if (!item) return box;
    const horizontal = item.orientation === "horizontal";
    const halfWidth = horizontal ? square : square / 2;
    const halfHeight = horizontal ? square / 2 : square;
    box.minX = Math.min(box.minX, item.x - halfWidth);
    box.maxX = Math.max(box.maxX, item.x + halfWidth);
    box.minY = Math.min(box.minY, item.y - halfHeight);
    box.maxY = Math.max(box.maxY, item.y + halfHeight);
    return box;
  }, {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  });
}

function createArmDirections(arm, count, perRun, verticalSpan) {
  const directions = [];
  const horizontal = arm === "right" ? ["R", "L"] : ["L", "R"];
  const vertical = arm === "right" ? "D" : "U";
  let row = 0;

  while (directions.length < count) {
    const run = Math.min(perRun, count - directions.length);
    for (let i = 0; i < run; i += 1) directions.push(horizontal[row % 2]);
    for (let i = 0; i < verticalSpan && directions.length < count; i += 1) {
      directions.push(vertical);
    }
    row += 1;
  }

  return directions;
}

function placeArm(layout, chain, indexes, options) {
  let center = null;
  let lastDirection = options.arm === "right" ? "R" : "L";
  for (let i = 0; i < indexes.length; i += 1) {
    const index = indexes[i];
    const direction = options.directions[i];
    lastDirection = direction;
    const unit = directionUnit(direction);
    if (i === 0) {
      center = {
        x: options.firstConnection.x + unit.x * (options.square + options.gap),
        y: options.firstConnection.y + unit.y * (options.square + options.gap)
      };
    } else {
      center = {
        x: center.x + unit.x * ((options.square * 2) + options.gap),
        y: center.y + unit.y * ((options.square * 2) + options.gap)
      };
    }
    const visual = visualValuesForDirection(chain[index], options.arm, direction);
    const baseOrientation = direction === "R" || direction === "L" ? "horizontal" : "vertical";
    const orientation = chain[index].tile.double
      ? (baseOrientation === "horizontal" ? "vertical" : "horizontal")
      : baseOrientation;
    layout[index] = {
      x: center.x,
      y: center.y,
      z: 70 - Math.floor(i / 6),
      orientation,
      a: visual.a,
      b: visual.b
    };
  }
  return { center, lastDirection, count: indexes.length };
}

function directionUnit(direction) {
  if (direction === "R") return { x: 1, y: 0 };
  if (direction === "L") return { x: -1, y: 0 };
  if (direction === "D") return { x: 0, y: 1 };
  return { x: 0, y: -1 };
}

function visualValuesForDirection(placement, arm, direction) {
  const back = arm === "right" ? placement.leftValue : placement.rightValue;
  const front = arm === "right" ? placement.rightValue : placement.leftValue;
  if (direction === "R" || direction === "D") return { a: back, b: front };
  return { a: front, b: back };
}

function renderHand(state) {
  els.playerHand.replaceChildren();
  configureHandScale(state.hand?.length || 0);
  if (!Number.isInteger(state.viewerSeat)) return;

  for (const tile of state.hand) {
    const playable = state.playableTileIds.includes(tile.id) && state.currentTurn === state.viewerSeat && state.status === "playing";
    const selected = app.selectedTileId === tile.id;
    const tileNode = createDomino(tile, { playable, selected });
    tileNode.addEventListener("click", () => {
      if (Date.now() < app.suppressClickUntil) return;
      selectTile(tile, playable);
    });
    els.playerHand.appendChild(tileNode);
  }
}

function configureHandScale(count) {
  const handCount = Math.max(1, count);
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  const gap = mobile ? 5 : 10;
  const available = Math.max(180, els.playerHand.clientWidth || window.innerWidth) - 8;
  const maxWidth = mobile ? 52 : 64;
  const minWidth = mobile ? 28 : 48;
  const fittedWidth = Math.floor((available - gap * (handCount - 1)) / handCount);
  const tileWidth = Math.max(minWidth, Math.min(maxWidth, fittedWidth));

  els.playerHand.style.setProperty("--hand-count", handCount);
  els.playerHand.style.setProperty("--hand-gap", `${gap}px`);
  els.playerHand.style.setProperty("--hand-tile-w", `${tileWidth}px`);
  els.playerHand.style.setProperty("--hand-tile-h", `${Math.round(tileWidth * 1.82)}px`);
}

function selectTile(tile, playable) {
  if (!playable) {
    toast("Kartu ini belum bisa dimainkan.");
    return;
  }
  app.selectedTileId = app.selectedTileId === tile.id ? null : tile.id;
  const startMove = selectedMoves().find((move) => move.side === "start");
  if (startMove) {
    playSelectedSide("start");
    return;
  }
  render();
}

function renderControls(state) {
  const isWaiting = state.status === "waiting";
  const isMyTurn = state.status === "playing" && state.currentTurn === state.viewerSeat;
  const moves = selectedMoves();
  const canLeft = moves.some((move) => move.side === "left") || moves.some((move) => move.side === "start");
  const canRight = moves.some((move) => move.side === "right");

  els.startBtn.classList.toggle("hidden", !isWaiting);
  els.startSoloBtn.classList.toggle("hidden", !isWaiting);
  els.placeLeftBtn.classList.toggle("hidden", isWaiting || !isMyTurn);
  els.placeRightBtn.classList.toggle("hidden", isWaiting || !isMyTurn);
  els.placeLeftBtn.disabled = !isMyTurn || !app.selectedTileId || !canLeft;
  els.placeRightBtn.disabled = !isMyTurn || !app.selectedTileId || !canRight;
  els.passBtn.disabled = !isMyTurn;

  if (state.status === "waiting") {
    els.turnHint.textContent = "Bagikan invite atau mulai dengan Partner AI.";
  } else if (state.status === "roundOver") {
    els.turnHint.textContent = "Ronde selesai. Ronde berikutnya mulai otomatis.";
  } else if (state.status === "gameOver") {
    els.turnHint.textContent = `Team ${state.gameResult?.winnerTeam} menang game.`;
  } else if (isMyTurn) {
    els.turnHint.textContent = state.legalMoves.length
      ? "Giliranmu. Pilih kartu, lalu tekan tombol Taruh Kiri/Kanan."
      : "Giliranmu, tidak ada move legal. PASS aman.";
  } else {
    const current = state.seats[state.currentTurn];
    els.turnHint.textContent = `Menunggu ${current?.name || "player lain"}.`;
  }
}

function renderLog(state) {
  els.gameLog.replaceChildren();
  for (const line of state.logs.slice().reverse()) {
    const item = document.createElement("div");
    item.className = "log-line";
    item.textContent = line.text;
    els.gameLog.appendChild(item);
  }
}

function renderRoundBanner(state) {
  const result = state.roundResult;
  const show = Boolean(result && (state.status === "roundOver" || state.status === "gameOver"));
  els.roundBanner.classList.toggle("hidden", !show);
  if (!show) return;

  const pointInfo = roundPointInfo(result);
  els.roundBannerTitle.textContent = result.draw
    ? "GAPLE seri"
    : `Team ${result.winnerTeam} menang ronde`;
  els.roundBannerPoints.textContent = pointInfo.value;
  els.roundBannerDetail.textContent = pointInfo.detail;
}

function renderRoundReveal(state) {
  const reveal = state.roundReveal;
  const show = Boolean(reveal && (state.status === "roundOver" || state.status === "gameOver"));
  els.roundReveal.classList.toggle("hidden", !show);
  if (!show) {
    app.lastRevealKey = null;
    return;
  }

  const key = `${state.roundNumber}:${reveal.loserTeam}:${reveal.losingPips}:${reveal.totalCards}`;
  if (app.lastRevealKey === key) return;
  app.lastRevealKey = key;

  els.revealTitle.textContent = `Team ${reveal.loserTeam} membuka kartu`;
  els.revealSubtitle.textContent = `${reveal.totalCards} kartu tersisa dari tim kalah`;
  els.revealTotal.textContent = "0 poin";
  els.revealSeats.replaceChildren();

  for (const seatReveal of reveal.seats) {
    const card = document.createElement("div");
    card.className = "reveal-seat";
    const title = document.createElement("div");
    title.className = "reveal-seat-title";
    const name = document.createElement("strong");
    name.textContent = seatReveal.name;
    const meta = document.createElement("span");
    meta.textContent = `${seatReveal.count} kartu - ${seatReveal.total} poin`;
    title.append(name, meta);
    const tiles = document.createElement("div");
    tiles.className = "reveal-tiles";
    for (const tile of seatReveal.tiles) {
      const tileNode = createDomino(tile, { horizontal: true });
      tileNode.classList.add("reveal-domino");
      tileNode.tabIndex = -1;
      tiles.appendChild(tileNode);
    }
    card.append(title, tiles);
    els.revealSeats.appendChild(card);
  }

  animateRevealTotal(reveal.losingPips);
}

function animateRevealTotal(total) {
  const duration = 1150;
  const start = performance.now();
  const target = Number(total) || 0;

  function frame(now) {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    els.revealTotal.textContent = `${Math.round(target * eased)} poin`;
    if (progress < 1) requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function roundPointInfo(result) {
  if (Number.isFinite(result.losingPips)) {
    const smallScore = Math.floor(result.losingPips / 10);
    return {
      value: result.losingPips,
      detail: `Total poin Team ${result.loserTeam} kalah -> ${smallScore} skor kecil`
    };
  }

  if (result.kind === "gaple" && result.totals) {
    const loserTotal = result.loserTeam ? result.totals[result.loserTeam] : `${result.totals.A} / ${result.totals.B}`;
    return {
      value: loserTotal,
      detail: result.loserTeam ? `Total poin Team ${result.loserTeam} saat GAPLE` : "Total seri Team A / Team B"
    };
  }

  if (result.scoreApplied?.type === "pass-salah") {
    return { value: "+1", detail: "PASS salah: lawan dapat 1 skor besar" };
  }

  if (result.scoreApplied?.type === "tutup-6-6") {
    return { value: result.scoreApplied.big || 1, detail: "Tutup [6|6] masuk skor besar" };
  }

  if (result.scoreApplied?.type === "tutup-0-0") {
    const value = result.scoreApplied.big ? result.scoreApplied.big : result.scoreApplied.small;
    const unit = result.scoreApplied.big ? "skor besar" : "skor kecil";
    return { value, detail: `Tutup [0|0] masuk ${unit}` };
  }

  return { value: "0", detail: result.scoreApplied?.note || "Tidak ada skor masuk" };
}

function createDomino(tile, options = {}) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "domino";
  if (options.horizontal) node.classList.add("horizontal");
  if (options.vertical) node.classList.add("vertical");
  if (options.playable) node.classList.add("playable");
  if (options.selected) node.classList.add("selected");
  if (!options.playable && !options.horizontal && !options.vertical) node.classList.add("locked");
  node.dataset.tileId = tile.id;
  node.ariaLabel = `Domino ${tile.a} ${tile.b}`;

  const left = document.createElement("div");
  left.className = "half";
  left.appendChild(createPipGrid(tile.a));
  const divider = document.createElement("div");
  divider.className = "divider";
  const right = document.createElement("div");
  right.className = "half";
  right.appendChild(createPipGrid(tile.b));
  node.append(left, divider, right);
  return node;
}

function createPipGrid(value) {
  const grid = document.createElement("div");
  grid.className = "pip-grid";
  const positions = new Set(PIP_POSITIONS[value] || []);
  for (let i = 0; i < 9; i += 1) {
    const cell = document.createElement("span");
    if (positions.has(i)) cell.className = "pip";
    grid.appendChild(cell);
  }
  return grid;
}

async function copyInvite() {
  if (!app.roomId) return;
  const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(app.roomId)}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link disalin.");
  } catch {
    toast(url);
  }
}

function showGame() {
  els.lobbyPanel.classList.add("hidden");
  els.gamePanel.classList.remove("hidden");
}

function returnToLobby(message = "") {
  if (app.events) {
    app.events.close();
    app.events = null;
  }

  clearSession();
  app.roomId = null;
  app.token = null;
  app.seat = null;
  app.state = null;
  app.selectedTileId = null;
  app.lastAnimatedMoveKey = null;
  app.lastDealRound = 0;
  app.lastRevealKey = null;
  app.scoreHoldKey = null;
  app.scoreHoldUntil = 0;
  els.roomCode.value = "";
  els.gamePanel.classList.add("hidden");
  els.lobbyPanel.classList.remove("hidden");
  history.replaceState(null, "", window.location.pathname);
  if (message) toast(message);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function saveSession() {
  localStorage.setItem("gapleSession", JSON.stringify({
    roomId: app.roomId,
    token: app.token,
    seat: app.seat
  }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("gapleSession") || "null");
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem("gapleSession");
}
