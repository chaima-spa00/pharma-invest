// Global Database State
let workers = [];
let operations = [];
let activeWorker = null; // Current scanned worker in session
let currentScannerMode = 'camera'; // 'camera' or 'manual'
let html5QrScanner = null;
let loginQrScanner = null;
let loggedInUser = null;
let productivityChart = null;

// Scan cooldown: prevent reading same code twice in a row (camera loop)
let lastScannedCode = null;
let lastScanTime = 0;
const SCAN_COOLDOWN_MS = 3000; // 3 seconds between scans

// Default Mock Data for Demonstration (Left Empty as Requested)
const defaultWorkers = [];
const defaultOperations = [];

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initDatabase();
    initDateTime();
    renderAllViews();

    // System Auth Check
    checkSystemLogin();

    // Automatically load active worker session if present
    loadActiveWorkerSession();
});

// Initialize database from LocalStorage or load default mock data
function initDatabase() {
    try {
        if (localStorage.getItem("pharma_workers")) {
            workers = JSON.parse(localStorage.getItem("pharma_workers"));
        } else {
            workers = [...defaultWorkers];
        }
        if (localStorage.getItem("pharma_operations")) {
            operations = JSON.parse(localStorage.getItem("pharma_operations"));
        } else {
            operations = [...defaultOperations];
        }
    } catch (e) {
        console.error("Failed to parse local storage:", e);
    }

    // Ensure we have at least one directeur
    if (!workers.some(w => w.role === 'directeur')) {
        workers.push({
            id: 'ADMIN',
            name: 'مدير النظام (افتراضي)',
            role: 'directeur'
        });
    }

    // Firebase Sync
    if (window.db) {
        window.db.ref('pharma_workers').on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                workers = Array.isArray(data) ? data : Object.values(data);
                localStorage.setItem("pharma_workers", JSON.stringify(workers));
            } else {
                window.db.ref('pharma_workers').set(workers);
            }
            renderAllViews();
        });

        window.db.ref('pharma_operations').on('value', (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                operations = Array.isArray(data) ? data : Object.values(data);
                // Sort by timestamp descending to maintain order (newest first)
                operations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                localStorage.setItem("pharma_operations", JSON.stringify(operations));
            }
            renderAllViews();
            // Refresh table states specifically for controller
            updateActiveControllerUI();
        });
    }
}

// ==========================================================================
// SYSTEM AUTHENTICATION LOGIC
// ==========================================================================
function checkSystemLogin() {
    const saved = localStorage.getItem("pharma_system_user");
    if (saved) {
        const user = JSON.parse(saved);
        const exists = workers.find(w => w.id === user.id);
        if (exists && (exists.role === 'directeur' || exists.role === 'controleur')) {
            setupSystemUser(exists);
            return;
        } else {
            logoutSystem();
        }
    } else {
        document.getElementById("login-screen").style.display = "flex";
        document.getElementById("main-app").style.display = "none";
    }
}

function handleLoginSubmit() {
    const code = document.getElementById("login-worker-id").value.trim();
    if (!code) return;

    processLoginCode(code);
}

function processLoginCode(code) {
    const cleanCode = code.trim();
    const user = workers.find(w => w.id.toUpperCase() === cleanCode.toUpperCase());
    if (!user) {
        alert("المعرف غير مسجل في النظام.");
        return;
    }

    if (user.role === 'preparateur') {
        alert("عذراً، المحضر ليس لديه صلاحية الدخول للنظام.");
        return;
    }

    setupSystemUser(user);
    if (loginQrScanner) {
        loginQrScanner.stop().catch(e => console.log(e));
        loginQrScanner = null;
    }
}

function startLoginScanner() {
    if (loginQrScanner) return;
    document.getElementById("login-qr-reader").style.display = "block";

    if (typeof Html5Qrcode === 'undefined') {
        alert("مكتبة قارئ الـ QR غير محملة.");
        return;
    }

    loginQrScanner = new Html5Qrcode("login-qr-reader");
    loginQrScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            processLoginCode(decodedText);
        },
        (err) => { }
    ).catch(err => {
        alert("تعذر تشغيل الكاميرا.");
        loginQrScanner = null;
    });
}

function setupSystemUser(user) {
    loggedInUser = user;
    localStorage.setItem("pharma_system_user", JSON.stringify(user));

    document.getElementById("login-screen").style.display = "none";
    document.getElementById("main-app").style.display = "flex";

    document.getElementById("current-logged-user").innerHTML = `${user.name} <span class="badge ${user.role === 'directeur' ? 'badge-preparator' : 'badge-controleur'}">${user.role === 'directeur' ? 'مدير' : 'مراقب'}</span>`;

    // Filter Navigation Menu Based on Role
    const navItems = document.querySelectorAll(".nav-item");
    let firstAllowedTab = null;

    navItems.forEach(item => {
        const allowedRoles = item.getAttribute("data-role");
        if (allowedRoles && allowedRoles.includes(user.role)) {
            item.style.display = "flex";
            if (!firstAllowedTab) {
                firstAllowedTab = item.getAttribute("href").replace("#", "");
            }
        } else {
            item.style.display = "none";
        }
    });

    // Auto-login active worker logic if current mapped to it
    if (user.role === 'controleur') {
        // Log in the controller into the worker session automatically
        setupActiveWorker(user);
    }

    if (firstAllowedTab) {
        switchTab(firstAllowedTab);
    }
}

function logoutSystem() {
    loggedInUser = null;
    localStorage.removeItem("pharma_system_user");
    clearActiveWorker(); // also clear worker session
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("main-app").style.display = "none";
    document.getElementById("login-worker-id").value = "";
    document.getElementById("login-qr-reader").style.display = "none";
    if (loginQrScanner) {
        loginQrScanner.stop().catch(e => console.log(e));
        loginQrScanner = null;
    }
}

function saveDatabase() {
    localStorage.setItem("pharma_workers", JSON.stringify(workers));
    localStorage.setItem("pharma_operations", JSON.stringify(operations));

    // Save to Firebase (this will automatically trigger .on('value') for everyone else)
    if (window.db) {
        window.db.ref('pharma_workers').set(workers);
        window.db.ref('pharma_operations').set(operations);
    }
}

// Display Live Date in Arabic format
function initDateTime() {
    const dateEl = document.getElementById("live-date");
    if (!dateEl) return;

    const updateTime = () => {
        const now = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        let dateStr = now.toLocaleDateString('ar-DZ', options);
        let timeStr = now.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        dateEl.textContent = `${dateStr} | ${timeStr}`;
    };

    updateTime();
    setInterval(updateTime, 1000);
}

// Global view renderer
function renderAllViews() {
    renderStats();
    renderCharts();
    renderLeaderboard();
    renderPendingTasksTable();
    renderWorkersTable();
    renderFullLogsTable();
    populateManualWorkersDropdown();
    populateFiltersDropdowns();
    populateControllersDropdown();
}

// ==========================================================================
// TABS NAVIGATION
// ==========================================================================
function switchTab(tabId) {
    // Update active nav link
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => {
        item.classList.remove("active");
        if (item.getAttribute("href") === `#${tabId}`) {
            item.classList.add("active");
        }
    });

    // Update active section
    const sections = document.querySelectorAll(".view-section");
    sections.forEach(section => {
        section.classList.remove("active");
    });

    const targetSection = document.getElementById(`view-${tabId}`);
    if (targetSection) {
        targetSection.classList.add("active");
    }

    // Page title adjustments
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) {
        switch (tabId) {
            case "dashboard": pageTitle.textContent = "لوحة الإحصائيات العامة"; break;
            case "scanner": pageTitle.textContent = "تسجيل العمليات ببطاقات QR"; break;
            case "control": pageTitle.textContent = "مراقبة وتأكيد الجودة"; break;
            case "workers": pageTitle.textContent = "إدارة عمال المستودع"; break;
            case "logs": pageTitle.textContent = "سجل العمليات الإجمالي"; break;
        }
    }

    // QR scanner life-cycle control
    if (tabId === 'scanner' && currentScannerMode === 'camera') {
        startQRScanner();
    } else {
        stopQRScanner();
    }
}

// ==========================================================================
// STATS & DASHBOARD VISUALIZATIONS
// ==========================================================================
function renderStats() {
    const today = new Date().toDateString();

    // Filter operations today
    const opsToday = operations.filter(op => new Date(op.timestamp).toDateString() === today);

    // Lines prepared today
    const linesPrepared = opsToday.reduce((sum, op) => sum + op.lines, 0);
    document.getElementById("stat-lines-prepared").textContent = linesPrepared.toLocaleString('ar-DZ');

    // Lines controlled today
    const linesControlled = opsToday
        .filter(op => op.status === 'controlled')
        .reduce((sum, op) => sum + op.lines, 0);
    document.getElementById("stat-lines-controlled").textContent = linesControlled.toLocaleString('ar-DZ');

    // Lines pending verification (all time pending)
    const linesPending = operations
        .filter(op => op.status === 'pending')
        .reduce((sum, op) => sum + op.lines, 0);
    document.getElementById("stat-lines-pending").textContent = linesPending.toLocaleString('ar-DZ');

    // Active workers today (who made either preparations or controls)
    const workersTodaySet = new Set();
    opsToday.forEach(op => {
        workersTodaySet.add(op.workerId);
        if (op.controllerId) workersTodaySet.add(op.controllerId);
    });
    document.getElementById("stat-active-workers-count").textContent = workersTodaySet.size.toString();
}

function renderLeaderboard() {
    const container = document.getElementById("leaderboard-container");
    if (!container) return;

    const today = new Date().toDateString();
    const opsToday = operations.filter(op => new Date(op.timestamp).toDateString() === today);

    // Aggregate lines per worker
    const workerStats = {};
    opsToday.forEach(op => {
        if (!workerStats[op.workerId]) {
            workerStats[op.workerId] = {
                name: op.workerName,
                lines: 0,
                tasksCount: 0
            };
        }
        workerStats[op.workerId].lines += op.lines;
        workerStats[op.workerId].tasksCount += 1;
    });

    // Convert to sorted array
    const sortedWorkers = Object.keys(workerStats).map(id => ({
        id,
        ...workerStats[id]
    })).sort((a, b) => b.lines - a.lines);

    if (sortedWorkers.length === 0) {
        container.innerHTML = `<p class="empty-state">لا توجد بيانات مسجلة لليوم بعد.</p>`;
        return;
    }

    container.innerHTML = sortedWorkers.map((w, index) => {
        let rankClass = "rank-default";
        let trophy = "";

        if (index === 0) {
            rankClass = "rank-1";
            trophy = '<i class="fa-solid fa-trophy" style="color: var(--color-amber);"></i>';
        } else if (index === 1) {
            rankClass = "rank-2";
            trophy = '<i class="fa-solid fa-medal" style="color: #ccc;"></i>';
        } else if (index === 2) {
            rankClass = "rank-3";
            trophy = '<i class="fa-solid fa-medal" style="color: #cd7f32;"></i>';
        }

        return `
            <div class="ranking-item">
                <div class="ranking-user">
                    <span class="rank-badge ${rankClass}">${index + 1}</span>
                    <span class="ranking-name">${w.name} ${trophy}</span>
                </div>
                <div class="ranking-score">
                    <span class="score-value">${w.lines}</span>
                    <span class="score-unit">سطر (${w.tasksCount} طلبيات)</span>
                </div>
            </div>
        `;
    }).join("");
}

function renderCharts() {
    const canvas = document.getElementById("chart-productivity");
    if (!canvas) return;

    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is not loaded.");
        canvas.style.display = 'none';
        let parent = canvas.parentElement;
        let placeholder = parent.querySelector(".chart-placeholder");
        if (!placeholder) {
            placeholder = document.createElement("div");
            placeholder.className = "chart-placeholder empty-state";
            placeholder.innerHTML = `<i class="fa-solid fa-chart-simple" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 10px; display: block;"></i>مكتبة الرسوم البيانية غير محملة (تحقق من اتصال الإنترنت)`;
            parent.appendChild(placeholder);
        }
        return;
    }

    const today = new Date().toDateString();
    const opsToday = operations.filter(op => new Date(op.timestamp).toDateString() === today);

    // Sum lines per worker for chart
    const dataMap = {};
    opsToday.forEach(op => {
        dataMap[op.workerName] = (dataMap[op.workerName] || 0) + op.lines;
    });

    const labels = Object.keys(dataMap);
    const dataValues = Object.values(dataMap);

    // Destroy previous chart instance if exists
    if (productivityChart) {
        productivityChart.destroy();
    }

    if (labels.length === 0) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Show text in canvas container
        canvas.style.display = 'none';
        let parent = canvas.parentElement;
        let placeholder = parent.querySelector(".chart-placeholder");
        if (!placeholder) {
            placeholder = document.createElement("div");
            placeholder.className = "chart-placeholder empty-state";
            placeholder.innerHTML = `<i class="fa-solid fa-chart-simple" style="font-size: 2.5rem; opacity: 0.3; margin-bottom: 10px; display: block;"></i>في انتظار تسجيل أولى عمليات اليوم لرسم المخطط البياني`;
            parent.appendChild(placeholder);
        }
        return;
    }

    canvas.style.display = 'block';
    const placeholder = canvas.parentElement.querySelector(".chart-placeholder");
    if (placeholder) placeholder.remove();

    const ctx = canvas.getContext('2d');
    productivityChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'عدد الأسطر المنجزة',
                data: dataValues,
                backgroundColor: 'rgba(0, 242, 254, 0.25)',
                borderColor: '#00f2fe',
                borderWidth: 2,
                borderRadius: 8,
                hoverBackgroundColor: 'rgba(0, 242, 254, 0.4)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal bars
            plugins: {
                legend: { display: false },
                tooltip: {
                    titleFont: { family: 'Cairo' },
                    bodyFont: { family: 'Cairo' },
                    rtl: true
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#b3b3b3', font: { family: 'Cairo' } }
                },
                y: {
                    grid: { display: false },
                    ticks: { color: '#ffffff', font: { family: 'Cairo', weight: 'bold' } }
                }
            }
        }
    });
}

// ==========================================================================
// ACTIVE WORKER STATE & QR CODES
// ==========================================================================
function loadActiveWorkerSession() {
    const saved = localStorage.getItem("pharma_active_worker");
    if (saved) {
        const worker = JSON.parse(saved);
        // Verify worker still exists in DB
        const exists = workers.find(w => w.id === worker.id);
        if (exists) {
            setupActiveWorker(exists);
        } else {
            clearActiveWorker();
        }
    }
}

function setupActiveWorker(worker) {
    activeWorker = worker;
    localStorage.setItem("pharma_active_worker", JSON.stringify(worker));

    // Update Header Status Widget
    const statusVal = document.getElementById("current-active-worker");
    const logoutBtn = document.getElementById("logout-worker-btn");
    statusVal.innerHTML = `${worker.name} <span class="badge ${worker.role === 'preparateur' ? 'badge-preparator' : 'badge-controleur'}">${worker.role === 'preparateur' ? 'محضّر' : 'مراقب'}</span>`;
    logoutBtn.style.display = "inline-block";

    // Update Action Panel on Scanning page
    const scanPrompt = document.getElementById("worker-scan-prompt");
    const scanResult = document.getElementById("worker-scan-result");
    const scannedName = document.getElementById("scanned-worker-name");
    const scannedRole = document.getElementById("scanned-worker-role");
    const scannedId = document.getElementById("scanned-worker-id-display");

    scanPrompt.style.display = "none";
    scanResult.style.display = "block";
    scannedName.textContent = worker.name;
    scannedId.textContent = `المعرف: ${worker.id}`;

    const formPrep = document.getElementById("form-preparateur");
    const formCtrl = document.getElementById("form-controleur-info");

    if (worker.role === 'preparateur') {
        scannedRole.textContent = "مُحضِّر (Préparateur)";
        scannedRole.className = "badge badge-preparator";
        formPrep.style.display = "block";
        formCtrl.style.display = "none";
    } else {
        scannedRole.textContent = "مُراقِب (Contrôleur)";
        scannedRole.className = "badge badge-controleur";
        formPrep.style.display = "none";
        formCtrl.style.display = "block";

        // Update active controller in Verification tab
        updateActiveControllerUI();

        // Populate Delegate Dropdown (Rule 3)
        const delegateSelect = document.getElementById("delegate-preparateur");
        if (delegateSelect) {
            const assignedPreparers = workers.filter(w => w.role === 'preparateur' && w.controllerId === worker.id);
            if (assignedPreparers.length > 0) {
                delegateSelect.innerHTML = assignedPreparers.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join("");
                document.querySelector(".controller-delegate-section").style.display = "block";
            } else {
                delegateSelect.innerHTML = '<option value="">لا يوجد محضّرين تابعين لك</option>';
                document.querySelector(".controller-delegate-section").style.display = "none";
            }
        }
    }

    // Play a subtle notification sound (web audio API) if user scans successfully
    playBeep();
}

function clearActiveWorker() {
    activeWorker = null;
    localStorage.removeItem("pharma_active_worker");

    // Reset Top Widget
    document.getElementById("current-active-worker").textContent = "لم يتم مسح أي رمز";
    document.getElementById("logout-worker-btn").style.display = "none";

    // Reset Action Panel
    document.getElementById("worker-scan-prompt").style.display = "flex";
    document.getElementById("worker-scan-result").style.display = "none";
    document.getElementById("form-preparateur").style.display = "none";
    document.getElementById("form-controleur-info").style.display = "none";

    // Reset forms inputs
    document.getElementById("prep-lines-count").value = "";
    document.getElementById("prep-order-ref").value = "";
    const badge = document.getElementById("scanned-order-badge");
    if (badge) { badge.style.display = "none"; badge.textContent = ""; }

    // Reset scanner hint and cooldown for next scan session
    lastScannedCode = null;
    lastScanTime = 0;
    updateScannerHint('default');

    // Update active controller UI
    updateActiveControllerUI();
}

function updateActiveControllerUI() {
    const bannerName = document.getElementById("active-controller-name");
    const btnApprove = document.getElementById("btn-approve-selected");

    if (activeWorker && activeWorker.role === 'controleur') {
        bannerName.textContent = activeWorker.name;
        // Enable selection in table and validation button
        document.getElementById("active-controller-banner").style.backgroundColor = "hsla(142, 70%, 45%, 0.1)";
        document.getElementById("active-controller-banner").style.borderColor = "var(--color-green)";
        document.getElementById("active-controller-banner").style.color = "var(--color-green)";
    } else {
        bannerName.textContent = "لا يوجد مراقب نشط";
        document.getElementById("active-controller-banner").style.backgroundColor = "hsla(38, 90%, 55%, 0.1)";
        document.getElementById("active-controller-banner").style.borderColor = "var(--color-amber)";
        document.getElementById("active-controller-banner").style.color = "var(--color-amber)";
        btnApprove.disabled = true;
    }

    renderPendingTasksTable(); // Refresh table state
}

// Sound indicator for QR code scan
function playBeep() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = 800; // Pitch
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volume

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15); // Duration 150ms
    } catch (e) {
        console.log("Audio not supported or blocked by user gesture yet.");
    }
}

// ==========================================================================
// QR CODE SCANNING SERVICE (HTML5-QRCODE)
// ==========================================================================
function setScannerMode(mode) {
    currentScannerMode = mode;

    const btnCam = document.getElementById("btn-mode-camera");
    const btnMan = document.getElementById("btn-mode-manual");
    const camContainer = document.getElementById("camera-scanner-container");
    const manContainer = document.getElementById("manual-scanner-container");

    if (mode === 'camera') {
        btnCam.classList.add("active");
        btnMan.classList.remove("active");
        camContainer.style.display = "block";
        manContainer.style.display = "none";
        startQRScanner();
    } else {
        btnCam.classList.remove("active");
        btnMan.classList.add("active");
        camContainer.style.display = "none";
        manContainer.style.display = "block";
        stopQRScanner();
        populateManualWorkersDropdown();
    }
}

function startQRScanner() {
    // If scanner is already running, do nothing
    if (html5QrScanner) return;

    // Small delay to ensure the DOM element is fully visible before initializing
    setTimeout(() => {
        const qrReader = document.getElementById("qr-reader");
        if (!qrReader) return;

        if (typeof Html5Qrcode === 'undefined') {
            console.error("Html5Qrcode library is not loaded.");
            qrReader.innerHTML = `
                <div class="info-alert info-alert-purple text-center" style="margin: 20px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <p>مكتبة قارئ الـ QR غير محملة. يرجى التحقق من اتصال الإنترنت.<br>يمكنك استخدام <strong>"الإدخال اليدوي"</strong> المتاح في الأعلى.</p>
                </div>
            `;
            return;
        }

        html5QrScanner = new Html5Qrcode("qr-reader");

        const config = {
            fps: 12,
            qrbox: function (width, height) {
                // Return dynamic size relative to container size for responsive screens (especially mobile)
                let min = Math.min(width, height);
                return { width: min * 0.7, height: min * 0.7 };
            }
        };

        html5QrScanner.start(
            { facingMode: "environment" }, // Request back camera
            config,
            (decodedText) => {
                // Success Scan callback
                handleWorkerIdentification(decodedText);
            },
            (errorMessage) => {
                // Verbose scanning error, can be ignored as it prints on every frame failure
            }
        ).catch(err => {
            console.error("Camera scan start error:", err);
            // Fallback UI to show camera is blocked/unavailable
            qrReader.innerHTML = `
                <div class="info-alert info-alert-purple text-center" style="margin: 20px;">
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <p>تعذر تشغيل الكاميرا. قد يكون ذلك بسبب الصلاحيات أو عدم دعم المتصفح. <br>يرجى استخدام <strong>"الإدخال اليدوي"</strong> المتاح في الأعلى.</p>
                </div>
            `;
            html5QrScanner = null;
        });
    }, 200);
}

function stopQRScanner() {
    if (html5QrScanner) {
        html5QrScanner.stop().then(() => {
            html5QrScanner = null;
            const qrReader = document.getElementById("qr-reader");
            if (qrReader) qrReader.innerHTML = ""; // Clean up
        }).catch(err => {
            console.error("Failed to stop QR scanner:", err);
            html5QrScanner = null;
        });
    }
}

function handleWorkerIdentification(workerCode) {
    const cleanCode = workerCode.trim();
    const now = Date.now();

    // === COOLDOWN CHECK: ignore same code scanned repeatedly in a loop ===
    if (cleanCode === lastScannedCode && (now - lastScanTime) < SCAN_COOLDOWN_MS) {
        return; // Ignore duplicate scan within cooldown window
    }
    lastScannedCode = cleanCode;
    lastScanTime = now;

    // === SMART DUAL-MODE SCAN ===
    // If a PREPARATEUR is already logged in, treat new scan as an ORDER QR code
    if (activeWorker && activeWorker.role === 'preparateur') {
        // Check if the scanned code matches an existing worker (e.g. accident)
        const isWorker = workers.find(w => w.id.trim().toUpperCase() === cleanCode.toUpperCase());
        if (isWorker) {
            // It IS another worker: log out current and log in the new one
            lastScannedCode = null; // reset cooldown for new worker
            setupActiveWorker(isWorker);
            return;
        }

        // Otherwise: treat the code as an ORDER/reference number
        const refInput = document.getElementById("prep-order-ref");
        const badge = document.getElementById("scanned-order-badge");
        if (refInput) {
            refInput.value = cleanCode;
            if (badge) {
                badge.textContent = `✔ طلبية ممسوحة: ${cleanCode}`;
                badge.style.display = "inline-block";
            }
            refInput.style.borderColor = "var(--color-green)";
            refInput.style.boxShadow = "0 0 10px var(--color-green-glow)";
            setTimeout(() => {
                refInput.style.borderColor = "";
                refInput.style.boxShadow = "";
            }, 2000);
            playBeep();
            // Update camera overlay message
            updateScannerHint('order-done');
        }
        return;
    }

    // === NORMAL MODE: First scan → identify a worker ===
    const worker = workers.find(w => w.id.trim().toUpperCase() === cleanCode.toUpperCase());
    if (worker) {
        setupActiveWorker(worker);
        // After worker login, show hint to scan the order
        if (worker.role === 'preparateur') {
            updateScannerHint('scan-order');
        }
    } else {
        alert("المعرف أو الرمز غير مسجل في قاعدة البيانات: " + cleanCode);
        lastScannedCode = null; // allow retry
    }
}

// Update the text hint shown inside the camera scanning area
function updateScannerHint(mode) {
    const tipEl = document.querySelector('.scanner-tip');
    if (!tipEl) return;
    if (mode === 'scan-order') {
        tipEl.innerHTML = `<strong style="color: var(--color-green); font-size: 0.9rem;">✔ تم التعرف على العامل! الآن وجّه كاميرا نحو رمز QR الخاص بالطلبية لمسحه تلقائياً.</strong>`;
    } else if (mode === 'order-done') {
        tipEl.innerHTML = `<strong style="color: var(--color-teal); font-size: 0.9rem;">✔ تم مسح رمز الطلبية! أدخل عدد الأسطر واضغط تسجيل.</strong>`;
    } else {
        tipEl.innerHTML = `وجه رمز الـ QR الخاص بك نحو الكاميرا ليتم قراءته تلقائياً.`;
    }
}

// Manual Scanner Handlers
function populateManualWorkersDropdown() {
    const select = document.getElementById("manual-worker-select");
    if (!select) return;

    select.innerHTML = '<option value="">-- اختر عاملاً --</option>' +
        workers.map(w => `<option value="${w.id}">${w.name} (${w.role === 'preparateur' ? 'محضّر' : 'مراقب'})</option>`).join("");
}

function handleManualScanSubmit() {
    const select = document.getElementById("manual-worker-select");
    const input = document.getElementById("manual-worker-id");

    let targetId = input.value.trim();
    if (!targetId && select.value) {
        targetId = select.value;
    }

    if (!targetId) {
        alert("يرجى إدخال معرف العامل.");
        return;
    }

    handleWorkerIdentification(targetId);
    input.value = ""; // Clear
    if (select) select.value = "";
}

// ==========================================================================
// WORKFLOW ACTIONS: PREPARATIONS & VERIFICATIONS
// ==========================================================================
function submitPreparation() {
    if (!activeWorker || activeWorker.role !== 'preparateur') {
        alert("خطأ: يجب تسجيل دخول عامل بصفة مُحضِّر أولاً.");
        return;
    }

    const linesInput = document.getElementById("prep-lines-count");
    const refInput = document.getElementById("prep-order-ref");

    const lines = parseInt(linesInput.value);
    const reference = refInput.value.trim();

    if (!reference) {
        alert("يرجى إدخال رقم الطلبية أو مسح رمز الـ QR الخاص بها أولاً.");
        refInput.focus();
        return;
    }

    if (isNaN(lines) || lines <= 0) {
        alert("يرجى إدخال عدد أسطر صحيح (أكبر من 0).");
        linesInput.focus();
        return;
    }

    // Rule 1: Prevent Order Duplication
    const isDuplicate = operations.some(op => op.reference && op.reference.toUpperCase() === reference.toUpperCase());
    if (isDuplicate) {
        alert("خطأ (Error): لقد تم تسجيل هذه الطلبية من قبل. لا يمكن تكرار الطلبية مرتين!");
        return;
    }

    const newOp = {
        id: `OP-${Date.now()}`,
        workerId: activeWorker.id,
        workerName: activeWorker.name,
        lines: lines,
        reference: reference,
        timestamp: new Date().toISOString(),
        status: "pending",
        controllerId: null,
        controllerName: null,
        controlledAt: null
    };

    operations.unshift(newOp); // Add to the top of logs
    saveDatabase();

    // Reset inputs and log out worker automatically for security & shared device usage
    alert(`تم بنجاح تسجيل تحضير ${lines} سطر للطلبية ${reference}. العملية في انتظار مراجعة المراقب.`);
    clearActiveWorker();

    // Refresh stats & tables
    renderAllViews();

    // Switch to dashboard to see results
    switchTab('dashboard');
}

function submitDelegatedPreparation() {
    if (!activeWorker || activeWorker.role !== 'controleur') {
        alert("خطأ: يجب تسجيل دخول عامل بصفة مُراقِب أولاً.");
        return;
    }

    const prepId = document.getElementById("delegate-preparateur").value;
    const linesInput = document.getElementById("delegate-lines-count");
    const refInput = document.getElementById("delegate-order-ref");

    if (!prepId) {
        alert("يرجى اختيار المحضر التابع لك أولاً.");
        return;
    }

    const targetPreparateur = workers.find(w => w.id === prepId);
    if (!targetPreparateur) return;

    const lines = parseInt(linesInput.value);
    const reference = refInput.value.trim();

    if (!reference) {
        alert("يرجى إدخال رقم الطلبية.");
        refInput.focus();
        return;
    }

    if (isNaN(lines) || lines <= 0) {
        alert("يرجى إدخال عدد أسطر صحيح (أكبر من 0).");
        linesInput.focus();
        return;
    }

    // Rule 1: Prevent Order Duplication
    const isDuplicate = operations.some(op => op.reference && op.reference.toUpperCase() === reference.toUpperCase());
    if (isDuplicate) {
        alert("خطأ (Error): لقد تم تسجيل هذه الطلبية من قبل. لا يمكن تكرار الطلبية مرتين!");
        return;
    }

    const newOp = {
        id: `OP-${Date.now()}`,
        workerId: targetPreparateur.id,
        workerName: targetPreparateur.name,
        lines: lines,
        reference: reference,
        timestamp: new Date().toISOString(),
        status: "pending", // Keep pending so it can be controlled, or auto control? Wait, maybe just pending.
        controllerId: null,
        controllerName: null,
        controlledAt: null
    };

    operations.unshift(newOp);
    saveDatabase();

    alert(`تم بنجاح تسجيل تحضير ${lines} سطر للطلبية ${reference} نيابة عن المحضر: ${targetPreparateur.name}. العملية الآن معلقة.`);

    // Clear inputs
    linesInput.value = "";
    refInput.value = "";

    // Refresh stats & tables
    renderAllViews();
    switchTab('dashboard');
}

// Selecting operations to validate
function toggleSelectAllTasks(checkbox) {
    const checkboxes = document.querySelectorAll(".task-checkbox");
    checkboxes.forEach(cb => {
        if (!cb.disabled) {
            cb.checked = checkbox.checked;
        }
    });
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll(".task-checkbox:checked");
    const countBadge = document.getElementById("selected-tasks-count");
    const btnApprove = document.getElementById("btn-approve-selected");

    countBadge.textContent = `المحدد: ${checkboxes.length}`;

    // Only enable validation button if an active controller is logged in AND items are selected
    if (activeWorker && activeWorker.role === 'controleur' && checkboxes.length > 0) {
        btnApprove.disabled = false;
    } else {
        btnApprove.disabled = true;
    }
}

function approveSelectedTasks() {
    if (!activeWorker || activeWorker.role !== 'controleur') {
        alert("يجب تسجيل الدخول كـ (Contrôleur) لتأكيد العمليات.");
        return;
    }

    const selectedCheckboxes = document.querySelectorAll(".task-checkbox:checked");
    if (selectedCheckboxes.length === 0) return;

    if (confirm(`هل أنت متأكد من تأكيد ومراقبة ${selectedCheckboxes.length} عملية تحضير محددة؟`)) {
        selectedCheckboxes.forEach(cb => {
            const opId = cb.value;
            const op = operations.find(o => o.id === opId);
            if (op && op.status === 'pending') {
                op.status = 'controlled';
                op.controllerId = activeWorker.id;
                op.controllerName = activeWorker.name;
                op.controlledAt = new Date().toISOString();
            }
        });

        saveDatabase();
        alert("تم تأكيد وتوثيق جميع العمليات المحددة بنجاح.");

        // Reset check all checkbox
        const checkAll = document.getElementById("select-all-tasks");
        if (checkAll) checkAll.checked = false;

        updateSelectedCount();
        renderAllViews();

        // Return to Dashboard to see updated graphs
        switchTab('dashboard');
    }
}

// Render the validation list view (Control Tab)
function renderPendingTasksTable() {
    const tbody = document.getElementById("pending-tasks-table-body");
    if (!tbody) return;

    let pendingTasks = operations.filter(op => op.status === 'pending');

    // Role-based filtering:
    // If the logged in user is a controller, ONLY show tasks from preparateurs assigned to them.
    if (activeWorker && activeWorker.role === 'controleur') {
        pendingTasks = pendingTasks.filter(op => {
            const preparateur = workers.find(w => w.id === op.workerId);
            return preparateur && preparateur.controllerId === activeWorker.id;
        });
    }

    if (pendingTasks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-table-state">لا توجد عمليات تحضير معلقة حالياً في انتظار المراقبة.</td>
            </tr>
        `;
        return;
    }

    // Render pending items
    tbody.innerHTML = pendingTasks.map(op => {
        const date = new Date(op.timestamp);
        const formattedDate = date.toLocaleDateString('ar-DZ') + " " + date.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });

        // Checkboxes should be disabled if no controller is logged in
        const isDisabled = (!activeWorker || activeWorker.role !== 'controleur');

        return `
            <tr>
                <td>
                    <input type="checkbox" class="task-checkbox" value="${op.id}" onchange="updateSelectedCount()" ${isDisabled ? 'disabled' : ''}>
                </td>
                <td>${formattedDate}</td>
                <td class="font-bold">${op.workerName}</td>
                <td><code class="text-secondary">${op.reference}</code></td>
                <td class="score-value" style="font-size: 0.95rem;">${op.lines}</td>
                <td><span class="status-pill status-pending"><i class="fa-solid fa-hourglass-half"></i> معلق</span></td>
                <td><span class="text-muted">لم تُراقب بعد</span></td>
            </tr>
        `;
    }).join("");

    // Sync checkbox headers
    const checkAll = document.getElementById("select-all-tasks");
    if (checkAll) {
        checkAll.disabled = (!activeWorker || activeWorker.role !== 'controleur');
        checkAll.checked = false;
    }
    updateSelectedCount();
}

// ==========================================================================
// WORKER MANAGEMENT & NEW REGISTER
// ==========================================================================
function toggleAssignedController(select) {
    const group = document.getElementById("assign-controller-group");
    const input = document.getElementById("worker-assigned-controller");
    if (select.value === 'preparateur') {
        group.style.display = "block";
        input.required = true;
    } else {
        group.style.display = "none";
        input.required = false;
        input.value = "";
    }
}

function populateControllersDropdown() {
    const select = document.getElementById("worker-assigned-controller");
    if (!select) return;

    const controllers = workers.filter(w => w.role === 'controleur');
    const currentValue = select.value;

    select.innerHTML = '<option value="">-- اختر مراقباً --</option>' +
        controllers.map(w => `<option value="${w.id}">${w.name}</option>`).join("");

    select.value = currentValue;
}

function toggleCustomIdInput(checkbox) {
    const customIdGroup = document.getElementById("custom-id-group");
    const customIdInput = document.getElementById("worker-custom-id");
    if (checkbox.checked) {
        customIdGroup.style.display = "block";
        customIdInput.required = true;
    } else {
        customIdGroup.style.display = "none";
        customIdInput.required = false;
        customIdInput.value = "";
    }
}

function handleAddWorker(event) {
    event.preventDefault();

    const nameInput = document.getElementById("worker-name");
    const roleSelect = document.getElementById("worker-role");
    const useCustomIdCheckbox = document.getElementById("use-custom-id");
    const customIdInput = document.getElementById("worker-custom-id");
    const assignedControllerInput = document.getElementById("worker-assigned-controller");

    const name = nameInput.value.trim();
    const role = roleSelect.value;
    const assignedControllerId = assignedControllerInput ? assignedControllerInput.value : null;

    if (!name) return;

    if (role === 'preparateur') {
        if (!assignedControllerId) {
            alert("يرجى اختيار المراقب المسؤول عن هذا المحضر.");
            return;
        }

        // Rule 2: Limit controllers to max 4 preparers
        const assignedCount = workers.filter(w => w.role === 'preparateur' && w.controllerId === assignedControllerId).length;
        if (assignedCount >= 4) {
            alert("خطأ: هذا المراقب مسؤول بالفعل عن 4 محاضر (الحد الأقصى). يرجى اختيار مراقب آخر.");
            return;
        }
    }

    let workerId = "";
    if (useCustomIdCheckbox && useCustomIdCheckbox.checked) {
        workerId = customIdInput.value.trim().toUpperCase();
        if (!workerId) {
            alert("يرجى إدخال معرف للعامل.");
            return;
        }

        // Check duplicate worker ID
        const exists = workers.find(w => w.id.toUpperCase() === workerId.toUpperCase());
        if (exists) {
            alert(`خطأ: المعرف "${workerId}" مسجل بالفعل لعامل آخر (${exists.name}). يرجى اختيار معرف فريد.`);
            return;
        }
    } else {
        // Generate a unique ID (PHARMA-XXXXXX)
        let unique = false;
        while (!unique) {
            const randomNum = Math.floor(100000 + Math.random() * 900000);
            workerId = `PHARMA-${randomNum}`;
            if (!workers.some(w => w.id === workerId)) {
                unique = true;
            }
        }
    }

    const newWorker = {
        id: workerId,
        name: name,
        role: role,
        controllerId: role === 'preparateur' ? assignedControllerId : null,
        createdAt: new Date().toISOString()
    };

    workers.push(newWorker);
    saveDatabase();

    // Reset Form
    nameInput.value = "";
    if (useCustomIdCheckbox) useCustomIdCheckbox.checked = false;
    if (customIdInput) {
        customIdInput.value = "";
        document.getElementById("custom-id-group").style.display = "none";
    }
    if (assignedControllerInput) {
        assignedControllerInput.value = "";
    }

    // Re-render components
    renderAllViews();

    // Open QR Code modal for printing immediately
    openQRModal(newWorker.id);
}

function renderWorkersTable() {
    const tbody = document.getElementById("workers-list-table-body");
    if (!tbody) return;

    if (workers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-table-state">لا توجد عمال مسجلين بعد.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = workers.map(w => {
        return `
            <tr>
                <td class="font-bold">${w.name}</td>
                <td>
                    <span class="badge ${w.role === 'preparateur' ? 'badge-preparator' : 'badge-controleur'}">
                        ${w.role === 'preparateur' ? 'مُحضِّر (Préparateur)' : 'مُراقِب (Contrôleur)'}
                    </span>
                </td>
                <td><code style="font-size:0.85rem; letter-spacing: 0.5px;">${w.id}</code></td>
                <td>
                    <button class="btn btn-secondary btn-block" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openQRModal('${w.id}')">
                        <i class="fa-solid fa-qrcode"></i> بطاقة الـ QR
                    </button>
                </td>
                <td>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="deleteWorker('${w.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function deleteWorker(workerId) {
    // Prevent deletion of active session worker
    if (activeWorker && activeWorker.id === workerId) {
        alert("لا يمكن حذف العامل المسجل دخوله حالياً. يرجى تسجيل الخروج أولاً.");
        return;
    }

    // Confirm delete
    const worker = workers.find(w => w.id === workerId);
    if (!worker) return;

    if (confirm(`هل أنت متأكد من حذف العامل "${worker.name}"؟ لن يتم حذف عملياته السابقة من السجلات للحفاظ على نزاهة البيانات.`)) {
        workers = workers.filter(w => w.id !== workerId);
        saveDatabase();
        renderAllViews();
    }
}

// QR Modal Control
function openQRModal(workerId) {
    const worker = workers.find(w => w.id === workerId);
    if (!worker) return;

    document.getElementById("modal-worker-name").textContent = worker.name;
    const roleBadge = document.getElementById("modal-worker-role");

    if (worker.role === 'preparateur') {
        roleBadge.textContent = "مُحضِّر (Préparateur)";
        roleBadge.className = "badge badge-preparator qr-card-role";
    } else {
        roleBadge.textContent = "مُراقِب (Contrôleur)";
        roleBadge.className = "badge badge-controleur qr-card-role";
    }

    document.getElementById("modal-worker-id-code").textContent = worker.id;

    // Clear previous QR code
    const qrContainer = document.getElementById("modal-qr-container");
    qrContainer.innerHTML = "";

    // Generate new QR code using QRCode library
    setTimeout(() => {
        if (typeof QRCode === 'undefined') {
            qrContainer.innerHTML = `<p class="text-danger" style="font-size:0.8rem; margin-top:20px;">تعذر توليد رمز الـ QR (مكتبة QRCode غير متوفرة)</p>`;
            return;
        }
        new QRCode(qrContainer, {
            text: worker.id,
            width: 180,
            height: 180,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }, 100);

    document.getElementById("qr-modal").classList.add("active");
}

function closeQRModal() {
    document.getElementById("qr-modal").classList.remove("active");
}

function printQRCode() {
    window.print();
}

// ==========================================================================
// LOG HISTORY & FILTERS
// ==========================================================================
function renderFullLogsTable() {
    const tbody = document.getElementById("full-logs-table-body");
    if (!tbody) return;

    const filterDate = document.getElementById("filter-date").value;
    const filterWorker = document.getElementById("filter-worker").value;
    const filterStatus = document.getElementById("filter-status").value;

    // Apply filters to operations array
    let filteredOps = operations;

    if (filterDate) {
        filteredOps = filteredOps.filter(op => op.timestamp.startsWith(filterDate));
    }
    if (filterWorker) {
        filteredOps = filteredOps.filter(op => op.workerId === filterWorker);
    }
    if (filterStatus) {
        filteredOps = filteredOps.filter(op => op.status === filterStatus);
    }

    if (filteredOps.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-table-state">لا توجد عمليات مطابقة للفلاتر المختارة.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filteredOps.map(op => {
        const date = new Date(op.timestamp);
        const formattedDate = date.toLocaleDateString('ar-DZ') + " " + date.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });

        let statusHtml = "";
        let controllerHtml = "";

        if (op.status === 'controlled') {
            statusHtml = `<span class="status-pill status-controlled"><i class="fa-solid fa-circle-check"></i> مراقبة مؤكدة</span>`;
            controllerHtml = `<span class="font-bold text-teal">${op.controllerName}</span>`;
        } else {
            statusHtml = `<span class="status-pill status-pending"><i class="fa-solid fa-hourglass-half"></i> في الانتظار</span>`;
            controllerHtml = `<span class="text-muted">لم تؤكد بعد</span>`;
        }

        return `
            <tr>
                <td><code style="font-size:0.75rem;">${op.id.split('-')[1] || op.id}</code></td>
                <td>${formattedDate}</td>
                <td class="font-bold">${op.workerName}</td>
                <td><code class="text-secondary">${op.reference}</code></td>
                <td class="score-value">${op.lines}</td>
                <td>${statusHtml}</td>
                <td>${controllerHtml}</td>
                <td>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.75rem;" onclick="deleteLogRecord('${op.id}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

function applyFilters() {
    renderFullLogsTable();
}

function populateFiltersDropdowns() {
    const workerSelect = document.getElementById("filter-worker");
    if (!workerSelect) return;

    const currentValue = workerSelect.value;
    workerSelect.innerHTML = '<option value="">الكل</option>' +
        workers.map(w => `<option value="${w.id}">${w.name}</option>`).join("");
    workerSelect.value = currentValue;
}

// Dropdown filters are now populated directly within the renderAllViews function to avoid reassignment errors

function deleteLogRecord(opId) {
    if (confirm("هل أنت متأكد من حذف هذه العملية نهائياً من السجلات؟")) {
        operations = operations.filter(op => op.id !== opId);
        saveDatabase();
        renderAllViews();
    }
}

// CSV Export (Excel Compatible)
function exportLogsToCSV() {
    if (operations.length === 0) {
        alert("لا توجد بيانات لتصديرها.");
        return;
    }

    // Headers
    const headers = [
        "معرف العملية",
        "التاريخ والوقت",
        "اسم المحضر",
        "معرف المحضر",
        "رقم الطلبية",
        "عدد الأسطر",
        "حالة المراقبة",
        "اسم المراقب",
        "معرف المراقب",
        "تاريخ المراقبة"
    ];

    // Rows
    const rows = operations.map(op => {
        return [
            op.id,
            new Date(op.timestamp).toLocaleString('ar-DZ'),
            op.workerName,
            op.workerId,
            op.reference,
            op.lines,
            op.status === 'controlled' ? "مراقبة مؤكدة" : "في الانتظار",
            op.controllerName || "",
            op.controllerId || "",
            op.controlledAt ? new Date(op.controlledAt).toLocaleString('ar-DZ') : ""
        ];
    });

    // Assemble CSV Content
    let csvContent = headers.join(",") + "\n";
    rows.forEach(row => {
        const cleanRow = row.map(val => {
            // Escape double quotes and wrap values in quotes
            let cleanVal = String(val).replace(/"/g, '""');
            return `"${cleanVal}"`;
        });
        csvContent += cleanRow.join(",") + "\n";
    });

    // Use BOM \uFEFF to preserve Arabic character encoding when opened in Microsoft Excel
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);

    const formattedDate = new Date().toISOString().split('T')[0];
    link.setAttribute("download", `Pharma_SPA_Productivity_${formattedDate}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function confirmResetDatabase() {
    if (confirm("تحذير: سيؤدي هذا إلى مسح كافة السجلات والعمال المسجلين نهائياً للبدء من جديد. هل تريد الاستمرار؟")) {
        localStorage.removeItem("pharma_workers");
        localStorage.removeItem("pharma_operations");
        localStorage.removeItem("pharma_active_worker");
        activeWorker = null;

        initDatabase();
        clearActiveWorker();
        renderAllViews();
        alert("تمت إعادة تهيئة قاعدة البيانات بنجاح.");
        switchTab('dashboard');
    }
}

// ==========================================================================
// TRANSLATION SYSTEM
// ==========================================================================
const translations = {
    ar: {
        login_title: "تسجيل الدخول",
        login_desc: "الوصول متاح فقط للمدراء والمراقبين.<br>الرجاء مسح بطاقتك أو إدخال المعرف الخاص بك.",
        login_camera: "تسجيل عبر الكاميرا (QR)",
        login_enter: "دخول",
        login_placeholder: "أدخل معرفك (مثال: ADMIN)"
    },
    fr: {
        login_title: "Connexion",
        login_desc: "L'accès est réservé aux Directeurs et Contrôleurs.<br>Veuillez scanner votre carte ou entrer votre identifiant.",
        login_camera: "Scanner via Caméra (QR)",
        login_enter: "Entrer",
        login_placeholder: "Entrez votre ID (ex: ADMIN)"
    }
};

let currentLang = 'ar';

function setLanguage(lang) {
    currentLang = lang;

    // Update language buttons active state
    document.getElementById("btn-lang-ar").classList.toggle("active", lang === 'ar');
    document.getElementById("btn-lang-fr").classList.toggle("active", lang === 'fr');

    // Update direction and font based on language
    document.documentElement.setAttribute('lang', lang);
    if (lang === 'fr') {
        document.documentElement.setAttribute('dir', 'ltr');
        document.body.style.fontFamily = "'Roboto', 'Segoe UI', sans-serif";
    } else {
        document.documentElement.setAttribute('dir', 'rtl');
        document.body.style.fontFamily = "'Cairo', sans-serif";
    }

    // Translate text with data-i18n attributes
    const elements = document.querySelectorAll("[data-i18n]");
    elements.forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (translations[lang][key]) {
            el.innerHTML = translations[lang][key];
        }
    });

    // Translate placeholders
    const placeholderInput = document.getElementById("login-worker-id");
    if (placeholderInput && translations[lang].login_placeholder) {
        placeholderInput.setAttribute("placeholder", translations[lang].login_placeholder);
    }
}

// Ensure default language is set on load
document.addEventListener("DOMContentLoaded", () => {
    setLanguage(currentLang);
});
