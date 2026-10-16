// The circuit and the track-wide constants. Units are metres; the world is the XZ plane.

// Control points of the closed street circuit, driven in this order. Start/finish sits
// on the main straight between the first two points.
export const CONTROL_POINTS = [
  [0, 0], [160, -6], [300, 0], [410, 30], [455, 125], [405, 215],
  [310, 232], [262, 300], [300, 380], [250, 462], [130, 478], [62, 425],
  [128, 345], [96, 262], [-40, 236], [-140, 180], [-155, 70], [-95, 8],
];

export const ROAD_HALF = 7.5;     // drivable tarmac, centre to edge
export const CURB_W = 1.2;        // curb strip outside the tarmac
export const WALL = 12;           // barrier distance from the centre line
export const CAR_RADIUS = 1.1;    // collision half-width of a car
export const SAMPLE_SPACING = 2;  // metres between resampled track points
export const CHECKPOINTS = 12;
export const LAPS = 3;
export const START_OFFSET = 14;   // grid starts this far behind the line
