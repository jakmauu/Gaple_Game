"use strict";

const TEAM_BY_SEAT = ["A", "B", "A", "B"];
const SEAT_LABELS = ["User", "Bot Kanan", "Partner", "Bot Kiri"];
const MAX_SMALL_SCORE = 10;
const BIG_SCORE_TO_WIN = 3;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSeed(seed) {
  if (Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? Date.now());
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(state) {
  state.rngState = (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0;
  return state.rngState / 4294967296;
}

function createRng(seed) {
  const box = { rngState: normalizeSeed(seed) };
  return () => nextRandom(box);
}

function tileId(a, b) {
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  return `${left}-${right}`;
}

function createTile(a, b) {
  const left = Math.min(a, b);
  const right = Math.max(a, b);
  return {
    id: tileId(left, right),
    a: left,
    b: right,
    value: left + right,
    double: left === right
  };
}

function parseTileId(id) {
  const [a, b] = String(id).split("-").map(Number);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 6 || b > 6) {
    throw new Error(`Invalid tile id: ${id}`);
  }
  return createTile(a, b);
}

function generateDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a += 1) {
    for (let b = a; b <= 6; b += 1) {
      deck.push(createTile(a, b));
    }
  }
  return deck;
}

function shuffleWithState(deck, state) {
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function teamOfSeat(seat) {
  return TEAM_BY_SEAT[seat];
}

function opponentTeam(team) {
  return team === "A" ? "B" : "A";
}

function createSeats() {
  return SEAT_LABELS.map((label, seat) => ({
    seat,
    label,
    name: label,
    team: teamOfSeat(seat),
    type: seat === 0 || seat === 2 ? "open" : "bot",
    connected: false
  }));
}

function createGameState(roomId = "local", seed = Date.now()) {
  return {
    roomId,
    status: "waiting",
    rngState: normalizeSeed(seed),
    roundNumber: 0,
    turnNumber: 0,
    currentTurn: null,
    previousWinnerSeat: null,
    seats: createSeats(),
    scores: {
      A: { small: 0, big: 0 },
      B: { small: 0, big: 0 }
    },
    hands: [[], [], [], []],
    board: createEmptyBoard(),
    openingRequirement: null,
    playedTileIds: [],
    playedNumberCounts: createNumberCounts(),
    passStreak: 0,
    passHistory: [],
    lastMove: null,
    roundResult: null,
    gameResult: null,
    logs: []
  };
}

function createEmptyBoard() {
  return {
    leftValue: null,
    rightValue: null,
    chain: []
  };
}

function createNumberCounts() {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

function addLog(state, text, level = "info") {
  state.logs.push({
    turn: state.turnNumber,
    round: state.roundNumber,
    level,
    text,
    at: new Date().toISOString()
  });
  if (state.logs.length > 120) state.logs.splice(0, state.logs.length - 120);
}

function setSeat(state, seat, patch) {
  if (!state.seats[seat]) throw new Error(`Invalid seat ${seat}`);
  state.seats[seat] = { ...state.seats[seat], ...patch, team: teamOfSeat(seat), seat };
  return state.seats[seat];
}

function startRound(state) {
  if (state.status === "gameOver") {
    return { ok: false, code: "GAME_OVER", message: "Game sudah selesai." };
  }

  const isFirstRound = state.roundNumber === 0 && state.previousWinnerSeat === null;
  const upcomingRound = state.roundNumber + 1;
  let opening;
  let redealCount = 0;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    dealHands(state);
    opening = selectOpeningStarter(state, isFirstRound);
    if (opening.ok) break;
    redealCount += 1;
  }

  if (!opening?.ok) {
    return {
      ok: false,
      code: "OPENING_REDEAL_FAILED",
      message: "Tidak bisa menemukan pembuka valid setelah beberapa kali kocok ulang."
    };
  }

  state.roundNumber = upcomingRound;
  state.turnNumber = 0;
  state.board = createEmptyBoard();
  state.playedTileIds = [];
  state.playedNumberCounts = createNumberCounts();
  state.passStreak = 0;
  state.passHistory = [];
  state.lastMove = null;
  state.roundResult = null;
  state.status = "playing";

  state.currentTurn = opening.seat;
  state.openingRequirement = opening.requirement;

  if (redealCount > 0) {
    addLog(state, `Kocok ulang ${redealCount}x karena Team ${opening.team} belum punya balak pembuka.`, "round");
  }
  if (opening.takenByPartner) {
    addLog(state, `${seatDisplayName(state, opening.originalSeat)} tidak punya balak. Bandar diambil partner: ${seatDisplayName(state, opening.seat)}.`, "round");
  }
  addLog(state, `Ronde ${state.roundNumber} dimulai. Giliran ${seatDisplayName(state, state.currentTurn)}.`, "round");
  return { ok: true, state };
}

function dealHands(state) {
  const deck = shuffleWithState(generateDeck(), state);
  state.hands = [0, 1, 2, 3].map((seat) => {
    const hand = deck.slice(seat * 7, seat * 7 + 7);
    return sortHand(hand);
  });
}

function sortHand(hand) {
  return hand.slice().sort((x, y) => {
    if (x.double !== y.double) return x.double ? -1 : 1;
    if (y.value !== x.value) return y.value - x.value;
    return x.id.localeCompare(y.id);
  });
}

function findSeatWithTile(state, id) {
  return state.hands.findIndex((hand) => hand.some((tile) => tile.id === id));
}

function selectOpeningStarter(state, isFirstRound) {
  if (isFirstRound) {
    const starter = findSeatWithTile(state, "0-0");
    return {
      ok: true,
      seat: starter === -1 ? 0 : starter,
      team: starter === -1 ? "A" : teamOfSeat(starter),
      requirement: {
        kind: "exact",
        tileId: "0-0",
        label: "Set pertama wajib dibuka dengan [0|0]."
      }
    };
  }

  const originalSeat = Number.isInteger(state.previousWinnerSeat) ? state.previousWinnerSeat : 0;
  const partnerSeat = (originalSeat + 2) % 4;
  const team = teamOfSeat(originalSeat);

  if (seatHasDouble(state, originalSeat)) {
    return {
      ok: true,
      seat: originalSeat,
      originalSeat,
      team,
      requirement: {
        kind: "double",
        label: "Set lanjutan wajib dibuka dengan balak."
      }
    };
  }

  if (seatHasDouble(state, partnerSeat)) {
    return {
      ok: true,
      seat: partnerSeat,
      originalSeat,
      team,
      takenByPartner: true,
      requirement: {
        kind: "double",
        label: "Bandar tidak punya balak, partner mengambil alih pembuka."
      }
    };
  }

  return { ok: false, team, originalSeat, partnerSeat };
}

function seatHasDouble(state, seat) {
  return (state.hands[seat] ?? []).some((tile) => tile.double);
}

function seatDisplayName(state, seat) {
  const player = state.seats[seat];
  return player ? `${player.name} (Seat ${seat})` : `Seat ${seat}`;
}

function getLegalMoves(state, seat) {
  if (state.status !== "playing" || state.currentTurn !== seat) return [];
  const hand = state.hands[seat] ?? [];
  const moves = [];

  for (const tile of hand) {
    if (state.board.chain.length === 0) {
      if (state.openingRequirement?.kind === "exact" && tile.id !== state.openingRequirement.tileId) {
        continue;
      }
      if (state.openingRequirement?.kind === "double" && !tile.double) {
        continue;
      }
      moves.push(createMove(tile, "start"));
      continue;
    }

    const leftMatch = tile.a === state.board.leftValue || tile.b === state.board.leftValue;
    const rightMatch = tile.a === state.board.rightValue || tile.b === state.board.rightValue;
    if (leftMatch) moves.push(createMove(tile, "left"));
    if (rightMatch) moves.push(createMove(tile, "right"));
  }

  return moves;
}

function createMove(tile, side) {
  return {
    tileId: tile.id,
    tile,
    side,
    label: `[${tile.a}|${tile.b}] ${side}`
  };
}

function canSeatMove(state, seat) {
  const previousTurn = state.currentTurn;
  state.currentTurn = seat;
  const moves = getLegalMoves(state, seat);
  state.currentTurn = previousTurn;
  return moves.length > 0;
}

function applyPlayerAction(state, action) {
  if (!action || typeof action !== "object") {
    return { ok: false, code: "BAD_ACTION", message: "Action tidak valid." };
  }
  if (state.status !== "playing") {
    return { ok: false, code: "NOT_PLAYING", message: "Ronde belum aktif." };
  }

  const seat = Number(action.seat);
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
    return { ok: false, code: "BAD_SEAT", message: "Seat tidak valid." };
  }
  if (seat !== state.currentTurn) {
    return { ok: false, code: "NOT_TURN", message: "Belum giliran player ini." };
  }

  if (action.type === "pass") return passTurn(state, seat);
  if (action.type === "play") return playTurn(state, seat, action.tileId, action.side);

  return { ok: false, code: "UNKNOWN_ACTION", message: "Tipe action tidak dikenal." };
}

function passTurn(state, seat) {
  const legalMoves = getLegalMoves(state, seat);
  if (legalMoves.length > 0) {
    const winnerTeam = opponentTeam(teamOfSeat(seat));
    const winnerSeat = nextSeatInTeam((seat + 1) % 4, winnerTeam);
    const outcome = {
      kind: "wrong-pass",
      offenderSeat: seat,
      winnerSeat,
      winnerTeam,
      loserTeam: teamOfSeat(seat),
      message: `${seatDisplayName(state, seat)} PASS padahal masih punya kartu legal.`
    };
    applyPenaltyScore(state, outcome);
    finishRound(state, outcome);
    return { ok: true, state, event: outcome };
  }

  state.passStreak += 1;
  state.turnNumber += 1;
  state.passHistory.push({
    seat,
    team: teamOfSeat(seat),
    leftValue: state.board.leftValue,
    rightValue: state.board.rightValue,
    turn: state.turnNumber
  });
  state.lastMove = { type: "pass", seat, team: teamOfSeat(seat), turn: state.turnNumber };
  addLog(state, `${seatDisplayName(state, seat)} PASS.`, "pass");

  if (state.passStreak >= 4) {
    const outcome = createGapleOutcome(state);
    scoreRound(state, outcome);
    finishRound(state, outcome);
    return { ok: true, state, event: outcome };
  }

  advanceTurn(state);
  return { ok: true, state, event: state.lastMove };
}

function playTurn(state, seat, tileIdValue, requestedSide) {
  const legalMoves = getLegalMoves(state, seat);
  const matchingMoves = legalMoves.filter((move) => move.tileId === tileIdValue);
  const move = matchingMoves.find((item) => item.side === requestedSide)
    ?? (matchingMoves.length === 1 ? matchingMoves[0] : null);

  if (!move) {
    return {
      ok: false,
      code: "ILLEGAL_MOVE",
      message: "Kartu tidak cocok dengan ujung board atau melanggar aturan pembuka."
    };
  }

  const hand = state.hands[seat];
  const handIndex = hand.findIndex((tile) => tile.id === move.tileId);
  if (handIndex === -1) {
    return { ok: false, code: "NO_TILE", message: "Kartu tidak ada di tangan player." };
  }
  const [tile] = hand.splice(handIndex, 1);

  const placement = placeTileOnBoard(state, tile, move.side, seat);
  state.playedTileIds.push(tile.id);
  for (const n of new Set([tile.a, tile.b])) {
    state.playedNumberCounts[n] += 1;
  }

  state.turnNumber += 1;
  state.passStreak = 0;
  state.openingRequirement = null;
  state.lastMove = {
    type: "play",
    seat,
    team: teamOfSeat(seat),
    tile,
    side: move.side,
    placement,
    turn: state.turnNumber
  };
  addLog(state, `${seatDisplayName(state, seat)} main [${tile.a}|${tile.b}] ke ${move.side}.`, "play");

  if (state.hands[seat].length === 0) {
    const outcome = {
      kind: "empty",
      winnerSeat: seat,
      winnerTeam: teamOfSeat(seat),
      loserTeam: opponentTeam(teamOfSeat(seat)),
      lastTile: tile,
      message: `${seatDisplayName(state, seat)} habis kartu.`
    };
    scoreRound(state, outcome);
    finishRound(state, outcome);
    return { ok: true, state, event: outcome };
  }

  advanceTurn(state);
  return { ok: true, state, event: state.lastMove };
}

function placeTileOnBoard(state, tile, side, seat) {
  let leftValue;
  let rightValue;

  if (side === "start" || state.board.chain.length === 0) {
    leftValue = tile.a;
    rightValue = tile.b;
    state.board.leftValue = leftValue;
    state.board.rightValue = rightValue;
    const placement = createPlacement(tile, seat, side, leftValue, rightValue);
    state.board.chain.push(placement);
    return placement;
  }

  if (side === "left") {
    if (tile.a === state.board.leftValue) {
      leftValue = tile.b;
      rightValue = tile.a;
    } else {
      leftValue = tile.a;
      rightValue = tile.b;
    }
    state.board.leftValue = leftValue;
    const placement = createPlacement(tile, seat, side, leftValue, rightValue);
    state.board.chain.unshift(placement);
    return placement;
  }

  if (side === "right") {
    if (tile.a === state.board.rightValue) {
      leftValue = tile.a;
      rightValue = tile.b;
    } else {
      leftValue = tile.b;
      rightValue = tile.a;
    }
    state.board.rightValue = rightValue;
    const placement = createPlacement(tile, seat, side, leftValue, rightValue);
    state.board.chain.push(placement);
    return placement;
  }

  throw new Error(`Invalid side ${side}`);
}

function createPlacement(tile, seat, side, leftValue, rightValue) {
  return {
    tile,
    seat,
    team: teamOfSeat(seat),
    side,
    leftValue,
    rightValue
  };
}

function advanceTurn(state) {
  state.currentTurn = (state.currentTurn + 1) % 4;
}

function createGapleOutcome(state) {
  const totalA = totalTeamHandValue(state, "A");
  const totalB = totalTeamHandValue(state, "B");
  if (totalA === totalB) {
    return {
      kind: "gaple",
      draw: true,
      winnerSeat: null,
      winnerTeam: null,
      loserTeam: null,
      totals: { A: totalA, B: totalB },
      message: `GAPLE seri. Team A ${totalA}, Team B ${totalB}.`
    };
  }

  const winnerTeam = totalA < totalB ? "A" : "B";
  const loserTeam = opponentTeam(winnerTeam);
  const winnerSeat = findLowestSeatInTeam(state, winnerTeam);
  return {
    kind: "gaple",
    winnerSeat,
    winnerTeam,
    loserTeam,
    totals: { A: totalA, B: totalB },
    message: `GAPLE. Team ${winnerTeam} menang karena sisa pip lebih kecil.`
  };
}

function scoreRound(state, outcome) {
  if (!outcome || outcome.draw || !outcome.winnerTeam) {
    if (outcome) outcome.scoreApplied = { type: "draw", amount: 0 };
    return outcome;
  }

  const before = clone(state.scores);
  const zeroZeroBefore = isScoreZeroZero(state);

  if (outcome.kind === "wrong-pass") {
    applyPenaltyScore(state, outcome);
  } else if (outcome.kind === "empty" && outcome.lastTile?.id === "6-6") {
    const big = zeroZeroBefore ? 2 : 1;
    addBigScore(state, outcome.winnerTeam, big);
    outcome.scoreApplied = {
      type: "tutup-6-6",
      big,
      note: zeroZeroBefore ? "Skor masih 0-0, tutup [6|6] bernilai 2 skor besar." : "Tutup [6|6] bernilai 1 skor besar."
    };
  } else if (outcome.kind === "empty" && outcome.lastTile?.id === "0-0") {
    if (zeroZeroBefore) {
      addBigScore(state, outcome.winnerTeam, 1);
      outcome.scoreApplied = {
        type: "tutup-0-0",
        big: 1,
        note: "Skor masih 0-0, tutup [0|0] langsung 1 skor besar."
      };
    } else {
      outcome.scoreApplied = addSmallScore(state, outcome.winnerTeam, 5, "tutup-0-0");
      outcome.scoreApplied.type = "tutup-0-0";
      outcome.scoreApplied.note = "Tutup [0|0] bernilai 5 skor kecil.";
    }
  } else {
    const losingPips = totalTeamHandValue(state, outcome.loserTeam);
    outcome.losingPips = losingPips;

    if (zeroZeroBefore && losingPips < 20) {
      outcome.scoreApplied = {
        type: "belum-buka-poin",
        amount: 0,
        losingPips,
        note: "Total kalah di bawah 20 saat skor 0-0, jadi tidak dihitung."
      };
    } else {
      const small = Math.floor(losingPips / 10);
      outcome.scoreApplied = addSmallScore(state, outcome.winnerTeam, small, outcome.kind);
      outcome.scoreApplied.losingPips = losingPips;
      outcome.scoreApplied.rawSmall = small;
    }
  }

  outcome.scoreBefore = before;
  outcome.scoreAfter = clone(state.scores);
  checkGameWinner(state, outcome);
  return outcome;
}

function applyPenaltyScore(state, outcome) {
  if (!outcome.scoreBefore) outcome.scoreBefore = clone(state.scores);
  addBigScore(state, outcome.winnerTeam, 1);
  outcome.scoreApplied = {
    type: "pass-salah",
    big: 1,
    note: "PASS salah memberi lawan 1 skor besar."
  };
  outcome.scoreAfter = clone(state.scores);
  checkGameWinner(state, outcome);
}

function addSmallScore(state, team, amount, reason = "normal") {
  const applied = {
    type: reason,
    small: amount,
    bigFromSmall: 0,
    mutih: false,
    note: ""
  };

  if (amount <= 0) {
    applied.note = "Total pip belum menghasilkan skor kecil.";
    return applied;
  }

  state.scores[team].small += amount;
  const enemy = opponentTeam(team);
  if (state.scores[team].small >= MAX_SMALL_SCORE && !teamHasOpenedScore(state, enemy)) {
    state.scores[team].small = 0;
    state.scores[team].big += 2;
    applied.bigFromSmall = 2;
    applied.mutih = true;
    applied.note = "MUTIH: mencapai 10 kecil saat lawan belum buka skor, langsung 2 skor besar.";
    return applied;
  }

  if (state.scores[team].small >= MAX_SMALL_SCORE) {
    const big = Math.floor(state.scores[team].small / MAX_SMALL_SCORE);
    state.scores[team].small %= MAX_SMALL_SCORE;
    state.scores[team].big += big;
    applied.bigFromSmall = big;
    applied.note = `${MAX_SMALL_SCORE} skor kecil dikonversi menjadi ${big} skor besar.`;
  }

  return applied;
}

function addBigScore(state, team, amount) {
  state.scores[team].big += amount;
}

function teamHasOpenedScore(state, team) {
  return state.scores[team].small > 0 || state.scores[team].big > 0;
}

function isScoreZeroZero(state) {
  return !teamHasOpenedScore(state, "A") && !teamHasOpenedScore(state, "B");
}

function checkGameWinner(state, outcome) {
  for (const team of ["A", "B"]) {
    if (state.scores[team].big >= BIG_SCORE_TO_WIN) {
      state.status = "gameOver";
      state.gameResult = {
        winnerTeam: team,
        loserTeam: opponentTeam(team),
        reason: "big-score-target",
        scores: clone(state.scores)
      };
      if (outcome) outcome.gameResult = clone(state.gameResult);
      addLog(state, `Team ${team} menang game dengan ${state.scores[team].big} skor besar.`, "game");
      return;
    }
  }
}

function finishRound(state, outcome) {
  state.roundResult = outcome;
  if (state.status !== "gameOver") state.status = "roundOver";
  if (Number.isInteger(outcome.winnerSeat)) {
    state.previousWinnerSeat = outcome.winnerSeat;
  }
  addLog(state, outcome.message ?? "Ronde selesai.", "round");
}

function totalTeamHandValue(state, team) {
  return [0, 1, 2, 3]
    .filter((seat) => teamOfSeat(seat) === team)
    .reduce((sum, seat) => sum + totalHandValue(state, seat), 0);
}

function totalHandValue(state, seat) {
  return (state.hands[seat] ?? []).reduce((sum, tile) => sum + tileValueForScoring(state, tile), 0);
}

function tileValueForScoring(state, tileLike) {
  const tile = typeof tileLike === "string" ? parseTileId(tileLike) : tileLike;
  if (tile.id === "0-0" && isDeadDouble(state, 0)) return 25;
  if (tile.id === "6-6" && isDeadDouble(state, 6)) return 50;
  return tile.value;
}

function isDeadDouble(state, number) {
  const doubleId = tileId(number, number);
  if (state.playedTileIds.includes(doubleId)) return false;

  for (let other = 0; other <= 6; other += 1) {
    if (other === number) continue;
    if (!state.playedTileIds.includes(tileId(number, other))) return false;
  }

  if (state.board.leftValue === number || state.board.rightValue === number) return false;
  return true;
}

function findLowestSeatInTeam(state, team) {
  const seats = [0, 1, 2, 3].filter((seat) => teamOfSeat(seat) === team);
  return seats.sort((a, b) => totalHandValue(state, a) - totalHandValue(state, b))[0];
}

function nextSeatInTeam(startSeat, team) {
  for (let offset = 0; offset < 4; offset += 1) {
    const seat = (startSeat + offset) % 4;
    if (teamOfSeat(seat) === team) return seat;
  }
  return startSeat;
}

function getHandCounts(state) {
  return state.hands.map((hand) => hand.length);
}

function getPublicState(state, viewerSeat = null) {
  const hand = Number.isInteger(viewerSeat) ? state.hands[viewerSeat] ?? [] : [];
  const legalMoves = Number.isInteger(viewerSeat) ? getLegalMoves(state, viewerSeat) : [];
  return {
    roomId: state.roomId,
    status: state.status,
    roundNumber: state.roundNumber,
    turnNumber: state.turnNumber,
    currentTurn: state.currentTurn,
    previousWinnerSeat: state.previousWinnerSeat,
    viewerSeat,
    seats: state.seats,
    scores: state.scores,
    hand,
    handCounts: getHandCounts(state),
    legalMoves,
    playableTileIds: Array.from(new Set(legalMoves.map((move) => move.tileId))),
    board: state.board,
    openingRequirement: state.openingRequirement,
    playedNumberCounts: state.playedNumberCounts,
    passStreak: state.passStreak,
    passHistory: state.passHistory.slice(-12),
    lastMove: state.lastMove,
    roundResult: state.roundResult,
    roundReveal: getRoundReveal(state),
    gameResult: state.gameResult,
    logs: state.logs.slice(-18)
  };
}

function getRoundReveal(state) {
  const result = state.roundResult;
  if (!result || state.status === "playing" || state.status === "waiting" || !result.loserTeam) return null;

  const seats = [0, 1, 2, 3]
    .filter((seat) => teamOfSeat(seat) === result.loserTeam)
    .map((seat) => {
      const tiles = state.hands[seat] ?? [];
      return {
        seat,
        name: state.seats[seat]?.name ?? `Seat ${seat}`,
        team: teamOfSeat(seat),
        tiles,
        count: tiles.length,
        total: tiles.reduce((sum, tile) => sum + tileValueForScoring(state, tile), 0)
      };
    });

  return {
    winnerTeam: result.winnerTeam,
    loserTeam: result.loserTeam,
    losingPips: Number.isFinite(result.losingPips) ? result.losingPips : totalTeamHandValue(state, result.loserTeam),
    scoreApplied: result.scoreApplied,
    seats,
    totalCards: seats.reduce((sum, seat) => sum + seat.count, 0)
  };
}

module.exports = {
  BIG_SCORE_TO_WIN,
  MAX_SMALL_SCORE,
  TEAM_BY_SEAT,
  addLog,
  applyPlayerAction,
  canSeatMove,
  clone,
  createGameState,
  createRng,
  createTile,
  generateDeck,
  getLegalMoves,
  getPublicState,
  isDeadDouble,
  isScoreZeroZero,
  opponentTeam,
  parseTileId,
  scoreRound,
  selectOpeningStarter,
  setSeat,
  sortHand,
  startRound,
  teamOfSeat,
  tileId,
  tileValueForScoring,
  totalHandValue,
  totalTeamHandValue
};
