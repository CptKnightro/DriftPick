console.log("DriftPick: Loaded and watching.");

// Configuration
let faceMesh;
let isTracking = false;

// State
let calibrationData = []; // { inputs: [iX, iY], target: [sX, sY] }
let isCalibrating = false;

// Indices (MediaPipe)
const LEFT_IRIS = [474, 475, 476, 477];
const LEFT_PUPIL = 468;
const LEFT_EYE_LEFT = 33;
const LEFT_EYE_RIGHT = 133;

// Instantiate Logic Managers
// @ts-ignore
const productDetector = new ProductDetector();
// @ts-ignore
const scoringManager = new ScoringManager();

// 1. UI Elements
const btn = document.createElement("button");
btn.id = "driftpick-start-btn";
btn.innerText = "dp";
document.body.appendChild(btn);

const gazeCursor = document.createElement("div");
gazeCursor.id = "gaze-cursor";
gazeCursor.style.display = "none";
document.body.appendChild(gazeCursor);

const video = document.createElement("video");
video.id = "driftpick-video";
video.style.transform = "scaleX(-1)";
video.style.display = "none";
video.autoplay = true;
video.onloadedmetadata = () => {
    video.width = video.videoWidth;
    video.height = video.videoHeight;
};
document.body.appendChild(video);

// 2. Math Helpers (KNN Regression)
function predictGaze(inputs, data) {
    if (!data || data.length === 0) return null;

    // KNN Regression
    const K = 5; // Increased K for stability
    const items = data.map(d => {
        const dist = Math.sqrt(
            Math.pow(d.inputs[0] - inputs[0], 2) +
            Math.pow(d.inputs[1] - inputs[1], 2)
        );
        return { dist, target: d.target };
    });

    items.sort((a, b) => a.dist - b.dist);
    const topK = items.slice(0, K);

    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;

    for (let item of topK) {
        const weight = 1 / (item.dist + 1e-6);
        totalWeight += weight;
        sumX += item.target[0] * weight;
        sumY += item.target[1] * weight;
    }

    return [sumX / totalWeight, sumY / totalWeight];
}

// 3. Calibration Manager
async function startCalibration() {
    isCalibrating = true;
    calibrationData = [];
    btn.innerText = "Calibrating...";
    alert("Calibration Mode: Look at the RED dots and CLICK them.");

    // 9-point Grid
    const points = [
        { x: 10, y: 10 }, { x: 50, y: 10 }, { x: 90, y: 10 },
        { x: 10, y: 50 }, { x: 50, y: 50 }, { x: 90, y: 50 },
        { x: 10, y: 90 }, { x: 50, y: 90 }, { x: 90, y: 90 }
    ];

    for (let i = 0; i < points.length; i++) {
        await showCalibrationPoint(points[i].x, points[i].y);
    }

    if (calibrationData.length < 5) {
        alert("Calibration Failed: Not enough data points collected. Please ensure your face is well-lit and visible.");
        isCalibrating = false;
        btn.innerText = "CALIBRATE (Try Again)";
        return;
    }

    // Save Data
    chrome.storage.local.set({ calibrationData: calibrationData }, () => {
        console.log("Calibration saved:", calibrationData.length);
    });

    alert("Calibration Complete! Gaze Tracking Active.");
    isCalibrating = false;
    btn.innerText = "Running";
    gazeCursor.style.display = "block";

    const pt = document.querySelector('.calibration-point');
    if (pt) pt.remove();
}

function showCalibrationPoint(xPct, yPct) {
    return new Promise(resolve => {
        const pt = document.createElement("div");
        pt.className = "calibration-point";
        pt.style.left = xPct + "%";
        pt.style.top = yPct + "%";
        document.body.appendChild(pt);

        const clickHandler = () => {
            // Check if we have tracking data
            if (!latestFeatures) {
                // Flash blue to indicate error/no-face
                pt.style.backgroundColor = "blue";
                setTimeout(() => pt.style.backgroundColor = "red", 200);
                console.warn("DriftPick: No face detected during click!");
                return; // Do not resolve, make them click again when ready
            }

            // Record Data
            const screenX = window.innerWidth * (xPct / 100);
            const screenY = window.innerHeight * (yPct / 100);

            // Push multiple samples
            calibrationData.push({
                inputs: latestFeatures,
                target: [screenX, screenY]
            });
            console.log("Recorded Point:", screenX, screenY);

            pt.remove();
            resolve(true);
        };

        pt.addEventListener("click", clickHandler);
    });
}


// 4. Initialization
async function initFaceMesh() {
    console.log("DriftPick: Initializing FaceMesh...");
    // @ts-ignore
    faceMesh = new FaceMesh({
        locateFile: (file) => {
            return chrome.runtime.getURL(`lib/mediapipe/${file}`);
        }
    });

    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    faceMesh.onResults(onResults);
    console.log("DriftPick: FaceMesh initialized.");
}

let latestFeatures = null;

// 5. Results Loop
function onResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) return;
    const landmarks = results.multiFaceLandmarks[0];

    // Feature Extraction
    const pupil = landmarks[LEFT_PUPIL];
    const leftCorner = landmarks[LEFT_EYE_LEFT];
    const rightCorner = landmarks[LEFT_EYE_RIGHT];

    // Vector arithmetic
    const eyeWidth = Math.sqrt(Math.pow(rightCorner.x - leftCorner.x, 2) + Math.pow(rightCorner.y - leftCorner.y, 2));

    // Normalize iris position relative to eye width
    const relX = (pupil.x - leftCorner.x) / eyeWidth;
    const relY = (pupil.y - leftCorner.y) / eyeWidth;

    latestFeatures = [relX, relY];

    if (isCalibrating) {
        // Do nothing
    } else if (calibrationData.length > 0) {
        // Predict
        const prediction = predictGaze(latestFeatures, calibrationData);
        if (prediction) {
            const [pX, pY] = prediction;
            moveCursor(pX, pY);

            // --- SCORING LOGIC ---
            // Use hit tests
            const element = document.elementFromPoint(pX, pY);
            if (element) {
                const card = productDetector.findProductCard(element);
                const asin = productDetector.getProductId(card);

                // Update Scoring (pass null if looking at nothing, to reset timers or log drift)
                scoringManager.update(asin, Date.now());

                // Optional: Highlight card?
                // if(card) card.style.outline = "2px solid red";
            }
        }
    }
}

function moveCursor(x, y) {
    // Basic smoothing could be added here
    gazeCursor.style.transform = `translate(${x}px, ${y}px)`;
}

// 6. Start 
async function startTracking() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;

        await initFaceMesh();

        // Load existing calibration
        chrome.storage.local.get(['calibrationData'], (result) => {
            if (result.calibrationData) {
                calibrationData = result.calibrationData;
                console.log("Loaded calibration:", calibrationData.length);
                if (calibrationData.length > 0) gazeCursor.style.display = "block";
            }
        });

        isTracking = true;
        const sendFrame = async () => {
            if (!isTracking) return;
            if (video.readyState >= 2) {
                await faceMesh.send({ image: video });
            }
            requestAnimationFrame(sendFrame);
        };
        sendFrame();

        btn.innerText = "CALIBRATE";
        btn.classList.add("recording");
        btn.onclick = startCalibration;

        alert("Camera Active! Click 'CALIBRATE' to setup.");

    } catch (err) {
        console.error(err);
        alert(err.message);
    }
}

btn.addEventListener("click", () => {
    if (!isTracking) startTracking();
});