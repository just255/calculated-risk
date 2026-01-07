// sprite-editor/auth.js - Authentication
// Single responsibility: Handle password authentication with localStorage persistence

import { AUTH_STORAGE_KEY, CORRECT_PASSWORD } from './constants.js';
import { state } from './state.js';

// Check if already authenticated this session
export function checkAuth() {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (saved === 'true') {
    state.authenticated = true;
    return true;
  }
  return false;
}

// Authenticate with password
export function authenticate(password) {
  if (password === CORRECT_PASSWORD) {
    state.authenticated = true;
    localStorage.setItem(AUTH_STORAGE_KEY, 'true');
    return true;
  }
  return false;
}

// Clear authentication (for logout if needed)
export function clearAuth() {
  state.authenticated = false;
  localStorage.removeItem(AUTH_STORAGE_KEY);
}
