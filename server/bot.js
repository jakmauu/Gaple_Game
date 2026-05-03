"use strict";

const engine = require("./engine");

const DEFAULT_PLAYOUTS_PER_MOVE = Number(process.env.GAPLE_MC || 300);
const MAX_ROLLOUT_TURNS = 80;

function chooseBotAction(state, seat, options = {}) {
  const legalMoves = engine.getLegalMoves(state, seat);
  if (legalMoves.length === 0) {
    return {
      type: "pass",
      seat,
      ai: {
        reason: "Tidak ada kartu legal.",
        legalMoves: 0
      }
    };
  }

  const playoutsPerMove = Number.isFinite(options.playoutsPerMove)
    ? options.playoutsPerMove
    : DEFAULT_PLAYOUTS_PER_MOVE;
  const rng = engine.createRng([
    state.roomId,
    state.roundNumber,
    state.turnNumber,
    seat,
    state.board.leftValue,
    state.board.rightValue,
    state.playedTileIds.join(",")
  ].join(":"));

  const candidates = legalMoves.map((move) => {
    const heuristic = moveHeuristic(state, seat, move);
    const monteCarlo = options.disableMonteCarlo
      ? { score: 0, wins: 0, losses: 0, draws: 0, playouts: 0 }
      : runMonteCarlo(state, seat, move, playoutsPerMove, rng);
    return {
      move,
      heuristic,
      monteCarlo,
      score: heuristic + monteCarlo.score
    };
  });

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  return {
    type: "play",
    seat,
    tileId: best.move.tileId,
    side: best.move.side,
    ai: {
      reason: describeMove(state, seat, best),
      legalMoves: legalMoves.length,
      selectedScore: round(best.score),
      heuristic: round(best.heuristic),
      monteCarlo: {
        score: round(best.monteCarlo.score),
        wins: best.monteCarlo.wins,
        losses: best.monteCarlo.losses,
        draws: best.monteCarlo.draws,
        playouts: best.monteCarlo.playouts
      },
      topMoves: candidates.slice(0, 3).map((candidate) => ({
        tileId: candidate.move.tileId,
        side: candidate.move.side,
        score: round(candidate.score)
      }))
    }
  };
}

function runMonteCarlo(state, seat, move, playoutsPerMove, rng) {
  const result = { score: 0, wins: 0, losses: 0, draws: 0, playouts: 0 };
  const team = engine.teamOfSeat(seat);
  const playouts = Math.max(0, Math.floor(playoutsPerMove));
  if (playouts === 0) return result;

  for (let i = 0; i < playouts; i += 1) {
    const belief = sampleBeliefState(state, seat, rng);
    const applied = engine.applyPlayerAction(belief, {
      type: "play",
      seat,
      tileId: move.tileId,
      side: move.side
    });
    if (!applied.ok) continue;

    rolloutRound(belief, rng);
    const score = evaluateSimulation(belief, team);
    result.score += score;
    result.playouts += 1;

    const winner = belief.roundResult?.winnerTeam || belief.gameResult?.winnerTeam;
    if (winner === team) result.wins += 1;
    else if (winner === engine.opponentTeam(team)) result.losses += 1;
    else result.draws += 1;
  }

  if (result.playouts > 0) result.score /= result.playouts;
  return result;
}

function sampleBeliefState(fullState, seat, rng) {
  const state = engine.clone(fullState);
  const ownIds = new Set(state.hands[seat].map((tile) => tile.id));
  const playedIds = new Set(state.playedTileIds);
  const unknown = engine.generateDeck().filter((tile) => !ownIds.has(tile.id) && !playedIds.has(tile.id));
  shuffle(unknown, rng);

  for (let s = 0; s < 4; s += 1) {
    if (s === seat) continue;
    const count = fullState.hands[s].length;
    state.hands[s] = unknown.splice(0, count);
  }
  state.hands[seat] = fullState.hands[seat].map((tile) => ({ ...tile }));
  return state;
}

function rolloutRound(state, rng) {
  let guard = 0;
  while (state.status === "playing" && guard < MAX_ROLLOUT_TURNS) {
    guard += 1;
    const seat = state.currentTurn;
    const legalMoves = engine.getLegalMoves(state, seat);
    if (legalMoves.length === 0) {
      engine.applyPlayerAction(state, { type: "pass", seat });
      continue;
    }

    const move = chooseRolloutMove(state, seat, legalMoves, rng);
    engine.applyPlayerAction(state, {
      type: "play",
      seat,
      tileId: move.tileId,
      side: move.side
    });
  }
}

function chooseRolloutMove(state, seat, legalMoves, rng) {
  if (rng() < 0.16) {
    return legalMoves[Math.floor(rng() * legalMoves.length)];
  }
  return legalMoves
    .map((move) => ({ move, score: moveHeuristic(state, seat, move) + rng() * 2 }))
    .sort((a, b) => b.score - a.score)[0].move;
}

function evaluateSimulation(state, team) {
  const enemy = engine.opponentTeam(team);
  let score = 0;

  if (state.gameResult?.winnerTeam === team) score += 320;
  if (state.gameResult?.winnerTeam === enemy) score -= 320;

  if (state.roundResult?.winnerTeam === team) score += 100;
  if (state.roundResult?.winnerTeam === enemy) score -= 100;

  score += (state.scores[team].big - state.scores[enemy].big) * 60;
  score += (state.scores[team].small - state.scores[enemy].small) * 6;
  score += (engine.totalTeamHandValue(state, enemy) - engine.totalTeamHandValue(state, team)) * 0.7;
  return score;
}

function moveHeuristic(state, seat, move) {
  const tile = move.tile;
  const team = engine.teamOfSeat(seat);
  const enemy = engine.opponentTeam(team);
  const endpoints = endpointsAfterMove(state, move);
  let score = 0;

  score += tile.value * 1.45;
  if (tile.double) score += 4 + tile.value * 0.25;

  if ((state.hands[seat] ?? []).length === 1) {
    score += 120;
    if (tile.id === "6-6") score += 80;
    if (tile.id === "0-0") score += 45;
  }

  const remainingLeft = remainingNumberTiles(state, endpoints.left);
  const remainingRight = remainingNumberTiles(state, endpoints.right);
  score += (14 - remainingLeft - remainingRight) * 1.15;
  if (endpoints.left === endpoints.right) score += 4;

  const ownFollowUps = countNumberInHand(state.hands[seat], endpoints.left, tile.id)
    + countNumberInHand(state.hands[seat], endpoints.right, tile.id);
  score += ownFollowUps * 2.2;

  for (const pass of state.passHistory.slice(-8)) {
    const isEnemy = engine.teamOfSeat(pass.seat) === enemy;
    const isPartner = pass.seat === ((seat + 2) % 4);
    const repeatsWeakEndpoint = [endpoints.left, endpoints.right].includes(pass.leftValue)
      || [endpoints.left, endpoints.right].includes(pass.rightValue);

    if (isEnemy && repeatsWeakEndpoint) score += 7;
    if (isPartner && repeatsWeakEndpoint) score -= 5;
    if (isPartner && !repeatsWeakEndpoint) score += 2;
  }

  const ownAfterMove = engine.totalHandValue(state, seat) - engine.tileValueForScoring(state, tile);
  if (ownAfterMove <= 16) score += (14 - remainingLeft - remainingRight) * 0.8;
  if (tile.value >= 10) score += 3;

  return score;
}

function endpointsAfterMove(state, move) {
  const tile = move.tile;
  if (state.board.chain.length === 0 || move.side === "start") {
    return { left: tile.a, right: tile.b };
  }

  if (move.side === "left") {
    return {
      left: tile.a === state.board.leftValue ? tile.b : tile.a,
      right: state.board.rightValue
    };
  }

  return {
    left: state.board.leftValue,
    right: tile.a === state.board.rightValue ? tile.b : tile.a
  };
}

function remainingNumberTiles(state, number) {
  if (!Number.isInteger(number)) return 0;
  return Math.max(0, 7 - (state.playedNumberCounts[number] || 0));
}

function countNumberInHand(hand, number, excludingTileId = null) {
  if (!Number.isInteger(number)) return 0;
  return (hand ?? []).filter((tile) => tile.id !== excludingTileId && (tile.a === number || tile.b === number)).length;
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function describeMove(state, seat, candidate) {
  const tile = candidate.move.tile;
  const side = candidate.move.side === "start" ? "pembuka" : candidate.move.side;
  const mc = candidate.monteCarlo;
  const winRate = mc.playouts > 0 ? Math.round((mc.wins / mc.playouts) * 100) : 0;
  const pressure = state.passHistory.some((pass) => engine.teamOfSeat(pass.seat) !== engine.teamOfSeat(seat));
  const pressureText = pressure ? " sambil menekan pola PASS lawan" : "";
  return `Pilih [${tile.a}|${tile.b}] ke ${side}${pressureText}. Estimasi winrate simulasi ${winRate}%.`;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

module.exports = {
  chooseBotAction,
  moveHeuristic,
  runMonteCarlo
};
