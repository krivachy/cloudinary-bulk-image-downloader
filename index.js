#!/usr/bin/env node

const program = require('commander');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const mkdirp = require('mkdirp');
const getDirName = require('path').dirname;
const {TaskQueue} = require('cwait');
const ProgressBar = require('progress');
const filesize = require('filesize');
const _ = require('lodash');

/*
 * COMMAND LINE SETUP
 */

program
    .version('0.0.1')
    .option('-u, --api-key <api-key>', 'cloudinary API key (get from: https://cloudinary.com/console )')
    .option('-p, --api-secret <api-secret>', 'cloudinary API secret (get from: https://cloudinary.com/console )')
    .option('-c, --cloud-name <cloud-name>', 'cloudinary cloud name')
    .option('-m, --max-result <max-result>', 'maximum results to fetch from Cloudinary admin API, default 500')
    .option('--max-parallelism <max-parallelism>', 'maximum parallel images to download at once, default 5')
    .option('--prefix <prefix>', 'cloudinary prefix to filter on (e.g. folder)')
    .option('-o --output <output>', 'output folder to download images')
    .option('-v, --verbose', 'Verbose logging')
    .parse(process.argv);

/*
 * SANITY CHECK PROGRAM INPUTS
 */

if (!process.argv.slice(2).length) {
  program.help();
}

mandatory('apiKey');
mandatory('apiSecret');
mandatory('cloudName');
mandatory('output');

if (fs.existsSync(program.output)) {
  if (!fs.lstatSync(program.output).isDirectory()) {
    console.error('Output path is not a directory: ' + program.output);
    program.help();
  }
} else {
  console.error('Output path does not exist: ' + program.output);
  program.help();
}

/*
 * PARAMS
 */

// Guarantee slash at end
const baseOutputDirectory = _.trimEnd(program.output, '/') + '/';
const adminApiBaseUrl = `https://api.cloudinary.com/v1_1/${program.cloudName}`;
const imagesApi = adminApiBaseUrl + '/resources/image/upload';
const maxResults = program.maxResult || 500;
const maxParallelism = program.maxParallelism || 5;
const axiosInstance = axios.create({
  timeout: 5000,
  auth: {
    username: program.apiKey,
    password: program.apiSecret
  }
});
const parallelAgent = new https.Agent({ maxSockets: maxParallelism });
https.globalAgent = parallelAgent;

runMain(program);

/*
 * HELPERS
 */

function log() {
  if (program.verbose) console.log.apply(this, arguments);
}

function mandatory(key) {
  if (!program[key]) {
    console.error(key + ' is mandatory.');
    program.help();
  }
}

/*
 * ADMIN API FETCHING
 */

function getNextImages(cursor) {
  log(`Getting next ${maxResults} images ${cursor ? 'after ' + cursor : ''} from ${imagesApi}`);
  return axiosInstance
      .get(imagesApi, {
        params: {
          max_results: maxResults,
          next_cursor: cursor,
          prefix: program.prefix
        }
      })
      .then(response => {
        const remainingCount = response.headers['x-featureratelimit-remaining'] || 'N/A';
        const resetTime = response.headers['x-featureratelimit-reset'] || 'N/A';
        const imageCount = response.data && response.data.resources && response.data.resources.length ? response.data.resources.length : 0;
        log(`Returned ${imageCount} images, remaining Cloudinary Admin API calls: ${remainingCount} (Reset: ${resetTime})`);
        return response.data;
      });
}

function recursivelyGetImages(accumulatedImages, cursor) {
  return getNextImages(cursor).then(result => {
    const updatedImages = accumulatedImages.concat(_.filter(result.resources, keepNeededProperties));
    if (result['next_cursor']) {
      return recursivelyGetImages(updatedImages, result['next_cursor'])
    } else {
      return updatedImages;
    }
  });
}

function keepNeededProperties(imageResource) {
  return _.pick(imageResource, ['public_id', 'format', 'bytes', 'secure_url']);
}

function getAllImages() {
  return recursivelyGetImages([]);
}

/*
 * IMAGE DOWNLOADING
 */

function createOutputDirectoryIfNeeded(output) {
  return new Promise(function (resolve, reject) {
    mkdirp(getDirName(output), function (err) {
      if (err) reject(err);
      resolve(output);
    });
  })
}

function downloadImageTo(imageUrl, destination) {
  return new Promise(function (resolve, reject) {
    const file = fs.createWriteStream(destination);
    https.get(imageUrl, function (response) {
      response.pipe(file);
      file.on('finish', function () {
        file.close(() => resolve(imageUrl));  // close() is async, call cb after close completes.
      });
    }).on('error', function (err) { // Handle errors
      fs.unlink(destination, _.noop); // Delete the file async. (But we don't check the result)
      reject(err.message);
    });
  });
}

function processImageWithProgress(imageResource, logger, imageBytesCompleteCb) {
  const {index} = imageResource;
  const outputFile = baseOutputDirectory + imageResource.public_id + '.' + imageResource.format;
  logger(`${index}: Downloading image from ${imageResource.secure_url} to ${outputFile}`);
  return createOutputDirectoryIfNeeded(outputFile)
      .then(file => downloadImageTo(imageResource.secure_url, file))
      .then(result => {
        logger(`${index}: Successfully downloaded image from ${imageResource.secure_url} to ${outputFile}`);
        imageBytesCompleteCb(imageResource.bytes);
        return result;
      })
      .catch(err => {
        const message = `[ERROR] ${index}: Failed to download image from ${imageResource.secure_url} to ${outputFile}`;
        console.error(message, err);
        logger(message, err);
      });
}

function processImage(logger, imageBytesCompleteCb) {
  return imageResource => processImageWithProgress(imageResource, logger, imageBytesCompleteCb);
}

function createProgressBarForImageBytes(totalImagesBytes) {
  const bar = new ProgressBar('=> downloading images from cloudinary [:bar] :percent   [:currentB/:totalB :rateBps] [elapsed=:elapseds ETA=:etas]', {
    complete: '=',
    incomplete: ' ',
    width: 30,
    total: totalImagesBytes
  });
  function logger() {
    if (program.verbose) {
      bar.interrupt.apply(bar, arguments);
    }
  }
  // Call this with the number of bytes to update the progress bar
  function tick(length) {
    return bar.tick(length);
  }
  const intervalTimer = setInterval(function () {
    bar.tick(0);
  }, 1000);
  return {
    logger,
    tick,
    intervalTimer
  }
}

/*
 * MAIN
 */

function runMain() {
  console.log('Fetching images from Cloudinary Admin API endpoint: ' + imagesApi);
  getAllImages()
      .then(images => _.map(images, (image, index) => _.assign(image, {index})))
      .then(images => {
        const totalImagesBytes = _.sumBy(images, 'bytes');
        console.log(`Preparing to download ${images.length} images totalling ${filesize(totalImagesBytes)}`);
        // Create a progress bar for niceness
        const {logger, tick, intervalTimer} = createProgressBarForImageBytes(totalImagesBytes);
        // Only run N requests in parallel
        const queue = new TaskQueue(Promise, maxParallelism);
        return Promise
            .all(images.map(queue.wrap(processImage(logger, tick))))
            .then(images => {
              clearInterval(intervalTimer);
              return images;
            });
      })
      .then(images => {
        console.log(`Downloaded ${images.length} images to ${baseOutputDirectory}`)
      })
      .catch(err => console.error(err));
}
