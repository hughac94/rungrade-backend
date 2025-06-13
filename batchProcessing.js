const gpxBinning = require('./gpxBinning');

const BATCH_SIZE = 3;

async function processBatch(files, batchIndex, binLength, processFile, getRoutePoints) {
  console.log(`🔄 Processing batch ${batchIndex + 1}, files: ${files.length}`);
  
  const results = [];
  const errors = [];
  
  for (const [fileIndex, file] of files.entries()) {
    try {
      const result = await processFile(file.buffer, file.originalname);
      
      if (result.error) {
        errors.push({ filename: file.originalname, error: result.error });
      } else {
        const routePoints = await getRoutePoints(file.buffer, file.originalname);
        const bins = routePoints ? gpxBinning.getAnalysisBins(routePoints, binLength) : [];
        
        const hasHeartRateData = bins.some(bin => bin.avgHeartRate !== null);
        
        results.push({
          ...result.stats,
          binLength,
          bins,
          binSummary: gpxBinning.getBinSummary(bins),
          routePointCount: routePoints ? routePoints.length : 0,
          hasHeartRateData,
          batchIndex,
          fileIndex: batchIndex * BATCH_SIZE + fileIndex
        });
      }
    } catch (error) {
      console.error(`Error processing ${file.originalname}:`, error);
      errors.push({ filename: file.originalname, error: error.message });
    }
  }
  
  return { results, errors, batchIndex };
}

module.exports = { processBatch, BATCH_SIZE };