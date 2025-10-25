(async function () {
    const scriptId = `emailProcessor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (window.__emailProcessorRunning) {
        console.log(`[Script ${scriptId}] Script already running, exiting...`);
        return;
    }
    window.__emailProcessorRunning = scriptId;
    window.__emailProcessorListeners = window.__emailProcessorListeners || [];

    let existingObservers = [];
    function cleanupObservers() {
        existingObservers.forEach(observer => observer.disconnect());
        existingObservers = [];
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    async function getTabId() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: "getTabId" }, (response) => {
                resolve(response.tabId);
            });
        });
    }

    const tabId = await getTabId();
    const emailListKey = `emailList_${tabId}`;
    let processing = false;

    function createStatusPopup() {
        let popup = document.getElementById("status-popup");
        if (!popup) {
            popup = document.createElement("div");
            popup.id = "status-popup";
            popup.style.position = "fixed";
            popup.style.bottom = "20px";
            popup.style.right = "20px";
            popup.style.width = "360px";
            popup.style.maxHeight = "400px";
            popup.style.overflowY = "auto";
            popup.style.background = "rgba(0,0,0,0.8)";
            popup.style.color = "white";
            popup.style.fontSize = "14px";
            popup.style.padding = "10px";
            popup.style.borderRadius = "12px";
            popup.style.zIndex = "999999";
            popup.style.boxShadow = "0 4px 10px rgba(0,0,0,0.5)";
            document.body.appendChild(popup);
        }
        return popup;
    }

    const updateStatus = debounce(function (msg) {
    const timestampedMsg = `[Tab ${tabId}] ${msg} [${scriptId}]`;

    // শুধু Console log এবং Extension message
    console.log(`[Tab ${tabId}] Status:`, msg);
    chrome.runtime.sendMessage({ action: "updateStatus", message: timestampedMsg });
}, 100);


    async function backgroundClick(el) {
        if (!el) return false;
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        el.click();
        console.log(`[Tab ${tabId}] Background click on:`, el);
        return true;
    }

    async function sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    }

    async function waitForElement(selector, text = null, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const end = Date.now() + timeout;
            const check = () => {
                const els = document.querySelectorAll(selector);
                for (let el of els) {
                    if (!text || el.textContent.trim() === text) {
                        resolve(el);
                        return true;
                    }
                }
                if (Date.now() > end) {
                    reject(new Error(`Timeout: ${selector} ${text || ""}`));
                    return true;
                }
                return false;
            };
            if (check()) return;
            const observer = new MutationObserver(() => {
                if (check()) observer.disconnect();
            });
            existingObservers.push(observer);
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function findActionButton(options, timeout = 3000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const els = document.querySelectorAll('span[data-hook="list-item-action-title"]');
            for (let el of els) {
                let t = el.textContent.trim().toLowerCase();
                if (options.some(opt => t.includes(opt.toLowerCase()))) return el;
            }
            await sleep(100);
        }
        return null;
    }

    async function findSubmitButton(timeout = 5000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const els = document.querySelectorAll("button, span");
            for (let el of els) {
                let t = el.textContent.trim().toLowerCase();
                if (["update", "add email"].includes(t)) return el;
            }
            await sleep(100);
        }
        return null;
    }

    async function waitForEditToastAndEmailOnPage(email, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const end = Date.now() + timeout;
            const expectedToast = "you’ve edited the email address on this order.";

            const check = () => {
                const toastEls = document.querySelectorAll('span[data-hook="status-toast-content"]');
                const editConfirmed = Array.from(toastEls).some(
                    el => el.textContent.trim().toLowerCase() === expectedToast
                );

                const placed = Array.from(document.querySelectorAll('span[data-hook="PlacedDH__Root"]'))
                    .some(el => el.textContent.trim().toLowerCase().includes(email.toLowerCase()));
                const infoCard = Array.from(document.querySelectorAll('span[data-hook="InfoCard__UserEmail"]'))
                    .some(el => el.textContent.trim().toLowerCase().includes(email.toLowerCase()));
                const emailFound = placed || infoCard;

                if (editConfirmed && emailFound) {
                    console.log(`[Tab ${tabId}] Edit Toast and Email on Page confirmed`);
                    resolve(true);
                    return true;
                }

                if (Date.now() > end) {
                    if (!editConfirmed && !emailFound) {
                        reject(new Error("Neither Edit toast nor Email found on page within timeout"));
                    } else if (!editConfirmed) {
                        reject(new Error("Edit toast not found within timeout"));
                    } else {
                        reject(new Error("Email not found on page within timeout"));
                    }
                    return true;
                }
                return false;
            };

            if (check()) return;

            const observer = new MutationObserver(() => {
                if (check()) observer.disconnect();
            });
            existingObservers.push(observer);
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function waitForToast(email, timeout = 10000) {
        const expected = `your email was sent to ${email.toLowerCase()}`;
        return new Promise(resolve => {
            const end = Date.now() + timeout;
            const check = () => {
                const els = document.querySelectorAll('span[data-hook="status-toast-content"]');
                for (let el of els) {
                    if (el.textContent.trim().toLowerCase() === expected) {
                        resolve(true);
                        return true;
                    }
                }
                if (Date.now() > end) {
                    resolve(false);
                    return true;
                }
                return false;
            };
            if (check()) return;
            const observer = new MutationObserver(() => {
                if (check()) observer.disconnect();
            });
            existingObservers.push(observer);
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    async function tryMoreActions(email) {
        try {
            const moreBtn = document.querySelector('button[data-hook="MoreActions__Trigger"]');
            if (!moreBtn) {
                updateStatus(`No More Actions button found for ${email}`);
                return false;
            }
            await backgroundClick(moreBtn);
            const shipBtn = await waitForElement(
                'span[data-hook="list-item-action-title"]',
                "Send shipping confirmation email",
                5000
            ).catch(() => null);
            if (shipBtn) {
                await backgroundClick(shipBtn);
                updateStatus(`Sending..... ${email}`);
                return await waitForToast(email, 10000);
            }
            updateStatus(`No shipping confirmation found for ${email}`);
            return false;
        } catch (err) {
            updateStatus(`Error in tryMoreActions for ${email}: ${err.message}`);
            return false;
        }
    }

    async function waitForPageLoad(timeout = 15000) {
        return new Promise((resolve) => {
            if (document.readyState === "complete") {
                updateStatus("Page already loaded");
                resolve(true);
                return;
            }
            const onLoad = () => {
                updateStatus("Page load completed");
                resolve(true);
                window.removeEventListener("load", onLoad);
            };
            window.addEventListener("load", onLoad);
            window.__emailProcessorListeners.push(onLoad);
            setTimeout(() => {
                updateStatus("Page load timeout, proceeding anyway");
                resolve(false);
                window.removeEventListener("load", onLoad);
                window.__emailProcessorListeners = window.__emailProcessorListeners.filter(l => l !== onLoad);
            }, timeout);
        });
    }

    async function reloadTabAndReinject() {
        try {
            await chrome.runtime.sendMessage({ action: "reloadAndReinject", tabId });
            updateStatus("Requested tab reload and reinjection");
            cleanupObservers();
            window.__emailProcessorRunning = false;
        } catch (err) {
            updateStatus(`Error requesting reload: ${err.message}`);
            throw err;
        }
    }

    async function processSingleEmail(email) {
        let { delay = 100, attemptDelay = 4000, failedDelay = 1000, skipAttempts = false, reloadOption = 'none' } = await chrome.storage.local.get(["delay", "attemptDelay", "failedDelay", "skipAttempts", "reloadOption"]);
        let maxAttempts = skipAttempts ? 1 : 3;
        let reloadAttempt = reloadOption === 'after2' ? 2 : reloadOption === 'after3' ? 3 : 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let { stopFlag = false } = await chrome.storage.local.get("stopFlag");
            if (stopFlag || window.__emailProcessorRunning !== scriptId) {
                cleanupObservers();
                return false;
            }

            updateStatus(`Processing.... ${email} (Attempt ${attempt}/${maxAttempts})`);

            try {
                let trigger = await waitForElement(
                    'button[data-hook="InfoCard__MenuTrigger"]',
                    null,
                    5000
                ).catch(() => null);
                if (!trigger) throw new Error("Trigger not found");
                await backgroundClick(trigger);

                let editOrAddBtn = await findActionButton(
                    ["Edit email address", "Add email address"],
                    3000
                );
                if (!editOrAddBtn) {
                    updateStatus(`Edit/Add button not found for ${email}, re-clicking InfoCard__MenuTrigger`);
                    trigger = await waitForElement(
                        'button[data-hook="InfoCard__MenuTrigger"]',
                        null,
                        5000
                    ).catch(() => null);
                    if (!trigger) throw new Error("Trigger not found on retry");
                    await backgroundClick(trigger);
                    editOrAddBtn = await findActionButton(
                        ["Edit email address", "Add email address"],
                        3000
                    );
                    if (!editOrAddBtn) throw new Error("Edit/Add button not found after retry");
                }

                await backgroundClick(editOrAddBtn);
                updateStatus(`${editOrAddBtn.textContent.trim()} for ${email}`);
                await sleep(delay);

                const emailInput = await waitForElement(
                    'div[data-hook="EditEmailAddressModal__EmailInput"] input',
                    null,
                    4000
                ).catch(() => null);
                if (!emailInput) throw new Error("Email input not found");
                emailInput.focus();
                emailInput.value = email;
                emailInput.dispatchEvent(new Event("input", { bubbles: true }));
                await sleep(delay);

                const submitBtn = await findSubmitButton(5000);
                if (!submitBtn) throw new Error("Submit button not found");
                await backgroundClick(submitBtn);
                updateStatus(`${submitBtn.textContent.trim()} for ${email}`);

                try {
                    await waitForEditToastAndEmailOnPage(email, 5000);
                } catch (err) {
                    if (
                        err.message === "Neither Edit toast nor Email found on page within timeout" ||
                        err.message === "Edit toast not found within timeout" ||
                        err.message === "Email not found on page within timeout"
                    ) {
                        updateStatus(`Retrying due to ${err.message}, re-clicking InfoCard__MenuTrigger for ${email}`);
                        trigger = await waitForElement(
                            'button[data-hook="InfoCard__MenuTrigger"]',
                            null,
                            5000
                        ).catch(() => null);
                        if (!trigger) throw new Error("Trigger not found on retry");
                        await backgroundClick(trigger);

                        editOrAddBtn = await findActionButton(
                            ["Edit email address", "Add email address"],
                            3000
                        );
                        if (!editOrAddBtn) {
                            updateStatus(`Edit/Add button not found for ${email} in toast retry, re-clicking InfoCard__MenuTrigger`);
                            trigger = await waitForElement(
                                'button[data-hook="InfoCard__MenuTrigger"]',
                                null,
                                5000
                            ).catch(() => null);
                            if (!trigger) throw new Error("Trigger not found on toast retry");
                            await backgroundClick(trigger);
                            editOrAddBtn = await findActionButton(
                                ["Edit email address", "Add email address"],
                                3000
                            );
                            if (!editOrAddBtn) throw new Error("Edit/Add button not found after toast retry");
                        }

                        await backgroundClick(editOrAddBtn);
                        updateStatus(`${editOrAddBtn.textContent.trim()} for ${email} (Toast Retry)`);
                        await sleep(delay);

                        let inputFound = false;
                        let retryEmailInput;
                        for (let inputAttempt = 1; inputAttempt <= 3; inputAttempt++) {
                            retryEmailInput = await waitForElement(
                                'div[data-hook="EditEmailAddressModal__EmailInput"] input',
                                null,
                                4000
                            ).catch(() => null);
                            if (retryEmailInput) {
                                inputFound = true;
                                break;
                            }
                            updateStatus(`Email input not found on toast retry (attempt ${inputAttempt}/3), re-clicking InfoCard__MenuTrigger`);
                            trigger = await waitForElement(
                                'button[data-hook="InfoCard__MenuTrigger"]',
                                null,
                                5000
                            ).catch(() => null);
                            if (!trigger) throw new Error(`Trigger not found on input retry attempt ${inputAttempt}`);
                            await backgroundClick(trigger);

                            editOrAddBtn = await findActionButton(
                                ["Edit email address", "Add email address"],
                                3000
                            );
                            if (!editOrAddBtn) throw new Error(`Edit/Add button not found on input retry attempt ${inputAttempt}`);
                            await backgroundClick(editOrAddBtn);
                            updateStatus(`${editOrAddBtn.textContent.trim()} for ${email} (Input Retry ${inputAttempt})`);
                            await sleep(delay);
                        }
                        if (!inputFound) throw new Error("Email input not found after 3 retries on toast retry");

                        retryEmailInput.focus();
                        retryEmailInput.value = email;
                        retryEmailInput.dispatchEvent(new Event("input", { bubbles: true }));
                        await sleep(delay);

                        const retrySubmitBtn = await findSubmitButton(5000);
                        if (!retrySubmitBtn) throw new Error("Submit button not found on toast retry");
                        await backgroundClick(retrySubmitBtn);
                        updateStatus(`${retrySubmitBtn.textContent.trim()} for ${email} (Toast Retry)`);

                        await waitForEditToastAndEmailOnPage(email, 5000);
                    } else {
                        throw err;
                    }
                }

                let success = false;
                for (let i = 0; i < 6 && !success; i++) {
                    success = await tryMoreActions(email);
                    if (!success) await sleep(delay);
                }

                if (success) {
                    let { sentEmails = [] } = await chrome.storage.local.get("sentEmails");
                    sentEmails.push(email);
                    await chrome.storage.local.set({ sentEmails });
                    updateStatus(`---- Sent: ${email}`);
                    cleanupObservers();
                    await sleep(delay);
                    return true;
                } else {
                    throw new Error("Failed to send email");
                }

            } catch (err) {
                updateStatus(`!!! Attempt ${attempt} failed: ${err.message}`);

                if (attempt === reloadAttempt && reloadAttempt > 0) {
                    updateStatus(`Attempt ${attempt} failed for ${email}, reloading tab...`);
                    await reloadTabAndReinject();
                    return false;
                }

                if (err.message === "Failed to send email" || attempt === maxAttempts) {
                    let { failedEmails = [] } = await chrome.storage.local.get("failedEmails");
                    if (!failedEmails.includes(email)) {
                        failedEmails.push(email);
                        await chrome.storage.local.set({ failedEmails });
                        updateStatus(`Giving up: ${email} - Added to failed emails`);
                    }
                    cleanupObservers();
                    await sleep(failedDelay);
                    return false;
                }

                if (!skipAttempts) {
                    if (attempt === 1) {
                        updateStatus(`Retrying for ${email} after ${delay}ms (before attempt 2)`);
                        await sleep(delay * 2);
                    } else if (attempt === 2) {
                        updateStatus(`Waiting ${attemptDelay}ms before attempt 3 for ${email}`);
                        await sleep(attemptDelay);
                    }
                }
            }
        }
        cleanupObservers();
        return false;
    }

    async function processEmails() {
        if (processing || window.__emailProcessorRunning !== scriptId) return;
        processing = true;
        updateStatus("Starting parallel processing...");
        await waitForPageLoad(15000);
        updateStatus("Page loaded, beginning email processing");

        const { reloadAfterSent = 0 } = await chrome.storage.local.get("reloadAfterSent");
        let sentCount = 0;

        while (true) {
            let { stopFlag = false } = await chrome.storage.local.get("stopFlag");
            let data = await chrome.storage.local.get(emailListKey);
            let emailList = data[emailListKey] || [];

            if (stopFlag || window.__emailProcessorRunning !== scriptId) {
                updateStatus("Process stopped by user");
                processing = false;
                cleanupObservers();
                window.__emailProcessorRunning = false;
                return;
            }

            if (emailList.length === 0) {
                let { emailList: globalEmailList = [] } = await chrome.storage.local.get("emailList");
                if (globalEmailList.length === 0) {
                    updateStatus("No more emails to process in this tab");
                    processing = false;
                    await chrome.storage.local.set({ stopFlag: false });
                    cleanupObservers();
                    window.__emailProcessorRunning = false;
                    return;
                }

                let email = globalEmailList.shift();
                emailList = [email];
                await chrome.storage.local.set({ [emailListKey]: emailList, emailList: globalEmailList });
                updateStatus(`Fetched new email from global list: ${email}`);
            }

            let email = emailList.shift();
            await chrome.storage.local.set({ [emailListKey]: emailList });

            try {
                const success = await processSingleEmail(email);
                if (success) {
                    sentCount++;
                    if (reloadAfterSent > 0 && sentCount % reloadAfterSent === 0) {
                        updateStatus(`Sent ${sentCount} emails, reloading tab for maintenance...`);
                        await reloadTabAndReinject();
                        return;
                    }
                }
            } catch (e) {
                updateStatus(`Error processing ${email}: ${e.message}, skipping to next email`);
                cleanupObservers();
            }
        }
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === "startProcessing") {
            if (!processing && window.__emailProcessorRunning === scriptId) {
                updateStatus("Received start message");
                processEmails().catch(err => console.error(`[Tab ${tabId}] Process error:`, err));
            }
            sendResponse({ status: "started" });
        } else if (msg.action === "stopProcessing") {
            updateStatus("Received stop message");
            processing = false;
            cleanupObservers();
            window.__emailProcessorRunning = false;
            sendResponse({ status: "stopped" });
        }
        return true;
    });

    window.addEventListener("unload", () => {
        cleanupObservers();
        window.__emailProcessorRunning = false;
        window.__emailProcessorListeners.forEach(listener => window.removeEventListener("unload", listener));
        window.__emailProcessorListeners = [];
    });

    updateStatus("Waiting for start signal...");
})();