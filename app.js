// Roboflow configuration
const ROBOFLOW_API_KEY = "Hm273zwdfK88fiQf1asy";
const MODEL_ID = "smart-driver-assistant-vfbr2";
const MODEL_VERSION = "1";

// DOM Elements
const webcamElement = document.getElementById('webcam');
const overlayCanvas = document.getElementById('overlay');
const ctx = overlayCanvas.getContext('2d');
const loadingOverlay = document.getElementById('loading');
const statusBadge = document.getElementById('system-status');
const alertPanel = document.getElementById('alert-panel');
const alertIcon = document.getElementById('alert-icon');
const alertTitle = document.getElementById('alert-title');
const alertDesc = document.getElementById('alert-desc');
const fpsCounter = document.getElementById('fps-counter');
const lastAlertEl = document.getElementById('last-alert');
const startBtn = document.getElementById('start-btn');

let model;
let isMonitoring = false;
let lastAlertTime = 0;
const ALERT_COOLDOWN = 3000; // 3 seconds between beeps

// Define classes that should trigger an alert
const DANGER_CLASSES = ['drowsy', 'sleeping', 'yawning', 'distracted', 'phone', 'smoking'];

// Audio Context for Beep
let audioCtx;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playBeep() {
    if (!audioCtx) return;
    
    const now = Date.now();
    if (now - lastAlertTime < ALERT_COOLDOWN) return;
    lastAlertTime = now;
    
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'square'; // harsher sound for alert
    oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); // high pitch
    oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
}

// Setup Webcam
async function setupWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 },
            audio: false
        });
        webcamElement.srcObject = stream;
        
        return new Promise((resolve) => {
            webcamElement.onloadedmetadata = () => {
                webcamElement.play();
                // Resize canvas to match video dimensions
                overlayCanvas.width = webcamElement.videoWidth;
                overlayCanvas.height = webcamElement.videoHeight;
                resolve();
            };
        });
    } catch (error) {
        console.error("Error accessing webcam:", error);
        alert("Please allow webcam access to use the driver assistant.");
    }
}

// Draw bounding boxes
function drawPredictions(predictions) {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    
    let dangerDetected = false;
    let highestConfidenceClass = '';
    
    predictions.forEach(pred => {
        // Roboflow might return class name in lower or upper case
        const className = pred.class.toLowerCase();
        // Assume anything that isn't safe or alert is a danger (adjust based on your actual model classes)
        const isDanger = DANGER_CLASSES.includes(className) || 
                         (!['alert', 'awake', 'safe'].includes(className));
        
        if (isDanger && pred.confidence > 0.4) {
            dangerDetected = true;
            highestConfidenceClass = pred.class;
        }

        // Draw Box
        ctx.strokeStyle = isDanger ? '#ff4d4f' : '#20c997';
        ctx.lineWidth = 4;
        ctx.strokeRect(pred.x - pred.width / 2, pred.y - pred.height / 2, pred.width, pred.height);
        
        // Draw Label Background
        ctx.fillStyle = isDanger ? '#ff4d4f' : '#20c997';
        const textWidth = ctx.measureText(pred.class).width;
        ctx.fillRect(pred.x - pred.width / 2, pred.y - pred.height / 2 - 25, textWidth + 60, 25);
        
        // Draw Label Text
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px Inter';
        ctx.fillText(`${pred.class} ${Math.round(pred.confidence * 100)}%`, pred.x - pred.width / 2 + 5, pred.y - pred.height / 2 - 7);
    });
    
    updateUI(dangerDetected, highestConfidenceClass);
}

function updateUI(dangerDetected, dangerClass) {
    if (dangerDetected) {
        alertPanel.className = 'alert-panel danger';
        alertIcon.textContent = '⚠️';
        alertTitle.textContent = 'WARNING: ' + dangerClass.toUpperCase();
        alertDesc.textContent = 'Please focus on the road!';
        playBeep();
        
        const timeStr = new Date().toLocaleTimeString();
        lastAlertEl.textContent = `${dangerClass} at ${timeStr}`;
    } else {
        alertPanel.className = 'alert-panel safe';
        alertIcon.textContent = '🛡️';
        alertTitle.textContent = 'Driver is Alert';
        alertDesc.textContent = 'Monitoring for drowsiness and distractions.';
    }
}

let lastFrameTime = performance.now();

// Inference Loop
async function detectFrame() {
    if (!isMonitoring) return;
    
    try {
        // Capture frame from webcam
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = 416; // resize for faster upload
        captureCanvas.height = 416 * (webcamElement.videoHeight / webcamElement.videoWidth);
        const capCtx = captureCanvas.getContext('2d');
        capCtx.drawImage(webcamElement, 0, 0, captureCanvas.width, captureCanvas.height);
        
        const base64Image = captureCanvas.toDataURL('image/jpeg', 0.8).split(',')[1];
        
        // Call Roboflow REST API directly
        const response = await fetch(`https://detect.roboflow.com/${MODEL_ID}/${MODEL_VERSION}?api_key=${ROBOFLOW_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: base64Image
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.predictions) {
            // Scale predictions back to overlay canvas dimensions
            const scaleX = overlayCanvas.width / captureCanvas.width;
            const scaleY = overlayCanvas.height / captureCanvas.height;
            
            const scaledPredictions = data.predictions.map(p => ({
                ...p,
                x: p.x * scaleX,
                y: p.y * scaleY,
                width: p.width * scaleX,
                height: p.height * scaleY
            }));
            
            drawPredictions(scaledPredictions);
        }
        
        // Calculate FPS
        const now = performance.now();
        const fps = Math.round(1000 / (now - lastFrameTime));
        lastFrameTime = now;
        fpsCounter.textContent = fps;
        
    } catch (error) {
        console.error("Inference error:", error);
    }
    
    // Request next frame continuously (run around 5 FPS to avoid extreme rate limits)
    setTimeout(() => {
        if (isMonitoring) {
            requestAnimationFrame(detectFrame);
        }
    }, 200);
}

// Initialization
async function initApp() {
    statusBadge.textContent = "Requesting Camera...";
    await setupWebcam();
    
    statusBadge.textContent = "System Ready";
    loadingOverlay.classList.add('hidden');
    startBtn.disabled = false;
}

startBtn.addEventListener('click', () => {
    // Initialize Audio context on user interaction (browser policy requirement)
    initAudio();
    
    if (!isMonitoring) {
        isMonitoring = true;
        startBtn.textContent = 'Stop Monitoring';
        startBtn.style.background = '#ff4d4f';
        statusBadge.textContent = "Active Monitoring";
        statusBadge.classList.add('active');
        detectFrame();
    } else {
        isMonitoring = false;
        startBtn.textContent = 'Start Monitoring';
        startBtn.style.background = '';
        statusBadge.textContent = "System Ready";
        statusBadge.classList.remove('active');
        ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        updateUI(false, '');
    }
});

// Start the setup process
initApp();
