// Queue management
let uploadQueue = [];
let isUploading = false;

// View management
function initializeViewToggle() {
    const viewToggle = document.getElementById('view-toggle');
    const itemsList = document.querySelector('#browser-content .items-list');
    
    if (!viewToggle || !itemsList) return;

    // Load saved view preference
    const currentView = localStorage.getItem('fileViewMode') || 'list';
    if (currentView === 'grid') {
        itemsList.classList.add('grid-view');
        viewToggle.classList.add('grid-active');
    }

    // Toggle view mode
    viewToggle.addEventListener('click', () => {
        const isGrid = itemsList.classList.toggle('grid-view');
        viewToggle.classList.toggle('grid-active', isGrid);
        localStorage.setItem('fileViewMode', isGrid ? 'grid' : 'list');
    });
}

// Initialize view toggle on page load and after content updates
document.addEventListener('DOMContentLoaded', initializeViewToggle);

// Re-initialize view toggle after file upload (when content is refreshed)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const responseClone = response.clone();
    
    if (args[0] === window.location.pathname) {
        responseClone.text().then(() => {
            setTimeout(initializeViewToggle, 0);
        });
    }
    
    return response;
};

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Toggle queue state
document.getElementById('close-upload-queue-btn').onclick = function() {
    const uploadQueue = document.getElementById('upload-queue');
    uploadQueue.classList.toggle('closed');
};

document.getElementById('file').onchange = function() {
    const files = Array.from(this.files);
    if (!files.length) return;
    
    const maxSize = 32 * 1024 * 1024 * 1024; // 32GB
    const queueContainer = document.getElementById('queue-container');
    const queuedFiles = document.getElementById('queued-files');
    
    // Show queue if it was hidden
    queueContainer.style.display = 'block';
    document.getElementById('upload-queue').classList.remove('closed');
    
    // Add files to queue
    files.forEach(file => {
        if (file.size > maxSize) {
            alert(`File ${file.name} exceeds 32GB limit`);
            return;
        }
        
        // Create queue item
        const queueItem = document.createElement('div');
        queueItem.className = 'queue-item';
        queueItem.innerHTML = `
            <div class="queue-item-name">${file.name}</div>
            <div class="queue-item-size">${formatFileSize(file.size)}</div>
        `;
        
        // Add to visual queue at bottom
        queuedFiles.insertBefore(queueItem, queuedFiles.firstChild);
        
        // Add to beginning of queue (so bottom items are processed last)
        uploadQueue.unshift({
            file: file,
            element: queueItem
        });
    });
    
    // Start upload if not already uploading
    if (!isUploading) {
        uploadNext();
    }
};

function uploadNext() {
    if (uploadQueue.length === 0) {
        isUploading = false;
        const progressContainer = document.querySelector('.progress-container');
        progressContainer.style.opacity = '0';
        return;
    }
    
    isUploading = true;
    const {file, element} = uploadQueue[0];
    
    // Show and reset progress container
    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressContainer.style.display = 'block';
    progressContainer.style.opacity = '1';
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = 'var(--color-blue-500)';
    
    // Mark current item as uploading
    element.classList.add('uploading');
    
    const xhr = new XMLHttpRequest();
    const currentPath = window.location.pathname.substring(1);
    xhr.open('POST', '/upload/' + currentPath, true);
    
    xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            const roundedPercent = Math.round(percentComplete * 10) / 10;
            requestAnimationFrame(() => {
                progressBar.style.width = roundedPercent + '%';
                progressText.textContent = Math.round(roundedPercent) + '%';
            });
        }
    };
    
    xhr.onload = function() {
        if (xhr.status === 303 || xhr.status === 200) {
            progressText.textContent = 'Upload Complete!';
            progressBar.style.backgroundColor = 'var(--color-green-500)';
            element.classList.remove('uploading');
            element.classList.add('complete');
            
            // Refresh browser content and remove completed item
            fetch(window.location.pathname)
                .then(response => response.text())
                .then(html => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    document.getElementById('browser-content').innerHTML =
                        doc.getElementById('browser-content').innerHTML;
                    element.remove();
                })
                .finally(() => {
                    // Remove from queue and upload next
                    uploadQueue.shift();
                    setTimeout(uploadNext, 500);
                });
        } else {
            handleUploadError();
        }
    };
    
    xhr.onerror = handleUploadError;
    
    function handleUploadError() {
        progressText.textContent = 'Upload Failed!';
        progressBar.style.backgroundColor = 'var(--color-red-600)';
        element.classList.remove('uploading');
        uploadQueue.shift();
        setTimeout(uploadNext, 1000);
    }
    
    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
};

function createFolder() {
    fetch('/create-folder/' + window.location.pathname.substring(1), {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            window.location.reload();
        }
    })
    .catch(error => alert('Error creating folder: ' + error));
}

// Handle folder navigation
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('item-name') && !e.target.querySelector('.rename-input')) {
        const path = e.target.dataset.path;
        if (path) {
            location.href = path;
        }
    }
});

function startRename(element, isFolder) {
    const itemName = element.textContent;
    element.onclick = null; // Disable navigation while renaming
    const input = document.createElement('input');
    input.type = 'text';
    input.value = isFolder ? itemName.slice(0, -1) : itemName; // Remove trailing slash for folders
    input.className = 'rename-input';
    
    function completeRename() {
        const newName = input.value.trim();
        if (newName && newName !== (isFolder ? itemName.slice(0, -1) : itemName)) {
            const formData = new FormData();
            formData.append('old_name', isFolder ? itemName.slice(0, -1) : itemName);
            formData.append('new_name', newName);

            fetch('/rename/' + window.location.pathname.substring(1), {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                    element.textContent = itemName;
                } else {
                    window.location.reload();
                }
            })
            .catch(error => {
                alert('Error renaming: ' + error);
                element.textContent = itemName;
            });
        } else {
            element.textContent = itemName;
        }
    }

    input.onblur = completeRename;
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            element.textContent = itemName;
        }
    };

    element.textContent = '';
    element.appendChild(input);
    input.focus();
    input.select();
}

function deleteItem(name, isFolder) {
    let confirmMessage = `Are you sure you want to delete this file: ${name}?`;
    if (isFolder) {
        confirmMessage = `Are you sure you want to delete this folder? All items within the folder will also be deleted.`;
    }
    if (confirm(confirmMessage)) {
        const formData = new FormData();
        formData.append('item_name', name);

        fetch('/delete/' + window.location.pathname.substring(1), {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert(data.error);
            } else {
                window.location.reload();
            }
        })
        .catch(error => alert(`Error deleting ${itemType}: ` + error));
    }
}