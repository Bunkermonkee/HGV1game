/** Scoring and collision rules. Per-level star targets live in the level data. */
export const RULES = {
  bay: {
    /** Trailer must line up with the bay within this angle, degrees. */
    maxAngle: 3,
    /** Trailer rear centre must be within this distance of the bay centre line, metres. */
    maxLateral: 0.3,
    /** Trailer rear must be within this distance of the dock buffers, metres. */
    maxRearGap: 0.5,
  },
  contact: {
    /** Contact at or above this speed is a hard hit = fail. */
    hardSpeedMph: 2.5,
    /**
     * Backing the trailer onto the dock buffers at or below this speed is how
     * it's meant to be done: no penalty.
     */
    bufferSafeMph: 1.8,
    /** Time added per light contact, seconds. */
    penaltySeconds: 5,
    /** Gap (metres) that has to open up before touching the same object counts again. */
    releaseMargin: 0.1,
  },
  /** Seconds to hold on the scene before showing the results / fail screen. */
  resultsDelay: 1.2,
  failDelay: 1.4,
};
