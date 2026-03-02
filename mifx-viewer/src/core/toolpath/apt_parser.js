// src/core/toolpath/apt_parser.js
// Thin wrapper so we can use the existing global-style parser as a module.

import "./toolpath_apt.js"; // side-effect: defines window.parseAptCl

export function parseAptCl(text) {
  if (!window.parseAptCl) {
    throw new Error("APT parser not loaded (window.parseAptCl missing).");
  }
  return window.parseAptCl(text);
}