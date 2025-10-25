// Minimize/Expand functionality - MUST BE AT TOP
let isMinimized = false;

function toggleMinimize() {
    const content = document.getElementById("mainContent");
    const btn = document.getElementById("minimizeBtn");
    
    if (!content || !btn) {
        console.error("Content or button not found");
        return;
    }
    
    isMinimized = !isMinimized;
    
    if (isMinimized) {
        content.classList.add("minimized");
        btn.textContent = "+";
        btn.title = "Expand";
    } else {
        content.classList.remove("minimized");
        btn.textContent = "Minimize-";
        btn.title = "Minimize";
    }
    
    // Save state
    chrome.storage.local.set({ panelMinimized: isMinimized });
    console.log("Panel minimized:", isMinimized);
}

// Initialize minimize listeners when DOM is ready
function initializeMinimize() {
    const minimizeBtn = document.getElementById("minimizeBtn");
    const headerToggle = document.getElementById("headerToggle");
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleMinimize();
        });
        console.log("Minimize button listener attached");
    } else {
        console.error("Minimize button not found");
    }
    
    if (headerToggle) {
        headerToggle.addEventListener("click", (e) => {
            // Only toggle if clicking header itself, not the button
            if (e.target.id === "headerToggle" || e.target.tagName === "H3") {
                toggleMinimize();
            }
        });
        console.log("Header toggle listener attached");
    }
    
    // Load saved minimize state
    chrome.storage.local.get(["panelMinimized"], ({ panelMinimized = false }) => {
        if (panelMinimized) {
            // Force minimize
            isMinimized = false;
            toggleMinimize();
        }
    });
}

async function loadEmailsAndTabs() {
    let { emailList = [], stopFlag = false, failedEmails = [], sentEmails = [], delay = 500, attemptDelay = 4000, failedDelay = 1000, skipAttempts = false, reloadOption = 'after3', autoSwitch = false, selectedTabs = [], statusLogs = [], stallDetection = true, reloadAfterSent = 0 } = await chrome.storage.local.get(["emailList", "stopFlag", "failedEmails", "sentEmails", "delay", "attemptDelay", "failedDelay", "skipAttempts", "reloadOption", "autoSwitch", "selectedTabs", "statusLogs", "stallDetection", "reloadAfterSent"]);
    let remainingEmails = emailList.filter(e => !sentEmails.includes(e) && !failedEmails.includes(e));
    document.getElementById("emails").value = remainingEmails.join("\n");
    document.getElementById("lineCount").innerText = "Email Lines: " + remainingEmails.length;
    document.getElementById("failedCount").innerText = "Failed Emails: " + failedEmails.length;
    document.getElementById("sentCount").innerText = "Sent Emails: " + sentEmails.length;
    document.getElementById("startBtn").disabled = !stopFlag && remainingEmails.length > 0;
    document.getElementById("stopBtn").disabled = stopFlag;
    document.getElementById("delay").value = delay;
    document.getElementById("attemptDelay").value = attemptDelay;
    document.getElementById("failedDelay").value = failedDelay;
    document.getElementById("skipAttempts").value = skipAttempts.toString();
    document.getElementById("reloadOption").value = reloadOption;
    document.getElementById("autoSwitch").value = autoSwitch.toString();
    document.getElementById("stallDetection").value = stallDetection.toString();
    document.getElementById("reloadAfterSent").value = reloadAfterSent.toString();

    const consoleDiv = document.getElementById("console");
    consoleDiv.innerHTML = "";
    statusLogs.forEach(log => {
        const line = document.createElement("div");
        line.textContent = log.replace(/\s*\[emailProcessor_.*\]$/, '');
        if (log.includes("---- Sent:")) {
            line.classList.add("sent");
        } else if (log.includes("Attempt 3")) {
            line.classList.add("attempt3");
        } else if (log.includes("No more emails to process in this tab")) {
            line.classList.add("no-emails");
        }
        consoleDiv.appendChild(line);
    });
    consoleDiv.scrollTop = consoleDiv.scrollHeight;

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tabList = document.getElementById("tabList");
    tabList.innerHTML = "";
    tabs.forEach(tab => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = tab.id;
        checkbox.checked = selectedTabs.includes(tab.id);
        checkbox.addEventListener("change", async () => {
            const checkboxes = tabList.querySelectorAll("input[type=checkbox]");
            const selected = Array.from(checkboxes)
                .filter(cb => cb.checked)
                .map(cb => parseInt(cb.value));
            await chrome.storage.local.set({ selectedTabs: selected });
        });
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(` ${tab.title || `Tab ${tab.id}`}`));
        tabList.appendChild(label);
    });

    const selectAllCheckbox = document.getElementById("selectAll");
    // Remove old listeners
    const newSelectAll = selectAllCheckbox.cloneNode(true);
    selectAllCheckbox.parentNode.replaceChild(newSelectAll, selectAllCheckbox);
    
    newSelectAll.addEventListener("change", (e) => {
        const checkboxes = tabList.querySelectorAll("input[type=checkbox]");
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        const selected = e.target.checked ? Array.from(checkboxes).map(cb => parseInt(cb.value)) : [];
        chrome.storage.local.set({ selectedTabs: selected });
    });
}

function downloadEmails(emails, filename) {
    const blob = new Blob([emails.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

async function processTab(tabId, email) {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (chrome.runtime.lastError || tab.discarded || tab.status !== "complete") {
            console.log(`Reloading tab ${tabId} (discarded: ${tab.discarded}, status: ${tab.status})`);
            await chrome.tabs.reload(tabId);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        await chrome.storage.local.set({ [`emailList_${tabId}`]: [email] });
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"]
        });
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, { action: "startProcessing" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error(`Error sending start message to tab ${tabId}:`, chrome.runtime.lastError.message);
                    reject(chrome.runtime.lastError);
                } else {
                    console.log(`Started processing in tab ${tabId}:`, response);
                    resolve();
                }
            });
        });
    } catch (error) {
        console.error(`Error processing tab ${tabId}:`, error);
        throw error;
    }
}

async function monitorTabStalls() {
    const { stallDetection = true, selectedTabs = [] } = await chrome.storage.local.get(["stallDetection", "selectedTabs"]);
    if (!stallDetection) return;

    const RELOAD_COOLDOWN = 30000;
    const MAX_RELOAD_ATTEMPTS = 2;
    const STALL_THRESHOLD = 15000;
    const tabLastLogTime = new Map();
    const tabLastLog = new Map();
    const tabReloadAttempts = new Map();
    const tabCooldowns = new Map();
    const tabCurrentEmail = new Map();

    selectedTabs.forEach(tabId => {
        tabLastLogTime.set(tabId, Date.now());
        tabLastLog.set(tabId, "");
        tabReloadAttempts.set(tabId, new Map());
        tabCooldowns.set(tabId, 0);
        tabCurrentEmail.set(tabId, "");
    });

    const checkStalls = async () => {
        const { stopFlag = false, failedEmails = [], statusLogs = [] } = await chrome.storage.local.get(["stopFlag", "failedEmails", "statusLogs"]);
        if (stopFlag) return;

        for (const tabId of selectedTabs) {
            const tabLogs = statusLogs.filter(log => log.includes(`[Tab ${tabId}]`));
            const latestLog = tabLogs.length > 0 ? tabLogs[tabLogs.length - 1].replace(/\s*\[emailProcessor_.*\]$/, '') : "";
            const lastLog = tabLastLog.get(tabId);

            const emailMatch = latestLog.match(/Edit email address for ([^\s]+)/);
            if (emailMatch) {
                tabCurrentEmail.set(tabId, emailMatch[1]);
            }

            if (latestLog !== lastLog) {
                tabLastLog.set(tabId, latestLog);
                tabLastLogTime.set(tabId, Date.now());
                continue;
            }

            const timeSinceLastLog = Date.now() - tabLastLogTime.get(tabId);
            if (
                timeSinceLastLog > STALL_THRESHOLD &&
                latestLog.includes("Edit email address for") &&
                tabCooldowns.get(tabId) < Date.now()
            ) {
                const currentEmail = tabCurrentEmail.get(tabId);
                if (!currentEmail) continue;

                const emailAttempts = tabReloadAttempts.get(tabId).get(currentEmail) || 0;
                if (emailAttempts >= MAX_RELOAD_ATTEMPTS) {
                    if (!failedEmails.includes(currentEmail)) {
                        failedEmails.push(currentEmail);
                        await chrome.storage.local.set({ failedEmails });
                        const logMessage = `[Tab ${tabId}] Gave up on stalled email: ${currentEmail} after ${MAX_RELOAD_ATTEMPTS} reloads`;
                        await chrome.storage.local.set({ statusLogs: [...statusLogs, logMessage] });
                        updateConsole(logMessage);
                    }
                    await chrome.storage.local.set({ [`emailList_${tabId}`]: [] });
                    tabReloadAttempts.get(tabId).delete(currentEmail);
                    continue;
                }

                tabReloadAttempts.get(tabId).set(currentEmail, emailAttempts + 1);
                const logMessage = `[Tab ${tabId}] Stalled on ${currentEmail} for ${timeSinceLastLog / 1000}s, reloading tab (attempt ${emailAttempts + 1}/${MAX_RELOAD_ATTEMPTS})`;
                await chrome.storage.local.set({ statusLogs: [...statusLogs, logMessage] });
                updateConsole(logMessage);

                try {
                    await chrome.runtime.sendMessage({ action: "reloadAndReinject", tabId });
                    tabCooldowns.set(tabId, Date.now() + RELOAD_COOLDOWN);
                } catch (err) {
                    console.error(`Error reloading tab ${tabId}:`, err);
                    const errorLog = `[Tab ${tabId}] Error reloading for ${currentEmail}: ${err.message}`;
                    await chrome.storage.local.set({ statusLogs: [...statusLogs, errorLog] });
                    updateConsole(errorLog);
                }
            }
        }
    };

    const stallCheckInterval = setInterval(checkStalls, 5000);
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "stopProcess") {
            clearInterval(stallCheckInterval);
        }
        return true;
    });
}

function updateConsole(message) {
    const consoleDiv = document.getElementById("console");
    const line = document.createElement("div");
    const cleanMessage = message.replace(/\s*\[emailProcessor_.*\]$/, '');
    line.textContent = cleanMessage;
    if (message.includes("---- Sent:")) {
        line.classList.add("sent");
    } else if (message.includes("Attempt 3")) {
        line.classList.add("attempt3");
    } else if (message.includes("No more emails to process in this tab")) {
        line.classList.add("no-emails");
    }
    consoleDiv.appendChild(line);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
}

document.getElementById("startBtn").addEventListener("click", async () => {
    let emailsText = document.getElementById("emails").value.trim();
    if (!emailsText) {
        alert("Please enter at least one email!");
        return;
    }

    let emails = emailsText.split("\n").map(e => e.trim()).filter(e => e);
    let delay = parseInt(document.getElementById("delay").value) || 500;
    let attemptDelay = parseInt(document.getElementById("attemptDelay").value) || 4000;
    let failedDelay = parseInt(document.getElementById("failedDelay").value) || 1000;
    let skipAttempts = document.getElementById("skipAttempts").value === "true";
    let reloadOption = document.getElementById("reloadOption").value;
    let autoSwitch = document.getElementById("autoSwitch").value === "true";
    let stallDetection = document.getElementById("stallDetection").value === "true";
    let reloadAfterSent = parseInt(document.getElementById("reloadAfterSent").value) || 0;

    const { selectedTabs = [] } = await chrome.storage.local.get("selectedTabs");
    if (selectedTabs.length === 0) {
        alert("Please select at least one tab!");
        return;
    }

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const clearPromises = tabs.map(tab => 
        Promise.all([
            chrome.storage.local.remove(`emailList_${tab.id}`),
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    window.__emailProcessorRunning = false;
                    window.__emailProcessorListeners?.forEach(listener => window.removeEventListener('unload', listener));
                    window.__emailProcessorListeners = [];
                }
            }).catch(() => {})
        ])
    );
    await Promise.all(clearPromises);
    await chrome.storage.local.set({ statusLogs: [], failedEmails: [], sentEmails: [], stopFlag: true });

    const emailsToProcess = emails.slice(0, selectedTabs.length);
    const remainingEmails = emails.slice(selectedTabs.length);
    await chrome.storage.local.set({ 
        emailList: remainingEmails, 
        stopFlag: false, 
        failedEmails: [], 
        sentEmails: [], 
        delay, 
        attemptDelay,
        failedDelay,
        skipAttempts,
        reloadOption,
        autoSwitch,
        stallDetection,
        reloadAfterSent,
        activeTabs: selectedTabs
    });

    try {
        await Promise.all(selectedTabs.map((tabId, i) => {
            if (emailsToProcess[i]) {
                return processTab(tabId, emailsToProcess[i]);
            }
            return Promise.resolve();
        }));
        console.log(`Started parallel processing in ${selectedTabs.length} tabs`);
        if (autoSwitch) {
            await chrome.runtime.sendMessage({ action: "startAutoSwitch", selectedTabs });
        }
        if (stallDetection) {
            monitorTabStalls();
        }
    } catch (error) {
        console.error("Failed to start processing in one or more tabs:", error);
        alert("Error starting processing in some tabs. Check console for details.");
        return;
    }

    document.getElementById("startBtn").disabled = true;
    document.getElementById("stopBtn").disabled = false;
    loadEmailsAndTabs();
});

document.getElementById("stopBtn").addEventListener("click", async () => {
    const { activeTabs = [] } = await chrome.storage.local.get("activeTabs");
    for (const tabId of activeTabs) {
        await chrome.storage.local.set({ [`emailList_${tabId}`]: [] });
        chrome.tabs.sendMessage(tabId, { action: "stopProcessing" }, () => {
            if (chrome.runtime.lastError) console.error(`Error stopping tab ${tabId}:`, chrome.runtime.lastError.message);
        });
        await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                window.__emailProcessorRunning = false;
                window.__emailProcessorListeners?.forEach(listener => window.removeEventListener('unload', listener));
                window.__emailProcessorListeners = [];
            }
        }).catch(() => {});
    }
    await chrome.runtime.sendMessage({ action: "stopProcess" });
    await chrome.runtime.sendMessage({ action: "stopAutoSwitch" });
    await chrome.storage.local.set({ statusLogs: [], stopFlag: true });
    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = true;
    loadEmailsAndTabs();
});

document.getElementById("downloadFailedBtn").addEventListener("click", async () => {
    let { failedEmails = [] } = await chrome.storage.local.get("failedEmails");
    if (failedEmails.length > 0) {
        downloadEmails(failedEmails, "failed_emails.txt");
    } else {
        alert("No failed emails to download!");
    }
});

document.getElementById("downloadSentBtn").addEventListener("click", async () => {
    let { sentEmails = [] } = await chrome.storage.local.get("sentEmails");
    if (sentEmails.length > 0) {
        downloadEmails(sentEmails, "sent_emails.txt");
    } else {
        alert("No sent emails to download!");
    }
});

document.getElementById("reloadBtn").addEventListener("click", async () => {
    await loadEmailsAndTabs();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (
        changes.emailList || 
        changes.failedEmails || 
        changes.sentEmails || 
        changes.stopFlag
    )) {
        chrome.storage.local.get(["emailList", "failedEmails", "sentEmails", "stopFlag"], ({ emailList = [], failedEmails = [], sentEmails = [], stopFlag = false }) => {
            let remainingEmails = emailList.filter(e => !sentEmails.includes(e) && !failedEmails.includes(e));
            document.getElementById("emails").value = remainingEmails.join("\n");
            document.getElementById("lineCount").innerText = "Email Lines: " + remainingEmails.length;
            document.getElementById("failedCount").innerText = "Failed Emails: " + failedEmails.length;
            document.getElementById("sentCount").innerText = "Sent Emails: " + sentEmails.length;
            document.getElementById("startBtn").disabled = !stopFlag && remainingEmails.length > 0;
            document.getElementById("stopBtn").disabled = stopFlag;
        });
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "updateStatus") {
        chrome.storage.local.get(["statusLogs"], ({ statusLogs = [] }) => {
            const cleanMessage = msg.message.replace(/\s*\[emailProcessor_.*\]$/, '');
            const messageHash = `${Date.now()}:${cleanMessage}`;
            if (!statusLogs.some(log => log.replace(/\s*\[emailProcessor_.*\]$/, '') === cleanMessage)) {
                statusLogs.push(msg.message);
                chrome.storage.local.set({ statusLogs }, () => {
                    updateConsole(msg.message);
                });
            }
        });
    }
    return true;
});

// Initialize everything when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM Content Loaded");
    initializeMinimize();
    loadEmailsAndTabs();
});