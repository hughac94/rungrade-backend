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
// Correct import based on documentation
const FitParser = require('fit-file-parser').default;
const gpxBinning = require('./gpxBinning');
const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 3001;

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

// GPX Analysis functions (keep existing ones)
function getTotalDistance(points) {
  if (!points.length) return 0;
  const toRad = deg => deg * Math.PI / 180;
  let totalDist = 0;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], curr = points[i];
    if (typeof prev.lat === 'number' && typeof prev.lon === 'number' &&
        typeof curr.lat === 'number' && typeof curr.lon === 'number') {
      const R = 6371000; // Earth radius in meters
      const dLat = toRad(curr.lat - prev.lat);
      const dLon = toRad(curr.lon - prev.lon);
      const a = Math.sin(dLat/2)**2 +
        Math.cos(toRad(prev.lat)) * Math.cos(toRad(curr.lat)) *
        Math.sin(dLon/2)**2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      totalDist += R * c;
    }
  }
  return totalDist / 1000; // Convert to km
}

function getTotalTime(points) {
  if (!points.length) return 0;
  const first = points[0].time instanceof Date ? points[0].time : null;
  const last = points[points.length - 1].time instanceof Date ? points[points.length - 1].time : null;
  if (!first || !last) return 0;
  return (last - first) / 1000; // seconds
}

function getTotalElevationGain(points) {
  let gain = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (typeof prev.ele === 'number' && typeof curr.ele === 'number') {
      const diff = curr.ele - prev.ele;
      if (diff > 0) gain += diff;
    }
  }
  return Math.round(gain);
}

// Updated FIT file processing based on documentation
function processFITFile(fileBuffer, filename) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting FIT parse for ${filename}, buffer size: ${fileBuffer.length} bytes`);
      
      // Create parser instance
      const fitParser = new FitParser({
        force: true,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: true,
        mode: 'both'  // Changed from 'list' to 'both'
      });

      // Parse the file buffer
      fitParser.parse(fileBuffer, function (error, data) {
        if (error) {
          console.error(`FIT parse error for ${filename}:`, error);
          resolve({ error: `FIT parsing failed: ${error.message || error}`, filename });
          return;
        }

        try {
          console.log(`✅ FIT parse successful for ${filename}`);
          console.log(`FIT data keys:`, Object.keys(data));
          
          // Debug the data structure
          if (data.activity) {
            console.log(`Activity found with keys:`, Object.keys(data.activity));
            
            if (data.activity.sessions) {
              console.log(`Sessions found: ${data.activity.sessions.length}`);
              if (data.activity.sessions.length > 0) {
                console.log(`First session keys:`, Object.keys(data.activity.sessions[0]));
              }
            }
            
            if (data.activity.records) {
              console.log(`Records found: ${data.activity.records.length}`);
              if (data.activity.records.length > 0) {
                console.log(`First record keys:`, Object.keys(data.activity.records[0]));
              }
            }
          }

          // Try to extract data from different possible structures
          let sessions = [];
          let records = [];

          // Check different possible locations for session and record data
          if (data.activity && data.activity.sessions) {
            sessions = data.activity.sessions;
            records = data.activity.records || [];
          } else if (data.sessions) {
            sessions = data.sessions;
            records = data.records || [];
          } else {
            // No sessions found, but maybe we have records
            records = data.activity?.records || data.records || [];
            console.log(`No sessions found, but found ${records.length} records`);
          }

          console.log(`Final: ${sessions.length} sessions, ${records.length} records`);

          // Create a session object even if none exists
          let session = {};
          if (sessions.length > 0) {
            session = sessions[0];
          } else if (records.length > 0) {
            // Create a basic session from records
            const firstRecord = records[0];
            const lastRecord = records[records.length - 1];
            session = {
              sport: 'running', // default
              start_time: firstRecord.timestamp,
              total_timer_time: lastRecord.timestamp - firstRecord.timestamp
            };
          }

          // Extract GPS points from records
          const points = records
            .filter(record => record.position_lat !== undefined && record.position_long !== undefined)
            .map(record => ({
              lat: record.position_lat * (180 / Math.pow(2, 31)), // Convert semicircles to degrees
              lon: record.position_long * (180 / Math.pow(2, 31)),
              ele: record.altitude || record.enhanced_altitude || 0,
              time: record.timestamp ? new Date(record.timestamp) : null,
              heartRate: record.heart_rate || null,
              cadence: record.cadence || null,
              speed: record.speed || record.enhanced_speed || null
            }));

          console.log(`Extracted ${points.length} GPS points from ${filename}`);

          // Calculate basic stats
          const stats = {
            filename,
            fileType: 'FIT',
            totalTime: session.total_timer_time || (points.length > 0 ? getTotalTime(points) : 0),
            distance: session.total_distance ? (session.total_distance / 1000) : (points.length > 0 ? getTotalDistance(points) : 0),
            elevationGain: session.total_ascent || (points.length > 0 ? getTotalElevationGain(points) : 0),
            pointCount: points.length,
            startTime: points.length > 0 ? points[0]?.time : (session.start_time ? new Date(session.start_time) : null),
            endTime: points.length > 0 ? points[points.length - 1]?.time : null,
            // FIT-specific data
            avgHeartRate: session.avg_heart_rate || null,
            maxHeartRate: session.max_heart_rate || null,
            avgCadence: session.avg_cadence || null,
            calories: session.total_calories || null,
            sport: session.sport || 'unknown',
            avgSpeed: session.avg_speed ? (session.avg_speed * 3.6) : null,
            maxSpeed: session.max_speed ? (session.max_speed * 3.6) : null
          };

          console.log(`✅ FIT stats for ${filename}:`, {
            distance: stats.distance,
            time: stats.totalTime,
            elevation: stats.elevationGain,
            points: stats.pointCount,
            heartRate: stats.avgHeartRate
          });

          resolve({ stats, pointCount: points.length });

        } catch (processError) {
          console.error(`Error processing FIT data for ${filename}:`, processError);
          resolve({ error: `FIT processing failed: ${processError.message}`, filename });
        }
      });

    } catch (error) {
      console.error(`Error creating FIT parser for ${filename}:`, error);
      resolve({ error: error.message, filename });
    }
  });
}

// Process both GPX and FIT files (async)
async function processFile(fileBuffer, filename) {
  const extension = filename.toLowerCase().split('.').pop();
  
  if (extension === 'gpx') {
    return processGPXFile(fileBuffer, filename);
  } else if (extension === 'fit') {
    // Now this returns a Promise, so we can await it
    return await processFITFile(fileBuffer, filename);
  } else {
    return { error: 'Unsupported file type. Only GPX and FIT files are supported.', filename };
  }
}

// GPX file processing
function processGPXFile(fileBuffer, filename) {
  try {
    const gpx = new GPXParser();
    gpx.parse(fileBuffer.toString());
    
    let rawPoints = gpx.tracks?.[0]?.points || [];
    if (!rawPoints.length && gpx.routes?.[0]?.points?.length) {
      rawPoints = gpx.routes[0].points;
    }
    
    if (!rawPoints.length) {
      return { error: 'No track data found', filename };
    }

    const points = rawPoints.map(pt => ({
      ...pt,
      time: pt.time ? new Date(pt.time) : null
    }));

    const stats = {
      filename: filename,
      fileType: 'GPX',
      totalTime: getTotalTime(points),
      distance: getTotalDistance(points),
      elevationGain: getTotalElevationGain(points),
      pointCount: points.length,
      startTime: points[0]?.time || null,
      endTime: points[points.length - 1]?.time || null,
      // GPX files don't have these fields
      avgHeartRate: null,
      maxHeartRate: null,
      avgCadence: null,
      calories: null,
      sport: 'unknown',
      avgSpeed: null,
      maxSpeed: null
    };

    return { stats, pointCount: points.length };
  } catch (error) {
    console.error(`Error processing ${filename}:`, error.message);
    return { error: error.message, filename };
  }
}

// Helper function to extract route points for binning
async function getRoutePoints(fileBuffer, filename) {
  const extension = filename.toLowerCase().split('.').pop();
  
  if (extension === 'gpx') {
    return getGPXRoutePoints(fileBuffer);
  } else if (extension === 'fit') {
    return await getFITRoutePoints(fileBuffer);
  }
  
  return null;
}

// Extract route points from GPX
function getGPXRoutePoints(fileBuffer) {
  try {
    const gpx = new GPXParser();
    gpx.parse(fileBuffer.toString());
    
    let rawPoints = gpx.tracks?.[0]?.points || [];
    if (!rawPoints.length && gpx.routes?.[0]?.points?.length) {
      rawPoints = gpx.routes[0].points;
    }
    
    return rawPoints.map(pt => ({
      lat: pt.lat,
      lon: pt.lon,
      ele: pt.ele || 0,
      time: pt.time ? new Date(pt.time) : null,
      heartRate: null, // GPX typically doesn't have HR
      cadence: null,
      speed: null
    }));
  } catch (error) {
    console.error('Error extracting GPX route points:', error);
    return null;
  }
}

// Extract route points from FIT
function getFITRoutePoints(fileBuffer) {
  console.log('getFITRoutePoints called');
  console.log('getFITRoutePoints called, buffer size:', fileBuffer.length);
  return new Promise((resolve) => {
    try {
      const fitParser = new FitParser({
        force: true,
        speedUnit: 'km/h',
        lengthUnit: 'm',
        temperatureUnit: 'celsius',
        elapsedRecordField: true,
        mode: 'both'
      });

      fitParser.parse(fileBuffer, function (error, data) {
        console.log('fitParser.parse callback called');
        if (error) {
          console.error('FIT parsing error for route points:', error);
          resolve(null);
          return;
        }

        // Try all possible locations for records
        let records = [];
        if (data.activity?.records) {
          records = data.activity.records;
        } else if (data.records) {
          records = data.records;
        } else if (Array.isArray(data.record)) {
          records = data.record;
        }
        console.log(`📍 FIT route extraction: Found ${records.length} total records (activity.records, records, or record)`);

        // More flexible position detection
        const pointsWithPosition = records.filter(record => {
          const hasLat = record.position_lat !== undefined || record.lat !== undefined;
          const hasLon = record.position_long !== undefined || record.lon !== undefined || record.lng !== undefined;
          return hasLat && hasLon;
        });

        console.log(`📍 Records with GPS position: ${pointsWithPosition.length}/${records.length}`);

        function semicirclesToDegrees(val) {
          return val * (180 / Math.pow(2, 31));
        }

        const points = pointsWithPosition.map(record => {
          const lat = (typeof record.position_lat === 'number')
            ? (Math.abs(record.position_lat) > 180 ? semicirclesToDegrees(record.position_lat) : record.position_lat)
            : record.lat;
          const lon = (typeof record.position_long === 'number')
            ? (Math.abs(record.position_long) > 180 ? semicirclesToDegrees(record.position_long) : record.position_long)
            : (record.lon || record.lng);

          return {
            lat,
            lon,
            ele: record.altitude || record.enhanced_altitude || record.elevation || 0,
            time: record.timestamp ? new Date(record.timestamp) : null,
            heartRate: record.heart_rate || record.heartRate || null,
            cadence: record.cadence || null,
            speed: record.speed || record.enhanced_speed || null
          };
        });

        console.log(`📍 Final route points for binning: ${points.length}`);
        if (points.length > 0) {
          console.log(`First point:`, points[0]);
          console.log(`Last point:`, points[points.length - 1]);
        }

        resolve(points);
      });
    } catch (error) {
      console.error('Error creating FIT parser for route points:', error);
      resolve(null);
    }
  });
}

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


// Keep existing endpoints and add new one
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: '🏃‍♂️ RunGrade backend is running!',
    supportedFormats: ['GPX', 'FIT']
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: '🏃‍♂️ RunGrade GPX & FIT Analysis Backend',
    endpoints: [
      'GET /api/health',
      'POST /api/analyze-with-bins'  // Only this one is actually used
    ],
    supportedFormats: ['GPX', 'FIT'],
    binLengths: ['25m', '50m', '100m', '200m']
  });
});



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



app.post('/api/advanced-analysis', (req, res) => {
  try {
    const { results } = req.body;
    
    const gradientPace = gpxBinning.getGradientPaceAnalysis(results);
    const paceByGradientChart = gpxBinning.getPaceByGradientChart(results);
    const gradeAdjustment = gpxBinning.getGradeAdjustmentAnalysis(results);
    
    console.log('✅ Advanced analysis complete');
    console.log('Sample gradient bucket with median:', gradientPace.buckets[0]);

    res.json({
      success: true,
      analyses: {
        gradientPace,
        paceByGradientChart,
        gradeAdjustment
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

//  batch analysis endpoint
app.post('/api/analyze-batch', upload.array('files', 100), async (req, res) => {
    console.log('--- /api/analyze-batch called ---');
  try {
    const binLength = parseInt(req.body.binLength) || 50;
    const files = req.files


    // Set up Server-Sent Events for real-time progress
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.setHeader('X-Accel-Buffering', 'no'); // For nginx
 

    if (!files || files.length === 0) {
  res.write(`data: ${JSON.stringify({ type: 'error', error: 'No files provided' })}\n\n`);
  res.end();
  return;
  }

   // Initial progress message
    res.write(`data: ${JSON.stringify({
      type: 'progress',
      fileIndex: 0,
      totalFiles: files.length,
      progressPercent: 0,
      filesProcessed: 0,
      currentFile: 'Starting analysis...',
      resultsSoFar: [],
      errorsSoFar: []
    })}\n\n`);
    if (res.flush) res.flush();
    
    // Small delay to ensure initial message gets to browser
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Log the start of processing
    console.log(`Starting to process ${files.length} files`);

    const allResults = [];
    const allErrors = [];
    const totalFiles = files.length;

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
    res.end();

  } catch (error) {
    console.error('Batch SSE error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});


// Add these two new endpoints:

// First endpoint for file upload
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

// Second endpoint for SSE processing stream
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

// Accepts JSON results, applies filters, returns filtered analysis
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
        gradeAdjustment
      },
      filteredResults
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 RunGrade backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📁 Supports: GPX and FIT files`);
});