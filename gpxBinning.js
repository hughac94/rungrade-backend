/**
 * GPX/FIT Binning Logic - Backend Version
 * EXACTLY matches the frontend binning logic from GPXGapanalysis.js
/**
 * RUNGRADE BINNING ENGINE
 * 
 * This file handles the core analysis of GPS route data by breaking runs into equal-distance segments (bins).
 * It processes both GPX and FIT file data to create detailed performance analysis.
 * 
 * KEY FUNCTIONS:
 * - getAnalysisBins(): Main function that splits GPS routes into distance-based segments
 * - getBinSummary(): Calculates overall statistics from all bins
 * - Heart Rate Analysis: Calculates avg/max/min HR per bin (backend enhancement)
 * 
 * MATCHES FRONTEND: Exactly mirrors the binning logic from the main app's GPXGapanalysis.js
 * but adds heart rate analysis capabilities for FIT files.
 * 
 * FLOW: GPS Points → Distance Calculation → Bin Creation → Performance Metrics
 */ 

const { GAP_COEFFICIENTS, calculateGradeAdjustment } = require('./Coefficients');

function formatTime(seconds) {
  if (seconds == null) return '';
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = x => (x * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * EXACT COPY of getAnalysisBins from GPXGapanalysis.js
 * With added heart rate analysis for backend
 */
function getAnalysisBins(points, binLength = 50, polyCoeffs = null, newAdjustedVelocity = null) {
  if (!Array.isArray(points) || points.length < 2) return [];

  const bins = [];
  let lastBinIdx = 0;
  let cumDist = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segDist = haversine(prev.lat, prev.lon, curr.lat, curr.lon);

    cumDist += segDist;

    // When we've reached or exceeded the bin length, create a bin ending at this point
    if (cumDist >= binLength) {
      const binStart = points[lastBinIdx];
      const binEnd = curr;
      const distance = cumDist;
      const elevationChange = binEnd.ele - binStart.ele;
      const gradient = (distance > 0) ? (elevationChange / distance) * 100 : 0;

      // Time-based calculations only if both start and end have valid time
      let timeTaken = null;
      let velocity = null;
      let pace_min_per_km_num = null;
      let timeInSeconds = 0; // ADD THIS - missing in backend
      
      if (binStart.time && binEnd.time) {
        const seconds = (new Date(binEnd.time) - new Date(binStart.time)) / 1000;
        if (!isNaN(seconds) && seconds > 0) {
          timeInSeconds = seconds; // ADD THIS
          timeTaken = formatTime(seconds);
          velocity = distance / seconds;
          pace_min_per_km_num = (velocity > 0) ? (1000 / velocity) / 60 : null;
        }
      }

      let adjFactor = 1;
      if (polyCoeffs && Array.isArray(polyCoeffs) && polyCoeffs.length === 5 && typeof gradient === 'number') {
        const clampedGradient = Math.max(-35, Math.min(35, gradient));
        const [a, b, c, d, e] = polyCoeffs;
        adjFactor =calculateGradeAdjustment(clampedGradient);
      }

      let adjustedTime = null;
      let gradeAdjustedDistance = null;
      if (
        newAdjustedVelocity &&
        newAdjustedVelocity > 0 &&
        isFinite(adjFactor) &&
        adjFactor > 0
      ) {
        adjustedTime = (distance * adjFactor) / newAdjustedVelocity;
        gradeAdjustedDistance = distance * adjFactor;
      }

      // Heart rate calculations (BACKEND ADDITION)
      let avgHeartRate = null;
      let maxHeartRate = null;
      let minHeartRate = null;
      const heartRates = [];

      // Collect heart rate data from all points in this bin
      for (let j = lastBinIdx; j <= i; j++) {
        if (points[j].heartRate && typeof points[j].heartRate === 'number') {
          heartRates.push(points[j].heartRate);
        }
      }

      if (heartRates.length > 0) {
        avgHeartRate = Math.round(heartRates.reduce((sum, hr) => sum + hr, 0) / heartRates.length);
        maxHeartRate = Math.max(...heartRates);
        minHeartRate = Math.min(...heartRates);
      }

      // EXACT bin structure from frontend + heart rate
      bins.push({
        distance,
        elevationChange: Number(elevationChange.toFixed(2)),
        gradient: Number(gradient.toFixed(2)),
        timeTaken,
        timeInSeconds, // ADD THIS - was missing
        velocity,
        pace_min_per_km: pace_min_per_km_num,
        adjustedTime: Number(adjustedTime) || 0,
        gradeAdjustedDistance,
        startIdx: lastBinIdx,
        endIdx: i,
        startTime: binStart.time || null,
        endTime: binEnd.time || null,
        // BACKEND ADDITIONS for heart rate
        avgHeartRate,
        maxHeartRate,
        minHeartRate,
        heartRateDataPoints: heartRates.length
      });

      lastBinIdx = i;
      cumDist = 0;
    }
  }

  // Add a final partial bin if any distance remains - EXACT COPY from frontend
  if (lastBinIdx < points.length - 1 && cumDist > 0) {
    const binStart = points[lastBinIdx];
    const binEnd = points[points.length - 1];
    const distance = cumDist;
    const elevationChange = binEnd.ele - binStart.ele;
    const gradient = (distance > 0) ? (elevationChange / distance) * 100 : 0;

    let timeTaken = null;
    let velocity = null;
    let pace_min_per_km_num = null;
    let timeInSeconds = 0; // ADD THIS
    
    if (binStart.time && binEnd.time) {
      const seconds = (new Date(binEnd.time) - new Date(binStart.time)) / 1000;
      if (!isNaN(seconds) && seconds > 0) {
        timeInSeconds = seconds; // ADD THIS
        timeTaken = formatTime(seconds);
        velocity = distance / seconds;
        pace_min_per_km_num = (velocity > 0) ? (1000 / velocity) / 60 : null;
      }
    }

    let adjFactor = 1;
    if (polyCoeffs && Array.isArray(polyCoeffs) && polyCoeffs.length === 5 && typeof gradient === 'number') {
      const clampedGradient = Math.max(-35, Math.min(35, gradient));
      const [a, b, c, d, e] = polyCoeffs;
      adjFactor =
        a * Math.pow(clampedGradient, 4) +
        b * Math.pow(clampedGradient, 3) +
        c * Math.pow(clampedGradient, 2) +
        d * clampedGradient +
        e;
    }

    let adjustedTime = null;
    let gradeAdjustedDistance = null;
    if (
      newAdjustedVelocity &&
      newAdjustedVelocity > 0 &&
      isFinite(adjFactor) &&
      adjFactor > 0
    ) {
      adjustedTime = (distance * adjFactor) / newAdjustedVelocity;
      gradeAdjustedDistance = distance * adjFactor;
    }

    // Heart rate for final bin
    let avgHeartRate = null;
    let maxHeartRate = null;
    let minHeartRate = null;
    const heartRates = [];

    for (let j = lastBinIdx; j < points.length; j++) {
      if (points[j].heartRate && typeof points[j].heartRate === 'number') {
        heartRates.push(points[j].heartRate);
      }
    }

    if (heartRates.length > 0) {
      avgHeartRate = Math.round(heartRates.reduce((sum, hr) => sum + hr, 0) / heartRates.length);
      maxHeartRate = Math.max(...heartRates);
      minHeartRate = Math.min(...heartRates);
    }

    bins.push({
      distance,
      elevationChange: Number(elevationChange.toFixed(2)),
      gradient: Number(gradient.toFixed(2)),
      timeTaken,
      timeInSeconds, // ADD THIS
      velocity,
      pace_min_per_km: pace_min_per_km_num,
      adjustedTime: Number(adjustedTime) || 0,
      gradeAdjustedDistance,
      startIdx: lastBinIdx,
      endIdx: points.length - 1,
      startTime: binStart.time || null,
      endTime: binEnd.time || null,
      // Heart rate additions
      avgHeartRate,
      maxHeartRate,
      minHeartRate,
      heartRateDataPoints: heartRates.length
    });
  }

  return bins;
}

// Keep the summary function the same
function getBinSummary(bins) {
  if (!bins || bins.length === 0) return null;

  const validBins = bins.filter(bin => 
    typeof bin.distance === 'number' && 
    bin.distance > 0
  );

  if (validBins.length === 0) return null;

  const totalDistance = validBins.reduce((sum, bin) => sum + bin.distance, 0);
  const totalTime = validBins.reduce((sum, bin) => sum + (bin.timeInSeconds || 0), 0);
  const totalElevation = validBins.reduce((sum, bin) => sum + Math.max(0, bin.elevationChange), 0);

  const binsWithHR = validBins.filter(bin => bin.avgHeartRate);
  const avgHeartRate = binsWithHR.length > 0 ? 
    Math.round(binsWithHR.reduce((sum, bin) => sum + bin.avgHeartRate, 0) / binsWithHR.length) : null;
  const maxHeartRate = binsWithHR.length > 0 ? 
    Math.max(...binsWithHR.map(bin => bin.maxHeartRate)) : null;

  return {
    totalBins: bins.length,
    validBins: validBins.length,
    totalDistance: Number((totalDistance / 1000).toFixed(2)), // km
    totalTime: totalTime, // seconds
    totalElevation: Math.round(totalElevation), // meters
    avgPace: totalDistance > 0 && totalTime > 0 ? (totalTime / 60) / (totalDistance / 1000) : null, // min/km
    avgHeartRate,
    maxHeartRate,
    heartRateDataCoverage: binsWithHR.length / validBins.length // percentage as decimal
  };
}

/**
 * Analyze pace vs gradient across all bins from multiple files
 * Groups bins by gradient ranges and calculates average pace for each range
 */
function getGradientPaceAnalysis(allResults) {
  console.log('🔍 getGradientPaceAnalysis called - UPDATED VERSION WITH MEDIAN');
  if (!allResults || allResults.length === 0) {
    return {
      buckets: [],
      totalBinsAnalyzed: 0,
      summary: 'No results to analyze'
    };
  }

  // Collect all bins from all results
  const allBins = [];
  allResults.forEach(result => {
    if (result.bins && Array.isArray(result.bins)) {
      allBins.push(...result.bins);
    }
  });

  if (allBins.length === 0) {
    return {
      buckets: [],
      totalBinsAnalyzed: 0,
      summary: 'No bins found in results'
    };
  }

  // Define gradient ranges
  const gradientRanges = [
    { min: -Infinity, max: -25, label: '≤-25%' },
    { min: -25, max: -20, label: '-25 to -20%' },
    { min: -20, max: -15, label: '-20 to -15%' },
    { min: -15, max: -10, label: '-15 to -10%' },
    { min: -10, max: -5, label: '-10 to -5%' },
    { min: -5, max: 0, label: '-5 to 0%' },
    { min: 0, max: 5, label: '0 to 5%' },
    { min: 5, max: 10, label: '5 to 10%' },
    { min: 10, max: 15, label: '10 to 15%' },
    { min: 15, max: 20, label: '15 to 20%' },
    { min: 20, max: 25, label: '20 to 25%' },
    { min: 25, max: Infinity, label: '≥25%' }
  ];

  // Group bins by gradient ranges
  const buckets = gradientRanges.map(range => {
    const binsInRange = allBins.filter(bin => {
      const gradient = bin.gradient;
      if (range.min === -Infinity) return gradient <= range.max;
      if (range.max === Infinity) return gradient >= range.min;
      return gradient > range.min && gradient <= range.max;
    });

    if (binsInRange.length === 0) return null;

    // FIX: Use pace_min_per_km instead of pace
    const paceValues = binsInRange
      .map(bin => bin.pace_min_per_km)  // Changed from bin.pace
      .filter(pace => pace != null && !isNaN(pace) && pace > 0);
    
    const heartRateValues = binsInRange
      .map(bin => bin.avgHeartRate)
      .filter(hr => hr != null && !isNaN(hr) && hr > 0);
    
    if (paceValues.length === 0) return null;
    
    // Calculate mean (existing - add validation)
    const avgPace = paceValues.reduce((sum, pace) => sum + pace, 0) / paceValues.length;
    const avgHeartRate = heartRateValues.length > 0 ? 
      heartRateValues.reduce((sum, hr) => sum + hr, 0) / heartRateValues.length : null;
    
    // Calculate median (fixed)
    const sortedPaces = [...paceValues].sort((a, b) => a - b);
    let medianPace;
    if (sortedPaces.length === 1) {
      medianPace = sortedPaces[0];
    } else if (sortedPaces.length % 2 === 0) {
      const mid1 = sortedPaces[sortedPaces.length / 2 - 1];
      const mid2 = sortedPaces[sortedPaces.length / 2];
      medianPace = (mid1 + mid2) / 2;
    } else {
      medianPace = sortedPaces[Math.floor(sortedPaces.length / 2)];
    }
    
    let medianHeartRate = null;
    if (heartRateValues.length > 0) {
      const sortedHeartRates = [...heartRateValues].sort((a, b) => a - b);
      if (sortedHeartRates.length === 1) {
        medianHeartRate = sortedHeartRates[0];
      } else if (sortedHeartRates.length % 2 === 0) {
        const mid1 = sortedHeartRates[sortedHeartRates.length / 2 - 1];
        const mid2 = sortedHeartRates[sortedHeartRates.length / 2];
        medianHeartRate = (mid1 + mid2) / 2;
      } else {
        medianHeartRate = sortedHeartRates[Math.floor(sortedHeartRates.length / 2)];
      }
    }

    // Debug logging
    console.log(`Bucket ${range.label}: ${paceValues.length} pace values, mean: ${avgPace.toFixed(2)}, median: ${medianPace.toFixed(2)}`);

    return {
      ...range,
      binCount: binsInRange.length,
      // Existing mean fields (unchanged)
      avgPace: isNaN(avgPace) ? null : avgPace,
      avgHeartRate: isNaN(avgHeartRate) ? null : avgHeartRate,
      paceMinPerKm: isNaN(avgPace) ? 'N/A' : `${Math.floor(avgPace)}:${Math.round((avgPace % 1) * 60).toString().padStart(2, '0')}`,
      // New median fields
      medianPace: isNaN(medianPace) ? null : medianPace,
      medianHeartRate: isNaN(medianHeartRate) ? null : medianHeartRate,
      medianPaceMinPerKm: isNaN(medianPace) ? 'N/A' : `${Math.floor(medianPace)}:${Math.round((medianPace % 1) * 60).toString().padStart(2, '0')}`
    };
  }).filter(bucket => bucket !== null);

console.log('Sample bucket with median data:', buckets[0]);

  return {
    buckets,
    totalBinsAnalyzed: allBins.length,
    summary: `Analyzed ${buckets.length} gradient ranges with ${allBins.length} total bins`
  };
}

/**
 * Groups bins by nearest integer gradient and calculates average pace for each gradient.
 */
function getPaceByGradientChart(allResults) {
  // Collect all bins
  const allBins = [];
  allResults.forEach(result => {
    if (result.bins && Array.isArray(result.bins)) {
      allBins.push(...result.bins);
    }
  });

  // Group by nearest integer gradient
  const gradientMap = {};
  allBins.forEach(bin => {
    if (
      typeof bin.gradient === 'number' &&
      typeof bin.distance === 'number' &&
      typeof bin.timeInSeconds === 'number' &&
      bin.distance > 0 &&
      bin.timeInSeconds > 0
    ) {
     let grad = Math.round(bin.gradient);
if (grad <= -35) grad = '<=-35';
else if (grad >= 35) grad = '>=35';
const key = grad.toString();
      if (!gradientMap[key]) {
        gradientMap[key] = { totalDistance: 0, totalTime: 0, binCount: 0 };
      }
      gradientMap[key].totalDistance += bin.distance;
      gradientMap[key].totalTime += bin.timeInSeconds;
      gradientMap[key].binCount++;
    }
  });

  // Convert to sorted array for chart
  const gradientChart = Object.entries(gradientMap)
    .map(([gradient, data]) => {
      const paceMinPerKm = (data.totalTime / 60) / (data.totalDistance / 1000);
      const minutes = Math.floor(paceMinPerKm);
      const seconds = Math.round((paceMinPerKm - minutes) * 60);
      return {
        gradient,
        binCount: data.binCount,
        avgPace: paceMinPerKm,
        paceLabel: `${minutes}:${seconds.toString().padStart(2, '0')}`
      };
    })
    .sort((a, b) => {
      // Custom sort: <-35, -35..-1, 0, 1..35, >35
      if (a.gradient === '<-35') return -1;
      if (b.gradient === '<-35') return 1;
      if (a.gradient === '>35') return 1;
      if (b.gradient === '>35') return -1;
      return parseInt(a.gradient) - parseInt(b.gradient);
    });

  return gradientChart;
}

/**
 * Calculate personal grade adjustment factors compared to literature values
 * Shows how much each gradient impacts pace relative to flat (0%) terrain
 */
function getGradeAdjustmentAnalysis(allResults) {
  // First, get pace by individual gradient using existing function
  const gradientData = getPaceByGradientChart(allResults);
  
  // Calculate base paces (both mean and median) - SINGLE DECLARATION
  let basePace = null;
  let basePaceMedian = null;
  
  // Find the pace at 0% gradient to use as baseline
  const flatGradient = gradientData.find(item => item.gradient === '0');
  if (flatGradient) {
    basePace = flatGradient.avgPace;
  } else {
    // If no exact 0% gradient data, estimate from nearby values
    const nearZero = gradientData
      .filter(item => {
        const grad = parseInt(item.gradient);
        return !isNaN(grad) && grad >= -2 && grad <= 2;
      })
      .sort((a, b) => Math.abs(parseInt(a.gradient)) - Math.abs(parseInt(b.gradient)));
    
    if (nearZero.length > 0) {
      basePace = nearZero[0].avgPace;
    } else {
      // If still no data, use average of all paces
      const validPaces = gradientData.filter(item => item.avgPace).map(item => item.avgPace);
      if (validPaces.length > 0) {
        basePace = validPaces.reduce((sum, pace) => sum + pace, 0) / validPaces.length;
      }
    }
  }
  
  // For now, use the same basePace for median calculations
  // TODO: Calculate proper median base pace when individual bin data is available
  basePaceMedian = basePace;

  const adjustmentData = gradientData.map(item => {
    const gradientValue = parseFloat(item.gradient.replace('%', ''));
    const literatureAdjustment = calculateGradeAdjustment(gradientValue);
    
    // Calculate adjustment factors
    const meanAdjustmentFactor = basePace > 0 ? item.avgPace / basePace : 1;
    const medianAdjustmentFactor = basePaceMedian > 0 ? item.avgPace / basePaceMedian : 1;
    
    return {
      gradient: item.gradient,
      gradientValue,
      // Mean data (existing)
      personalAdjustment: parseFloat(meanAdjustmentFactor.toFixed(4)),
      avgPace: item.avgPace,
      paceLabel: item.paceLabel,
      // Median data (new) - for now using same values, will be different when proper median calculation is implemented
      personalAdjustmentMedian: parseFloat(medianAdjustmentFactor.toFixed(4)),
      medianPace: item.avgPace, // TODO: Calculate actual median pace per gradient
      medianPaceLabel: item.paceLabel, // TODO: Format median pace label
      // Common data
      literatureAdjustment: parseFloat(literatureAdjustment.toFixed(4)),
      binCount: item.binCount
    };
  });

  return {
    adjustmentData,
    basePace,
    basePaceMedian,
    basePaceLabel: basePace ? `${Math.floor(basePace)}:${Math.round((basePace % 1) * 60).toString().padStart(2, '0')}` : 'N/A',
    basePaceMedianLabel: basePaceMedian ? `${Math.floor(basePaceMedian)}:${Math.round((basePaceMedian % 1) * 60).toString().padStart(2, '0')}` : 'N/A'
  };
}

// Add to module.exports:
module.exports = {
  getAnalysisBins,
  getBinSummary,
  getGradientPaceAnalysis,
  getPaceByGradientChart,
  getGradeAdjustmentAnalysis, // Add this export
  haversine,
  formatTime
};


