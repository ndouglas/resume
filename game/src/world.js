// Playfield geometry in logical pixels. The canvas scales this to the screen.
export const W = 480;
export const H = 720;
export const COLS = 8;
export const COL_W = W / COLS;
export const PLAYER_Y = 680;
export const DANGER_Y = 640; // an enemy whose bottom crosses this burns error budget
export const BOTTOM = 700; // a ball below this has returned to the player
export const MOVE_BAND_Y = 600; // pointer below this moves the player instead of aiming
export const REVEAL_BASE = 140; // enemies this close to DANGER_Y are revealed by monitoring
export const STEP = 1 / 120; // fixed simulation timestep, seconds
