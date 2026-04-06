const ENCRYPTED_KEYS = [
    { ct: "YHzYxAZGkc1TaNIt9jFehU1HOdLqklvHUgfaetxuGAn/0hkq+indx9cmTUY6fUOxTj0sdv8=", iv: "iJbo0oXmBT54VGtX" },
    { ct: "RCkIdIJ5fL14CKUMFLTOFBbgmPTNsCa04UC6Cp/lltlBxwflr7IrXwlAnYYbWJ7JDqBaMdg=", iv: "EPnMMNoIjfP18769" },
    { ct: "idhyyZTrYqgJn2C8BoiFZ1jqAxXw+sAfpo7Sl9IdBU5hQGSWqssGl0KWymhTiLCNXehBYz8=", iv: "I3DaNTPiwWwklrp7" }
];
const SALT = "c2l0ZV93ZWJfc2FsdF8xMjM=";

function base64ToUint8Array(base64) {
    const raw = window.atob(base64);
    const result = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        result[i] = raw.charCodeAt(i);
    }
    return result;
}

async function decryptKeys(password) {
    try {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            { name: "PBKDF2" },
            false,
            ["deriveKey"]
        );
        const key = await window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: base64ToUint8Array(SALT),
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"]
        );

        const decrypted = [];
        for (const ek of ENCRYPTED_KEYS) {
            const iv = base64ToUint8Array(ek.iv);
            const ct = base64ToUint8Array(ek.ct);
            const decryptedBuffer = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ct
            );
            decrypted.push(new TextDecoder().decode(decryptedBuffer));
        }
        return decrypted;
    } catch (e) {
        return null;
    }
}

async function runInference(imgDataUri, validKeys) {
    let lastError = null;
    for (const key of validKeys) {
        try {
            const response = await fetch(
                'https://api-inference.huggingface.co/v1/chat/completions',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'google/gemma-4-31B-it:novita',
                        messages: [{
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Describe this image in one sentence.' },
                                { type: 'image_url', image_url: { url: imgDataUri } }
                            ]
                        }],
                        max_tokens: 100
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`API Error ${response.status}: ${errorData}`);
            }

            const data = await response.json();
            return { status: 'success', content: data.choices[0].message.content };
        } catch (err) {
            lastError = err.message;
            console.warn("Key fallback triggered due to:", err);
            continue; 
        }
    }
    return { status: 'error', error: lastError };
}

document.addEventListener('DOMContentLoaded', () => {
    // Auth elements
    const authSection = document.getElementById('auth-section');
    const appSection = document.getElementById('app-section');
    const passwordInput = document.getElementById('password');
    const unlockBtn = document.getElementById('unlock-btn');
    const authError = document.getElementById('auth-error');

    // App elements
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const previewContainer = document.getElementById('file-preview-container');
    const runBtn = document.getElementById('run-btn');
    const resultsContainer = document.getElementById('results-container');
    const resultsList = document.getElementById('results-list');

    let currentPassword = '';
    let decryptedApiKeys = null;
    let imagesData = []; // Array of { id, dataUri }

    // --- Authentication ---
    unlockBtn.addEventListener('click', async () => {
        const pwd = passwordInput.value.trim();
        if (!pwd) {
            showAuthError('Please enter the password.');
            return;
        }
        
        unlockBtn.disabled = true;
        unlockBtn.textContent = 'Verifying...';
        
        const keys = await decryptKeys(pwd);
        
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Unlock Settings';
        
        if (!keys) {
            showAuthError('Invalid password. Unable to decrypt API keys.');
            return;
        }

        decryptedApiKeys = keys;
        currentPassword = pwd;
        authSection.classList.remove('active');
        authSection.classList.add('hidden');
        appSection.classList.remove('hidden');
        appSection.classList.add('active');
    });

    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') unlockBtn.click();
    });

    function showAuthError(msg) {
        authError.textContent = msg;
        authError.classList.remove('hidden');
    }

    // --- File Upload & Preview ---

    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files) {
            handleFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files) {
            handleFiles(e.target.files);
            fileInput.value = ''; // reset
        }
    });

    function handleFiles(files) {
        let filesArray = Array.from(files).filter(f => f.type.startsWith('image/'));
        
        if (imagesData.length + filesArray.length > 10) {
            alert('You can upload a maximum of 10 images.');
            filesArray = filesArray.slice(0, 10 - imagesData.length);
        }

        filesArray.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUri = e.target.result;
                const id = Date.now().toString() + Math.random().toString(36).substr(2, 5);
                imagesData.push({ id, dataUri });
                renderPreviews();
                updateRunButton();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderPreviews() {
        if (imagesData.length > 0) {
            previewContainer.classList.remove('hidden');
        } else {
            previewContainer.classList.add('hidden');
        }

        previewContainer.innerHTML = '';
        imagesData.forEach(img => {
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${img.dataUri}" alt="preview" />
                <button class="remove-btn" data-id="${img.id}">×</button>
            `;
            previewContainer.appendChild(div);
        });

        // Add remove events
        document.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                imagesData = imagesData.filter(img => img.id !== id);
                renderPreviews();
                updateRunButton();
            });
        });
    }

    function updateRunButton() {
        if (imagesData.length > 0) {
            runBtn.classList.remove('disabled');
            runBtn.removeAttribute('disabled');
        } else {
            runBtn.classList.add('disabled');
            runBtn.setAttribute('disabled', 'true');
        }
    }

    // --- API Interaction ---

    runBtn.addEventListener('click', async () => {
        if (imagesData.length === 0 || !decryptedApiKeys) return;

        runBtn.classList.add('disabled');
        runBtn.setAttribute('disabled', 'true');
        runBtn.innerHTML = '<span class="loader"></span> Processing...';
        
        resultsContainer.classList.remove('hidden');
        resultsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Analyzing images...</p>';

        const finalResults = [];

        // Process images concurrently or sequentially? Sequentially is safer for free API limits.
        for (let i = 0; i < imagesData.length; i++) {
            resultsList.innerHTML = `<p style="text-align: center; color: var(--text-secondary);">Analyzing image ${i+1} of ${imagesData.length}...</p>`;
            const res = await runInference(imagesData[i].dataUri, decryptedApiKeys);
            finalResults.push(res);
        }

        renderResults(finalResults);
        
        runBtn.innerHTML = 'Run Inference';
        updateRunButton();
    });

    function renderResults(resultsArray) {
        resultsList.innerHTML = '';
        resultsArray.forEach((res, index) => {
            const imgData = imagesData[index];
            const card = document.createElement('div');
            card.className = 'result-card';
            
            const imgHtml = `<img src="${imgData.dataUri}" alt="Thumb" />`;
            let contentHtml = '';

            if (res.status === 'success') {
                contentHtml = `
                    <div class="result-text">${escapeHtml(res.content)}</div>
                    <button class="copy-btn" data-text="${escapeHtml(res.content)}">📋 Copy text</button>
                `;
            } else {
                contentHtml = `<div class="result-text result-error">Failed: ${escapeHtml(res.error)}</div>`;
            }

            card.innerHTML = `
                ${imgHtml}
                <div class="result-content">
                    ${contentHtml}
                </div>
            `;
            resultsList.appendChild(card);
        });

        // Add copy events
        document.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const text = e.target.getAttribute('data-text');
                const tempTextarea = document.createElement('textarea');
                tempTextarea.innerHTML = text;
                const unescaped = tempTextarea.value;
                navigator.clipboard.writeText(unescaped).then(() => {
                    const originalText = e.target.innerText;
                    e.target.innerText = '✅ Copied!';
                    setTimeout(() => { e.target.innerText = originalText; }, 2000);
                });
            });
        });
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return "";
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});
