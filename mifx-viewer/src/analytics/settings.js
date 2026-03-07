// analytics/settings.js
// ------------------------------------------------------------
// Machine defaults. Keep super simple for v0.
// Later: per-machine profiles and turning/SFM.
// ------------------------------------------------------------

export function getDefaultMachineSettings(units = "MM") {
  const U0 = String(units || "MM").toUpperCase();
  const U = (U0 === "IN" ? "INCH" : U0); // normalize

  const rapidRate = (U === "INCH") ? 400 : 10000;

  return {
    units: U,                 // "MM" or "INCH"
    rapidRate,                // units/min
    defaultFeedRate: null,    // optional later
  };
}