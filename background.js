let processRunning = false;
let autoSwitchInterval = null;

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.action === "getTabId") {
        sendResponse({ tabId: sender.tab.id });
        return true;
    }

    if (msg.action === "stopProcess") {
        processRunning = false;
        await chrome.storage.local.set({ stopFlag: true });
        console.log("Global process stopped...");
        sendResponse({ status: "stopped" });
        return true;
    }

    if (msg.action === "reloadAndReinject") {
        const tabId = msg.tabId;
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    window.__emailProcessorRunning = false;
                    window.__emailProcessorListeners?.forEach(listener => window.removeEventListener('unload', listener));
                    window.__emailProcessorListeners = [];
                }
            }).catch(() => {});
            await chrome.tabs.reload(tabId);
            console.log(`Reloaded tab ${tabId}`);
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    injectScriptWithRetry(tabId, 2);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            sendResponse({ status: "initiated" });
        } catch (err) {
            console.error(`Error reloading tab ${tabId}:`, err);
            sendResponse({ status: "error", message: err.message });
        }
        return true;
    }

    if (msg.action === "startAutoSwitch") {
        if (autoSwitchInterval) clearInterval(autoSwitchInterval);
        const selectedTabs = msg.selectedTabs;
        autoSwitchInterval = setInterval(async () => {
            for (let tabId of selectedTabs) {
                try {
                    await chrome.tabs.update(tabId, { active: true });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } catch (err) {
                    console.error(`Error activating tab ${tabId}:`, err);
                }
            }
        }, 15000);
        sendResponse({ status: "autoSwitchStarted" });
        return true;
    }

    if (msg.action === "stopAutoSwitch") {
        if (autoSwitchInterval) {
            clearInterval(autoSwitchInterval);
            autoSwitchInterval = null;
        }
        sendResponse({ status: "autoSwitchStopped" });
        return true;
    }

    return true;
});

async function injectScriptWithRetry(tabId, retries) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"]
        });
        console.log(`Injected script into tab ${tabId}`);
        chrome.tabs.sendMessage(tabId, { action: "startProcessing" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`Error sending startProcessing to tab ${tabId}:`, chrome.runtime.lastError.message);
            } else {
                console.log(`Sent startProcessing to tab ${tabId}:`, response);
            }
        });
    } catch (err) {
        console.error(`Failed to inject script into tab ${tabId}:`, err);
        if (retries > 0) {
            console.log(`Retrying injection for tab ${tabId}, retries left: ${retries}`);
            setTimeout(() => injectScriptWithRetry(tabId, retries - 1), 1000);
        } else {
            console.error(`Failed to inject script after retries for tab ${tabId}`);
        }
    }
}

chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});