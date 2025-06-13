/**
 * Grade Adjustment Polynomial Coefficients
 * Based on Strava's research: https://medium.com/strava-engineering/an-improved-gap-model-8b07ae8886c3
 */

const GAP_COEFFICIENTS = {
  a: -5.294439830640173e-7,
  b: -0.000003989571857841264,
  c: 0.0020535661142752205,
  d: 0.03265674125152065,
  e: 1
};

/**
 * Calculate grade adjustment factor for a given gradient percentage
 * @param {number} gradient - Gradient percentage (-35 to 35)
 * @returns {number} - Adjustment factor (pace multiplier)
 */
function calculateGradeAdjustment(gradientPercent) {
  // Keep reasonable gradient bounds but don't cap the output
  const clampedGradient = Math.max(-35, Math.min(35, gradientPercent));
  
  const adjustment = 1 + (clampedGradient * 0.033) + (clampedGradient * clampedGradient * 0.000233);
  
  // Only prevent negative values, but allow high positive values
  return Math.max(0.3, adjustment); // Remove the Math.min(3.0, adjustment) cap
}

module.exports = {
  GAP_COEFFICIENTS,
  calculateGradeAdjustment
};