"use strict";

const assert = require("node:assert/strict");
const engine = require("../server/engine");

const t = engine.createTile;

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function playState() {
  const state = engine.createGameState("TEST", 123);
  state.status = "playing";
  state.roundNumber = 1;
  state.currentTurn = 0;
  state.board = {
    leftValue: 1,
    rightValue: 2,
    chain: [{ tile: t(1, 2), seat: 1, team: "B", side: "start", leftValue: 1, rightValue: 2 }]
  };
  state.openingRequirement = null;
  state.hands = [[], [], [], []];
  return state;
}

test("double-six deck has 28 unique tiles and each number appears on 7 tiles", () => {
  const deck = engine.generateDeck();
  assert.equal(deck.length, 28);
  assert.equal(new Set(deck.map((tile) => tile.id)).size, 28);

  for (let n = 0; n <= 6; n += 1) {
    const appearances = deck.filter((tile) => tile.a === n || tile.b === n).length;
    assert.equal(appearances, 7);
  }
});

test("first round is opened by whoever holds 0-0", () => {
  const state = engine.createGameState("OPEN", 456);
  engine.startRound(state);
  assert.equal(state.openingRequirement.kind, "exact");
  assert.equal(state.openingRequirement.tileId, "0-0");
  assert.ok(state.hands[state.currentTurn].some((tile) => tile.id === "0-0"));
  assert.deepEqual(engine.getLegalMoves(state, state.currentTurn).map((move) => move.tileId), ["0-0"]);
});

test("wrong pass gives opponent one big score", () => {
  const state = playState();
  state.hands[0] = [t(1, 5)];
  const result = engine.applyPlayerAction(state, { type: "pass", seat: 0 });
  assert.equal(result.ok, true);
  assert.equal(state.status, "roundOver");
  assert.equal(state.scores.B.big, 1);
  assert.equal(state.roundResult.kind, "wrong-pass");
});

test("opening score under 20 at 0-0 is ignored", () => {
  const state = playState();
  state.hands[0] = [t(1, 3)];
  state.hands[1] = [t(0, 6)];
  const result = engine.applyPlayerAction(state, { type: "play", seat: 0, tileId: "1-3", side: "left" });
  assert.equal(result.ok, true);
  assert.equal(state.scores.A.small, 0);
  assert.equal(state.scores.A.big, 0);
  assert.equal(state.roundResult.scoreApplied.type, "belum-buka-poin");
});

test("normal score uses floor(total / 10)", () => {
  const state = playState();
  state.scores.B.small = 1;
  state.hands[0] = [t(1, 3)];
  state.hands[1] = [t(6, 6), t(4, 5)];
  const result = engine.applyPlayerAction(state, { type: "play", seat: 0, tileId: "1-3", side: "left" });
  assert.equal(result.ok, true);
  assert.equal(state.roundResult.losingPips, 21);
  assert.equal(state.scores.A.small, 2);
});

test("closing with 6-6 at 0-0 gives two big scores", () => {
  const state = playState();
  state.board.leftValue = 6;
  state.board.rightValue = 2;
  state.hands[0] = [t(6, 6)];
  state.hands[1] = [t(4, 5)];
  const result = engine.applyPlayerAction(state, { type: "play", seat: 0, tileId: "6-6", side: "left" });
  assert.equal(result.ok, true);
  assert.equal(state.scores.A.big, 2);
  assert.equal(state.roundResult.scoreApplied.type, "tutup-6-6");
});

test("dead 0-0 is valued at 25 when every other zero is out and zero is closed", () => {
  const state = playState();
  state.board.leftValue = 1;
  state.board.rightValue = 2;
  state.playedTileIds = ["0-1", "0-2", "0-3", "0-4", "0-5", "0-6"];
  assert.equal(engine.isDeadDouble(state, 0), true);
  assert.equal(engine.tileValueForScoring(state, t(0, 0)), 25);
});

test("mutih converts reaching 10 small into two big scores when opponent has not opened", () => {
  const state = playState();
  state.scores.A.small = 9;
  state.hands[0] = [t(1, 3)];
  state.hands[1] = [t(4, 6)];
  const result = engine.applyPlayerAction(state, { type: "play", seat: 0, tileId: "1-3", side: "left" });
  assert.equal(result.ok, true);
  assert.equal(state.scores.A.small, 0);
  assert.equal(state.scores.A.big, 2);
  assert.equal(state.roundResult.scoreApplied.mutih, true);
});

test("next-round bandar passes to partner when winner has no double", () => {
  const state = engine.createGameState("BANDAR", 1);
  state.previousWinnerSeat = 0;
  state.hands = [
    [t(1, 2), t(2, 3)],
    [],
    [t(4, 4), t(1, 6)],
    []
  ];
  const opening = engine.selectOpeningStarter(state, false);
  assert.equal(opening.ok, true);
  assert.equal(opening.seat, 2);
  assert.equal(opening.takenByPartner, true);
});

test("next-round opening requests redeal when winner team has no double", () => {
  const state = engine.createGameState("REDEAL", 1);
  state.previousWinnerSeat = 1;
  state.hands = [
    [],
    [t(1, 2), t(2, 3)],
    [],
    [t(4, 5), t(0, 6)]
  ];
  const opening = engine.selectOpeningStarter(state, false);
  assert.equal(opening.ok, false);
  assert.equal(opening.team, "B");
});

console.log("All engine tests passed.");
