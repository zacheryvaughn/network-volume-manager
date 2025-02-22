class APIClient {
    static async handleResponse(response, errorPrefix) {
        if (!response.ok) {
            const data = await response.json();
            throw new Error(`${errorPrefix}: ${data.detail || 'Unknown error'}`);
        }
        return response.json();
    }

    static async createFolder(path) {
        const response = await fetch('/create-folder/' + path, {
            method: 'POST'
        });
        return this.handleResponse(response, 'Error creating folder');
    }

    static async renameItem(path, oldName, newName) {
        const formData = new FormData();
        formData.append('old_name', oldName);
        formData.append('new_name', newName);

        const response = await fetch('/rename/' + path, {
            method: 'POST',
            body: formData
        });
        return this.handleResponse(response, 'Error renaming');
    }

    static async deleteItem(path, itemName) {
        const formData = new FormData();
        formData.append('item_name', itemName);

        const response = await fetch('/delete/' + path, {
            method: 'POST',
            body: formData
        });
        return this.handleResponse(response, 'Error deleting');
    }

    static async refreshContent() {
        const response = await fetch(window.location.pathname);
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        document.getElementById('browser-content').innerHTML =
            doc.getElementById('browser-content').innerHTML;
    }
}

class ViewManager {
    constructor() {
        this.viewToggle = document.getElementById('view-toggle');
        this.itemsList = document.querySelector('#browser-content .items-list');
        this.initialize();
    }

    initialize() {
        if (!this.viewToggle || !this.itemsList) return;

        const currentView = localStorage.getItem('fileViewMode') || 'list';
        this.setView(currentView);

        this.viewToggle.addEventListener('click', () => this.toggleView());
    }

    setView(view) {
        const isGrid = view === 'grid';
        this.itemsList.classList.toggle('grid-view', isGrid);
        this.viewToggle.classList.toggle('grid-active', isGrid);
    }

    toggleView() {
        const isGrid = this.itemsList.classList.toggle('grid-view');
        this.viewToggle.classList.toggle('grid-active', isGrid);
        localStorage.setItem('fileViewMode', isGrid ? 'grid' : 'list');
    }
}

class UIManager {
    constructor() {
        this.viewManager = new ViewManager();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        document.addEventListener('click', this.handleItemClick.bind(this));
        document.getElementById('close-upload-queue-btn')?.addEventListener('click', () => {
            document.getElementById('upload-queue')?.classList.toggle('closed');
        });
    }

    handleItemClick(e) {
        if (e.target.classList.contains('item-name') && !e.target.querySelector('.rename-input')) {
            const path = e.target.dataset.path;
            if (path) {
                location.href = path;
            }
        }
    }

    static formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async startRename(element, isFolder) {
        const itemName = element.textContent;
        const input = this.createRenameInput(itemName, isFolder);
        
        element.onclick = null;
        element.textContent = '';
        element.appendChild(input);
        input.focus();
        input.select();

        input.onblur = () => this.completeRename(input, element, itemName, isFolder);
        input.onkeydown = (e) => this.handleRenameKeydown(e, input, element, itemName);
    }

    createRenameInput(itemName, isFolder) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = isFolder ? itemName.slice(0, -1) : itemName;
        input.className = 'rename-input';
        return input;
    }

    async completeRename(input, element, oldName, isFolder) {
        const newName = input.value.trim();
        const originalName = isFolder ? oldName.slice(0, -1) : oldName;

        if (newName && newName !== originalName) {
            try {
                await APIClient.renameItem(
                    window.location.pathname.substring(1),
                    originalName,
                    newName
                );
                window.location.reload();
            } catch (error) {
                alert(error.message);
                element.textContent = oldName;
            }
        } else {
            element.textContent = oldName;
        }
    }

    handleRenameKeydown(e, input, element, itemName) {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            element.textContent = itemName;
        }
    }

    async deleteItem(name, isFolder) {
        const confirmMessage = isFolder
            ? 'Are you sure you want to delete this folder? All items within the folder will also be deleted.'
            : `Are you sure you want to delete this file: ${name}?`;

        if (confirm(confirmMessage)) {
            try {
                await APIClient.deleteItem(window.location.pathname.substring(1), name);
                window.location.reload();
            } catch (error) {
                alert(error.message);
            }
        }
    }
}

class UploadProgressUI {
    constructor() {
        this.container = document.querySelector('.progress-container');
        this.bar = document.getElementById('progressBar');
        this.text = document.getElementById('progressText');
    }

    initialize() {
        this.container.style.display = 'block';
        this.container.style.opacity = '1';
        this.bar.style.width = '0%';
        this.bar.style.backgroundColor = 'var(--color-blue-500)';
    }

    updateProgress(percent) {
        requestAnimationFrame(() => {
            this.bar.style.width = percent + '%';
            this.text.textContent = Math.round(percent) + '%';
        });
    }

    setComplete() {
        this.text.textContent = 'Upload Complete!';
        this.bar.style.backgroundColor = 'var(--color-green-500)';
    }

    setError() {
        this.text.textContent = 'Upload Failed!';
        this.bar.style.backgroundColor = 'var(--color-red-600)';
    }

    hide() {
        this.container.style.opacity = '0';
    }
}

class FileUploadManager {
    constructor() {
        this.uploadQueue = [];
        this.isUploading = false;
        this.maxSize = 32 * 1024 * 1024 * 1024; // 32GB
        this.progressUI = new UploadProgressUI();
        this.initializeFileInput();
    }

    initializeFileInput() {
        const fileInput = document.getElementById('file');
        if (!fileInput) return;
        fileInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
    }

    handleFileSelection(files) {
        if (!files.length) return;

        this.showUploadQueue();
        Array.from(files).forEach(file => this.addFileToQueue(file));

        if (!this.isUploading) {
            this.uploadNext();
        }
    }

    showUploadQueue() {
        const queueContainer = document.getElementById('queue-container');
        queueContainer.style.display = 'block';
        document.getElementById('upload-queue').classList.remove('closed');
    }

    addFileToQueue(file) {
        if (file.size > this.maxSize) {
            alert(`File ${file.name} exceeds 32GB limit`);
            return;
        }

        const queueItem = this.createQueueItem(file);
        const queuedFiles = document.getElementById('queued-files');
        queuedFiles.insertBefore(queueItem, queuedFiles.firstChild);
        
        this.uploadQueue.unshift({
            file: file,
            element: queueItem
        });
    }

    createQueueItem(file) {
        const queueItem = document.createElement('div');
        queueItem.className = 'queue-item';
        queueItem.innerHTML = `
            <div class="queue-item-name">${file.name}</div>
            <div class="queue-item-size">${UIManager.formatFileSize(file.size)}</div>
        `;
        return queueItem;
    }

    async uploadNext() {
        if (this.uploadQueue.length === 0) {
            this.isUploading = false;
            this.progressUI.hide();
            return;
        }

        this.isUploading = true;
        const {file, element} = this.uploadQueue[0];
        
        this.progressUI.initialize();
        element.classList.add('uploading');

        try {
            await this.uploadFile(file);
            await this.handleUploadSuccess(element);
        } catch (error) {
            this.handleUploadError(element);
        }

        this.uploadQueue.shift();
        setTimeout(() => this.uploadNext(), 500);
    }

    uploadFile(file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const currentPath = window.location.pathname.substring(1);
            xhr.open('POST', '/upload/' + currentPath, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    const roundedPercent = Math.round(percentComplete * 10) / 10;
                    this.progressUI.updateProgress(roundedPercent);
                }
            };

            xhr.onload = () => {
                if (xhr.status === 303 || xhr.status === 200) {
                    resolve();
                } else {
                    reject(new Error('Upload failed'));
                }
            };

            xhr.onerror = () => reject(new Error('Network error'));

            const formData = new FormData();
            formData.append('file', file);
            xhr.send(formData);
        });
    }

    async handleUploadSuccess(element) {
        this.progressUI.setComplete();
        element.classList.remove('uploading');
        element.classList.add('complete');
        
        await APIClient.refreshContent();
        element.remove();
    }

    handleUploadError(element) {
        this.progressUI.setError();
        element.classList.remove('uploading');
    }
}

// Initialize managers
let uiManager;
let fileUploadManager;

document.addEventListener('DOMContentLoaded', () => {
    uiManager = new UIManager();
    fileUploadManager = new FileUploadManager();
});

// Expose minimal global interface
window.startRename = (element, isFolder) => uiManager.startRename(element, isFolder);
window.deleteItem = (name, isFolder) => uiManager.deleteItem(name, isFolder);
window.createFolder = async () => {
    try {
        await APIClient.createFolder(window.location.pathname.substring(1));
        window.location.reload();
    } catch (error) {
        alert(error.message);
    }
};

// Re-initialize UI after content updates
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const responseClone = response.clone();
    
    if (args[0] === window.location.pathname) {
        responseClone.text().then(() => {
            setTimeout(() => uiManager?.viewManager.initialize(), 0);
        });
    }
    
    return response;
};