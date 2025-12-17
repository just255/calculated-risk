// Controller/Gamepad support for Calculated Risk
// Uses the Gamepad API for controller input

// Gamepad state
let gamepadIndex = null;
let controllerConnected = false;

// Deadzone for analog sticks (ignore small movements)
const DEADZONE = 0.15;

// Button mappings (standard gamepad layout)
const BUTTONS = {
  A: 0,           // Deploy/Confirm
  B: 1,           // Cancel/Back
  X: 2,           // Switch unit
  Y: 3,           // Artillery
  LB: 4,          // Previous lane
  RB: 5,          // Next lane
  LT: 6,          // Unused
  RT: 7,          // Shoot
  SELECT: 8,      // Menu
  START: 9,       // Pause
  L3: 10,         // Left stick press
  R3: 11,         // Right stick press
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15
};

// Track button states to detect presses (not holds)
let prevButtonStates = {};

// Callbacks for controller events
let onConnect = null;
let onDisconnect = null;

// Initialize controller support
function initController() {
  window.addEventListener('gamepadconnected', (e) => {
    console.log('Gamepad connected:', e.gamepad.id);
    gamepadIndex = e.gamepad.index;
    controllerConnected = true;
    if (onConnect) onConnect(e.gamepad);
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    console.log('Gamepad disconnected:', e.gamepad.id);
    if (e.gamepad.index === gamepadIndex) {
      gamepadIndex = null;
      controllerConnected = false;
      prevButtonStates = {};
      if (onDisconnect) onDisconnect();
    }
  });
}

// Get current gamepad (must poll each frame)
function getGamepad() {
  if (gamepadIndex === null) return null;
  const gamepads = navigator.getGamepads();
  return gamepads[gamepadIndex] || null;
}

// Apply deadzone to analog value
function applyDeadzone(value) {
  if (Math.abs(value) < DEADZONE) return 0;
  // Scale remaining range to 0-1
  const sign = value > 0 ? 1 : -1;
  return sign * (Math.abs(value) - DEADZONE) / (1 - DEADZONE);
}

// Get left stick input (movement)
function getLeftStick() {
  const gp = getGamepad();
  if (!gp) return { x: 0, y: 0 };
  return {
    x: applyDeadzone(gp.axes[0]),
    y: applyDeadzone(gp.axes[1])
  };
}

// Get right stick input (aiming)
function getRightStick() {
  const gp = getGamepad();
  if (!gp) return { x: 0, y: 0 };
  return {
    x: applyDeadzone(gp.axes[2]),
    y: applyDeadzone(gp.axes[3])
  };
}

// Check if button is currently pressed
function isButtonDown(buttonIndex) {
  const gp = getGamepad();
  if (!gp || !gp.buttons[buttonIndex]) return false;
  return gp.buttons[buttonIndex].pressed;
}

// Check if button was just pressed this frame
function isButtonPressed(buttonIndex) {
  const current = isButtonDown(buttonIndex);
  const prev = prevButtonStates[buttonIndex] || false;
  return current && !prev;
}

// Get trigger value (0-1)
function getTrigger(buttonIndex) {
  const gp = getGamepad();
  if (!gp || !gp.buttons[buttonIndex]) return 0;
  return gp.buttons[buttonIndex].value;
}

// Update button states (call at end of each frame)
function updateButtonStates() {
  const gp = getGamepad();
  if (!gp) return;

  for (let i = 0; i < gp.buttons.length; i++) {
    prevButtonStates[i] = gp.buttons[i].pressed;
  }
}

// Get all controller input as a single object
function getControllerInput() {
  if (!controllerConnected) return null;

  const leftStick = getLeftStick();
  const rightStick = getRightStick();

  return {
    // Movement (left stick)
    moveX: leftStick.x,
    moveY: leftStick.y,
    isMoving: leftStick.x !== 0 || leftStick.y !== 0,

    // Aiming (right stick)
    aimX: rightStick.x,
    aimY: rightStick.y,
    isAiming: rightStick.x !== 0 || rightStick.y !== 0,

    // Triggers
    shoot: getTrigger(BUTTONS.RT) > 0.5,

    // Face buttons (just pressed)
    deploy: isButtonPressed(BUTTONS.A),
    cancel: isButtonPressed(BUTTONS.B),
    switchUnit: isButtonPressed(BUTTONS.X),
    artillery: isButtonPressed(BUTTONS.Y),

    // Shoulders (just pressed)
    prevLane: isButtonPressed(BUTTONS.LB),
    nextLane: isButtonPressed(BUTTONS.RB),

    // Menu buttons
    pause: isButtonPressed(BUTTONS.START),
    menu: isButtonPressed(BUTTONS.SELECT),

    // D-pad
    dpadUp: isButtonPressed(BUTTONS.DPAD_UP),
    dpadDown: isButtonPressed(BUTTONS.DPAD_DOWN),
    dpadLeft: isButtonPressed(BUTTONS.DPAD_LEFT),
    dpadRight: isButtonPressed(BUTTONS.DPAD_RIGHT)
  };
}

// Set callbacks
function setControllerCallbacks(connectCb, disconnectCb) {
  onConnect = connectCb;
  onDisconnect = disconnectCb;
}

// Check if controller is available
function isControllerConnected() {
  return controllerConnected;
}

export {
  initController,
  getControllerInput,
  updateButtonStates,
  setControllerCallbacks,
  isControllerConnected,
  BUTTONS
};
