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

// This repo (and anything it publishes) is public, so full last names should never leave the
// coach's own browser. Abbreviates to first name + last initial, extending the initial only as far
// as needed to disambiguate two players who share both a first name and a last initial.
function abbreviatedLastName(player, allPlayers) {
  const last = player.lastName || '';
  if (!last) return last;

  let len = 1;
  while (len < last.length) {
    const candidate = last.slice(0, len).toLowerCase();
    const conflict = allPlayers.some(p =>
      p.id !== player.id &&
      p.firstName === player.firstName &&
      (p.lastName || '').toLowerCase().startsWith(candidate)
    );
    if (!conflict) break;
    len++;
  }
  return last.slice(0, len);
}

function publicDisplayName(player, allPlayers) {
  const initial = abbreviatedLastName(player, allPlayers);
  return initial ? `${player.firstName} ${initial}` : player.firstName;
}

// Fallback for a match entry whose roster player has since been removed — publishSnapshot() can
// no longer look up their record (or disambiguate against the current roster), but the entry's
// own stored displayName is still a full name typed in before the player was removed, so it must
// still be abbreviated rather than published as-is. Just initials whatever the last word is.
function abbreviateFreeTextName(displayName) {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length < 2) return displayName;
  const last = parts.pop();
  return `${parts.join(' ')} ${last.charAt(0)}`;
}
