/**
 * Walking Path Utility
 *
 * Calculates meeting points and corridor-aware waypoints for agent movement
 * during collaborations. Agents walk toward each other when collaborating
 * and return to their home (desk) positions when done.
 */

export interface Point {
  x: number;
  y: number;
}

// Zone corridor entry points — where agents enter the corridor from their zone
const CORRIDOR_ENTRIES: Record<string, Point> = {
  executive: { x: 586, y: 336 },
  engineering: { x: 614, y: 336 },
  quality: { x: 586, y: 364 },
  ops: { x: 614, y: 364 },
  'ceo-suite': { x: 600, y: 280 },
};

// Meeting table in the executive wing (for 3+ agent gatherings)
const MEETING_TABLE: Point = { x: 460, y: 230 };

/**
 * Returns the corridor entry point for a given zone.
 */
export function getCorridorEntryPoint(zone: string): Point {
  return CORRIDOR_ENTRIES[zone] ?? { x: 600, y: 350 };
}

/**
 * Determines whether two zones are the same.
 */
function isSameZone(zoneA: string, zoneB: string): boolean {
  return zoneA === zoneB;
}

/**
 * Calculate the meeting point for two agents.
 *
 * - Same zone: each agent walks 40% toward the other (midpoint with gap).
 * - Different zones: each agent walks 40% toward the other along the
 *   corridor-aware path (simplified to a direct lerp for visual smoothness).
 */
export function calculateMeetingPoint(
  agentA: { position: Point; zone: string },
  agentB: { position: Point; zone: string },
): { pointA: Point; pointB: Point } {
  if (isSameZone(agentA.zone, agentB.zone)) {
    // Same zone — walk 40% toward each other
    return {
      pointA: {
        x: agentA.position.x + (agentB.position.x - agentA.position.x) * 0.4,
        y: agentA.position.y + (agentB.position.y - agentA.position.y) * 0.4,
      },
      pointB: {
        x: agentB.position.x + (agentA.position.x - agentB.position.x) * 0.4,
        y: agentB.position.y + (agentA.position.y - agentB.position.y) * 0.4,
      },
    };
  }

  // Different zones — walk 40% toward the other agent
  // The spring animation handles the visual smoothness
  const entryA = getCorridorEntryPoint(agentA.zone);
  const entryB = getCorridorEntryPoint(agentB.zone);

  // Midpoint between the two corridor entries
  const corridorMidX = (entryA.x + entryB.x) / 2;
  const corridorMidY = (entryA.y + entryB.y) / 2;

  return {
    pointA: {
      x: agentA.position.x + (corridorMidX - agentA.position.x) * 0.4,
      y: agentA.position.y + (corridorMidY - agentA.position.y) * 0.4,
    },
    pointB: {
      x: agentB.position.x + (corridorMidX - agentB.position.x) * 0.4,
      y: agentB.position.y + (corridorMidY - agentB.position.y) * 0.4,
    },
  };
}

/**
 * Calculate meeting positions for 3+ agents converging at the meeting table.
 * Agents arrange themselves in a circle around the table.
 */
export function calculateGroupMeetingPositions(
  agentIds: string[],
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const count = agentIds.length;
  const radius = 45 + Math.max(0, count - 2) * 8;

  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2; // start from top
    positions.set(agentIds[i], {
      x: MEETING_TABLE.x + Math.cos(angle) * radius,
      y: MEETING_TABLE.y + Math.sin(angle) * radius,
    });
  }

  return positions;
}

/**
 * Get the meeting table center position (used for meeting zone rendering).
 */
export function getMeetingTableCenter(): Point {
  return { ...MEETING_TABLE };
}
