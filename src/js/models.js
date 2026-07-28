// Shape helpers/constructors for the app's core entities.
// Plain objects — no classes, no build step, so these stay dependency-free.

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function newPlayer({ firstName, lastName, grade, active = true }) {
  return {
    id: makeId('player'),
    firstName,
    lastName,
    grade,
    active,
  };
}

function newCourse({ name, holePars, holeYardages = null, slope = null, rating = null, verified = false }) {
  return {
    id: makeId('course'),
    name,
    holePars,
    holeYardages,
    slope,
    rating,
    totalPar: holePars.reduce((sum, par) => sum + par, 0),
    verified,
  };
}

function newRound({ playerId, date, type, courseId = null, inlineHolePars = null, holeScores, putts = null, matchId = null }) {
  return {
    id: makeId('round'),
    playerId,
    date,
    type, // 'tryout' | 'practice' | 'match'
    courseId,
    inlineHolePars,
    holeScores,
    putts,
    matchId,
  };
}

function newMatch({ date, location, courseId = null, inlineHolePars = null, teams }) {
  return {
    id: makeId('match'),
    date,
    location,
    courseId,
    inlineHolePars,
    teams, // [{ id, name, isOwnTeam, players: [{ playerId?, displayName, holeScores[9], putts }] }]
  };
}

function newMatchTeam({ name, isOwnTeam = false, players = [] }) {
  return {
    id: makeId('team'),
    name,
    isOwnTeam,
    players,
  };
}
