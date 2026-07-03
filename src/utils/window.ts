export { isWindowAlive };

/**
 * Check if the window is alive.
 * Useful to prevent opening duplicate windows.
 * @param win
 */
function isWindowAlive(win?: Window) {
  // Use type assertion to access Components.utils.isDeadWrapper
  return win && !(Components as any).utils.isDeadWrapper(win) && !win.closed;
}
