// for /f "tokens=5" %a in ('netstat -ano ^| findstr :3001') do taskkill /PID %a /F

/**
 * RUNGRADE BACKEND API SERVER
 * 
 * Express.js server that processes GPS running data from GPX and FIT files.
 * Provides two main analysis modes: basic file analysis and advanced binning analysis.
 * 
 * KEY ENDPOINTS:
 * - POST /api/analyze-files-bulk: Basic file processing (distance, time, elevation)
 * - POST /api/analyze-with-bins: Advanced analysis with distance-based bins + heart rate
 * - GET /api/health: Server health check
 * 
 * SUPPORTED FORMATS: GPX files (basic GPS) and FIT files (detailed sports data + HR)
 * 
 * ARCHITECTURE:
 * File Upload → Parser Selection → Data Extraction → Analysis → JSON Response
 * Uses multer for file handling, gpxparser for GPX, fit-file-parser for FIT files
 */


const express = require('express');
const cors = require('cors');
const multer = require('multer');
const GPXParser = require('gpxparser');
const FitParser = require('fit-file-parser').default;
const gpxBinning = require('./gpxBinning');
const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 3001;
const {
  getTotalDistance,
  getTotalTime,
  getTotalElevationGain,
  processFITFile,
  processFile,
  processGPXFile,
  getRoutePoints,
  getGPXRoutePoints,
  getFITRoutePoints
} = require('./GPXhelpers');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));


// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 50 * 1024 * 1024, // 50MB total
    files: 200 // Max 200 files
  }
});

// Disable compression for SSE, enable for everything else
app.use((req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes('text/event-stream')) {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    return next();
  }
  compression()(req, res, next);
});
app.use((req, res, next) => {
  if (!res.flush) {
    res.flush = function () {
      try { res.write(''); } catch (e) {}
    };
  }
  next();
});

// Updated API endpoint


// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: '🏃‍♂️ RunGrade backend is running!',
    supportedFormats: ['GPX', 'FIT']
  });
});

//ANALYSIS ENDPOINTS

// Single-file analysis (binning)
app.post('/api/analyze-with-bins', upload.array('files', 200), async (req, res) => {
  console.log(`🏃‍♂️ Processing ${req.files.length} files with binning...`);
  
  try {
    // Get bin length from request (default 50m)
    const binLength = parseInt(req.body.binLength) || 50;
    console.log(`Using bin length: ${binLength}m`);
    
    const results = [];
    const errors = [];
    
    for (const [index, file] of req.files.entries()) {
      console.log(`📁 Processing file ${index + 1}/${req.files.length}: ${file.originalname}`);
      
      const result = await processFile(file.buffer, file.originalname);
      
      if (result.error) {
        errors.push(result);
        console.log(`❌ Failed: ${result.filename} - ${result.error}`);
      } else {
        // Get the route points for binning
        const routePoints = await getRoutePoints(file.buffer, file.originalname);
        
        if (routePoints && routePoints.length > 0) {
          // Create bins
          const bins = gpxBinning.getAnalysisBins(routePoints, binLength);
          const binSummary = gpxBinning.getBinSummary(bins);
          
          console.log(`✅ Created ${bins.length} bins for ${result.stats.filename}`);
          
          // Check if this file has heart rate data in any bin
          const hasHeartRateData = bins.some(bin => bin.avgHeartRate !== null);
          
          results.push({
            ...result.stats,
            binLength,
            bins,
            binSummary,
            routePointCount: routePoints.length,
            hasHeartRateData // Add this flag
          });
        } else {
          results.push({
            ...result.stats,
            binLength,
            bins: [],
            binSummary: null,
            routePointCount: 0,
            hasHeartRateData: false
          });
        }
      }
    }

    // Calculate overall summary AFTER processing all files
    const totalBins = results.reduce((sum, r) => sum + (r.bins?.length || 0), 0);
    const avgBinsPerFile = results.length > 0 ? totalBins / results.length : 0;
    
    // COUNT FILES WITH HEART RATE DATA (FIXED)
    const filesWithHeartRate = results.filter(r => r.hasHeartRateData).length;

    const summary = {
      totalFiles: req.files.length,
      successfulFiles: results.length,
      failedFiles: errors.length,
      binLength,
      totalBins,
      avgBinsPerFile: Math.round(avgBinsPerFile * 10) / 10,
      filesWithHeartRate // Now correctly calculated
    };

    console.log(`🎉 Binning complete: ${totalBins} total bins created`);
    console.log(`💓 Files with HR data: ${filesWithHeartRate}/${results.length}`);

    res.json({
      success: true,
      summary,
      results,
      errors
    });

  } catch (error) {
    console.error('❌ Binning analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Advanced analysis (patterns, charts)
app.post('/api/advanced-analysis', (req, res) => {
  try {
    const { results, statType = 'mean' } = req.body;

    const gradientPace = gpxBinning.getGradientPaceAnalysis(results);
    const paceByGradientChart = gpxBinning.getPaceByGradientChart(results);
    const gradeAdjustment = gpxBinning.getGradeAdjustmentAnalysis(results);

    // Calculate base pace for red dots
    const basePace = gradeAdjustment.basePace;
    const redDotData = gpxBinning.getAdjustmentByGradientBins(results, basePace, statType);

    console.log('Backend: redDotData', redDotData); // Optional: add this for debugging

    res.json({
      success: true,
      analyses: {
        gradientPace,
        paceByGradientChart,
        gradeAdjustment,
        redDotData
      }
    });
  } catch (error) {
    console.error('❌ Advanced analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Filtered analysis
app.post('/api/analyze-with-filters-json', (req, res) => {
  try {
    const { results, filterOptions, removeUnreliableBins, heartRateFilter } = req.body;
    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ success: false, error: 'No results provided' });
    }

    // Track exclusion reasons
    let exclusionCounts = {
      speed: 0,
      gradient: 0,
      timeInSeconds: 0,
      distance: 0,
      heartRate: 0,
      total: 0
    };

    const filteredResults = results.map(run => {
      let bins = run.bins || [];
      let filteredBins = [];
      bins.forEach(bin => {
        let excludeReason = null;
        if (removeUnreliableBins) {
          const speed =
  typeof bin.avgSpeed === 'number'
    ? bin.avgSpeed // FIT files: km/h
    : (typeof bin.velocity === 'number' ? bin.velocity * 3.6 : 0); // GPX files: m/s to km/h

          if (!(speed >= 1 && speed <= 30)) {
            exclusionCounts.speed++;
            excludeReason = 'speed';
          } else if (!(bin.gradient <= 30 && bin.gradient >= -30)) {
            exclusionCounts.gradient++;
            excludeReason = 'gradient';
          } else if (!(bin.timeInSeconds >= 1)) {
            exclusionCounts.timeInSeconds++;
            excludeReason = 'timeInSeconds';
          } else if (!(bin.distance > 0)) {
            exclusionCounts.distance++;
            excludeReason = 'distance';
          } 
        }
        if (heartRateFilter && (heartRateFilter.minHR || heartRateFilter.maxHR)) {
          if (bin.avgHeartRate == null ||
              (heartRateFilter.minHR && bin.avgHeartRate < heartRateFilter.minHR) ||
              (heartRateFilter.maxHR && bin.avgHeartRate > heartRateFilter.maxHR)) {
            exclusionCounts.heartRate++;
            excludeReason = 'heartRate';
          }
        }
        if (!excludeReason) {
          filteredBins.push(bin);
        } else {
          exclusionCounts.total++;
        }
      });
      return { ...run, bins: filteredBins };
    });

    // Calculate summary
    const totalOriginalBins = results.reduce((sum, r) => sum + (r.bins?.length || 0), 0);
    const totalFilteredBins = filteredResults.reduce((sum, r) => sum + (r.bins?.length || 0), 0);

    // Run advanced analysis on filtered bins
    const gradientPace = gpxBinning.getGradientPaceAnalysis(filteredResults);
    const paceByGradientChart = gpxBinning.getPaceByGradientChart(filteredResults);
    const gradeAdjustment = gpxBinning.getGradeAdjustmentAnalysis(filteredResults);
    const basePace = gradeAdjustment.basePace;
    const statType = req.body.statType || 'mean'; // <-- Add this line
    const redDotData = gpxBinning.getAdjustmentByGradientBins(filteredResults, basePace, statType );


    res.json({
      success: true,
      summary: {
        totalOriginalBins,
        totalFilteredBins,
        exclusionCounts
      },
      analyses: {
        gradientPace,
        paceByGradientChart,
        gradeAdjustment,
        redDotData
      },
      filteredResults
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

//BATCH ENDPOINTS

// Batch file upload
app.post('/api/upload-batch', upload.array('files', 100), async (req, res) => {
  try {
    const binLength = parseInt(req.body.binLength) || 50;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    // Store files in memory cache with a unique batch ID
    const batchId = Date.now().toString();
    
    // Store file info in memory (you could use Redis or similar for production)
    req.app.locals.batchFiles = req.app.locals.batchFiles || {};
    req.app.locals.batchFiles[batchId] = {
      files: files,
      binLength: binLength,
      timestamp: Date.now()
    };

    // Return just the batch ID to the client
    res.json({ success: true, batchId: batchId, fileCount: files.length });
  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch processing with SSE
app.get('/api/process-batch/:batchId', async (req, res) => {
  const { batchId } = req.params;
  const batchData = req.app.locals.batchFiles?.[batchId];

  if (!batchData) {
    return res.status(404).json({ success: false, error: 'Batch not found' });
  }

  // Now set up SSE - safely because this is a GET request with no body parsing
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  
  try {
    const files = batchData.files;
    const binLength = batchData.binLength;
    const totalFiles = files.length;
    const allResults = [];
    const allErrors = [];

    // Add this initial progress message
    res.write(`data: ${JSON.stringify({
      type: 'progress',
      fileIndex: 0,
      totalFiles,
      progressPercent: 0,
      filesProcessed: 0,
      currentFile: 'Starting analysis...',
      resultsSoFar: [],
      errorsSoFar: []
    })}\n\n`);
    if (res.flush) res.flush();
    
    // Small delay to ensure initial message gets to browser
    await new Promise(resolve => setTimeout(resolve, 100));
    
    console.log(`Starting to process ${totalFiles} files`);

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
      
      console.log(`Processing file ${i+1}/${totalFiles}: ${file.originalname}`);
      
      try {
        const result = await processFile(file.buffer, file.originalname);
        if (result.error) {
          allErrors.push({ filename: file.originalname, error: result.error });
        } else {
          const routePoints = await getRoutePoints(file.buffer, file.originalname);
          const bins = routePoints ? gpxBinning.getAnalysisBins(routePoints, binLength) : [];
          const hasHeartRateData = bins.some(bin => bin.avgHeartRate !== null);

          allResults.push({
            ...result.stats,
            binLength,
            bins,
            binSummary: gpxBinning.getBinSummary(bins),
            routePointCount: routePoints ? routePoints.length : 0,
            hasHeartRateData,
            fileIndex: i
          });
        }
      } catch (error) {
        allErrors.push({ filename: file.originalname, error: error.message });
      }

      console.log(`File ${i+1}/${totalFiles} complete: ${file.originalname}`);

      // Send progress update after each file
      const progress = {
        type: 'progress',
        fileIndex: i + 1,
        totalFiles,
        progressPercent: Math.round(((i + 1) / totalFiles) * 100),
        filesProcessed: allResults.length + allErrors.length,
        currentFile: file.originalname,
        resultsSoFar: allResults,
        errorsSoFar: allErrors
      };
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
      if (res.flush) res.flush();
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Send final summary
    const summary = {
      type: 'complete',
      totalFiles,
      successfulFiles: allResults.length,
      failedFiles: allErrors.length,
      results: allResults,
      errors: allErrors
    };

    res.write(`data: ${JSON.stringify(summary)}\n\n`);
    
    // Delete the batch data to free memory
    delete req.app.locals.batchFiles[batchId];
    
    res.end();
  } catch (error) {
    console.error('Batch processing error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
    
    // Clean up on error too
    delete req.app.locals.batchFiles[batchId];
  }
});


// Start the server
app.listen(PORT, () => {
  console.log(`🚀 RunGrade backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📁 Supports: GPX and FIT files`);
});