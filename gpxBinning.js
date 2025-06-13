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
  // Define gradient buckets (in %)
  const gradientBuckets = [
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

  // Initialize buckets
  const bucketData = gradientBuckets.map(bucket => ({
    ...bucket,
    totalDistance: 0,
    totalTime: 0,
    binCount: 0,
    avgPace: null,
    paceMinPerKm: null
  }));

  // Collect all bins from all files
  const allBins = [];
  allResults.forEach(result => {
    if (result.bins && Array.isArray(result.bins)) {
      allBins.push(...result.bins);
    }
  });

  console.log(`Analyzing ${allBins.length} total bins for gradient vs pace`);

  // Group bins into gradient buckets
  allBins.forEach(bin => {
    if (typeof bin.gradient === 'number' && 
        typeof bin.distance === 'number' && 
        typeof bin.timeInSeconds === 'number' &&
        bin.distance > 0 && bin.timeInSeconds > 0) {
      
      // Find the appropriate bucket
      const bucketIndex = bucketData.findIndex(bucket => 
        bin.gradient > bucket.min && bin.gradient <= bucket.max
      );
      
      if (bucketIndex >= 0) {
        bucketData[bucketIndex].totalDistance += bin.distance;
        bucketData[bucketIndex].totalTime += bin.timeInSeconds;
        bucketData[bucketIndex].binCount++;
      }
    }
  });

  // Calculate average pace for each bucket
  bucketData.forEach(bucket => {
    if (bucket.totalDistance > 0 && bucket.totalTime > 0) {
      // Calculate pace in minutes per km
      const paceMinPerKm = (bucket.totalTime / 60) / (bucket.totalDistance / 1000);
      bucket.avgPace = paceMinPerKm;
      
      // Format as mm:ss
      const minutes = Math.floor(paceMinPerKm);
      const seconds = Math.round((paceMinPerKm - minutes) * 60);
      bucket.paceMinPerKm = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  });

  // Filter out empty buckets
  const nonEmptyBuckets = bucketData.filter(bucket => bucket.binCount > 0);
  
  console.log(`Gradient analysis complete: ${nonEmptyBuckets.length} gradient ranges have data`);
  
  return {
    buckets: nonEmptyBuckets,
    totalBinsAnalyzed: allBins.length,
    bucketsWithData: nonEmptyBuckets.length
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
  
  // Find the pace at 0% gradient to use as baseline
  let basePace = null;
  const flatGradient = gradientData.find(item => item.gradient === '0');
  if (flatGradient) {
    basePace = flatGradient.avgPace;
  } else {
    // If no exact 0% gradient data, estimate from nearby values
    const nearZero = gradientData
      .filter(item => parseInt(item.gradient) >= -2 && parseInt(item.gradient) <= 2)
      .sort((a, b) => Math.abs(parseInt(a.gradient)) - Math.abs(parseInt(b.gradient)));
    
    if (nearZero.length > 0) {
      basePace = nearZero[0].avgPace; // Use the closest to 0
    } else {
      // If still no data, use average of all paces
      const validPaces = gradientData.filter(item => item.avgPace).map(item => item.avgPace);
      basePace = validPaces.reduce((sum, pace) => sum + pace, 0) / validPaces.length;
    }
  }
  
  // Calculate personal adjustment factors
  const adjustmentData = gradientData.map(item => {
    // For special gradient strings like "<=-35" or ">=35", extract the numeric part
    let gradientValue;
    if (item.gradient === '<=-35') gradientValue = -35;
    else if (item.gradient === '>=35') gradientValue = 35;
    else gradientValue = parseInt(item.gradient);
    
    // Calculate personal adjustment factor
    const adjustmentFactor = basePace > 0 ? item.avgPace / basePace : 1;
    
    // Calculate literature adjustment factor using the provided formula
    const x = gradientValue;
    const literatureAdjustment = 
      -5.294439830640173e-7 * Math.pow(x, 4) +
      -0.000003989571857841264 * Math.pow(x, 3) +
      0.0020535661142752205 * Math.pow(x, 2) +
      0.03265674125152065 * x +
      1;
    
    return {
      gradient: item.gradient,
      gradientValue,
      personalAdjustment: parseFloat(adjustmentFactor.toFixed(4)),
      literatureAdjustment: parseFloat(literatureAdjustment.toFixed(4)),
      binCount: item.binCount,
      avgPace: item.avgPace,
      paceLabel: item.paceLabel
    };
  });
  
  // Sort by gradient value
  adjustmentData.sort((a, b) => {
    if (a.gradient === '<=-35') return -1;
    if (b.gradient === '<=-35') return 1;
    if (a.gradient === '>=35') return 1;
    if (b.gradient === '>=35') return -1;
    return a.gradientValue - b.gradientValue;
  });
  
  return {
    adjustmentData,
    basePace,
    basePaceLabel: basePace ? `${Math.floor(basePace)}:${Math.round((basePace % 1) * 60).toString().padStart(2, '0')}` : 'N/A'
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