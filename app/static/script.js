// Error handling and UI state management
class ErrorHandler {
    static showError(error, context = '') {
        const message = error.message || 'An unexpected error occurred';
        console.error(`${context}:`, error);
        alert(message);
    }

    static handleApiError(error, context = '') {
        if (error instanceof Error) {
            this.showError(error, context);
        } else {
            this.showError(new Error('An unexpected error occurred'), context);
        }
    }
}

class UIStateManager {
    static showLoading(selector) {
        const indicator = document.querySelector(selector);
        if (indicator) indicator.style.display = 'inline-block';
    }

    static hideLoading(selector) {
        const indicator = document.querySelector(selector);
        if (indicator) indicator.style.display = 'none';
    }

    static async refreshContent() {
        try {
            const refreshed = await APIClient.refreshContent();
            if (!refreshed) window.location.reload();
            return true;
        } catch (error) {
            ErrorHandler.handleApiError(error, 'Failed to refresh content');
            return false;
        }
    }
}

class APIClient {
    static getCurrentPath() {
        return window.location.pathname.substring(1);
    }

    static async handleResponse(response, errorPrefix) {
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const errorMessage = data.detail || response.statusText || 'Unknown error';
            console.error(`${errorPrefix}:`, errorMessage);
            throw new Error(errorMessage);
        }
        
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return response.json();
        }
        return response;
    }

    static async createFolder(path) {
        const response = await fetch(`/create-folder/${path}`, {
            method: 'POST'
        });
        return this.handleResponse(response, 'Error creating folder');
    }

    static async renameItem(path, oldName, newName) {
        const formData = new FormData();
        formData.append('old_name', oldName);
        formData.append('new_name', newName);

        const response = await fetch(`/rename/${path}`, {
            method: 'POST',
            body: formData
        });
        return this.handleResponse(response, 'Error renaming');
    }

    static async deleteItem(path, itemName) {
        const formData = new FormData();
        formData.append('item_name', itemName);

        const response = await fetch(`/delete/${path}`, {
            method: 'POST',
            body: formData
        });
        return this.handleResponse(response, 'Error deleting');
    }

    static async refreshContent() {
        try {
            const response = await fetch(window.location.pathname);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newContent = doc.getElementById('browser-content');
            if (newContent) {
                document.getElementById('browser-content').innerHTML = newContent.innerHTML;
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error refreshing content:', error);
            return false;
        }
    }
}

class ViewManager {
    constructor() {
        console.log('ViewManager constructor called');
        
        // Get view toggle button
        this.viewToggle = document.getElementById('view-toggle');
        console.log('View toggle button found:', !!this.viewToggle);
        
        // Get items list
        this.itemsList = document.querySelector('#browser-content .items-list');
        console.log('Items list found:', !!this.itemsList);
        
        // Bind the toggle view handler
        this.boundToggleView = this.toggleView.bind(this);
        
        // Initialize the view
        this.initialize();
    }

    initialize() {
        if (!this.viewToggle || !this.itemsList) {
            console.warn('View elements not found during initialization');
            return;
        }

        // Clean up any existing listeners and handlers
        this.cleanup();
        this.viewToggle.onclick = null;

        // Set up the click handler
        this.viewToggle.addEventListener('click', this.boundToggleView);

        // Get and apply the current view state
        const currentView = localStorage.getItem('fileViewMode') || 'list';
        const isGrid = currentView === 'grid';

        // Apply classes directly
        this.itemsList.classList.toggle('grid-view', isGrid);
        this.viewToggle.classList.toggle('grid-active', isGrid);
        this.viewToggle.setAttribute('title', isGrid ? 'Switch to list view' : 'Switch to grid view');

        // Force a reflow if in grid view
        if (isGrid) {
            this.itemsList.style.display = 'none';
            this.itemsList.offsetHeight; // Force reflow
            this.itemsList.style.display = '';
        }
    }

    cleanup() {
        if (this.viewToggle) {
            this.viewToggle.removeEventListener('click', this.boundToggleView);
        }
    }

    setView(view) {
        console.log('setView called with view:', view);
        console.log('Elements state:', {
            itemsList: !!this.itemsList,
            viewToggle: !!this.viewToggle,
            itemsListClasses: this.itemsList?.classList.toString(),
            viewToggleClasses: this.viewToggle?.classList.toString()
        });
        
        if (!this.itemsList || !this.viewToggle) {
            console.warn('View elements not found during setView');
            return;
        }
        
        try {
            const isGrid = view === 'grid';
            console.log('Setting view to:', isGrid ? 'grid' : 'list');
            
            // Update classes for items list
            this.itemsList.classList.toggle('grid-view', isGrid);
            console.log('After toggle itemsList classes:', this.itemsList.classList.toString());
            
            // Update classes for view toggle button
            this.viewToggle.classList.toggle('grid-active', isGrid);
            console.log('After toggle viewToggle classes:', this.viewToggle.classList.toString());
            
            // Update button title
            this.viewToggle.setAttribute('title',
                isGrid ? 'Switch to list view' : 'Switch to grid view'
            );
            
            // Save the current view state
            localStorage.setItem('fileViewMode', view);
            console.log('View state saved to localStorage:', view);
            
        } catch (error) {
            console.error('Failed to set view:', error);
        }
    }

    toggleView(event) {
        event?.preventDefault();
        
        if (!this.itemsList || !this.viewToggle) {
            console.warn('View elements not found during toggle');
            return;
        }
        
        try {
            // Check current state directly from the DOM
            const isCurrentlyGrid = this.itemsList.classList.contains('grid-view');
            
            // Toggle classes directly
            this.itemsList.classList.toggle('grid-view');
            this.viewToggle.classList.toggle('grid-active');
            
            // Update localStorage
            localStorage.setItem('fileViewMode', isCurrentlyGrid ? 'list' : 'grid');
            
            // Update button title
            this.viewToggle.setAttribute('title',
                isCurrentlyGrid ? 'Switch to grid view' : 'Switch to list view'
            );
            
            // Force a reflow when switching to grid view
            if (!isCurrentlyGrid) {
                this.itemsList.style.display = 'none';
                this.itemsList.offsetHeight; // Force reflow
                this.itemsList.style.display = '';
            }
        } catch (error) {
            console.error('Failed to toggle view:', error);
        }
    }
}

class UIManager {
    constructor() {
        this.viewManager = new ViewManager();
        this.boundHandleItemClick = this.handleItemClick.bind(this);
        this.boundHandleQueueClose = this.handleQueueClose.bind(this);
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        this.cleanup();
        document.addEventListener('click', this.boundHandleItemClick);
        
        const closeQueueBtn = document.getElementById('close-upload-queue-btn');
        if (closeQueueBtn) {
            closeQueueBtn.addEventListener('click', this.boundHandleQueueClose);
        }
    }

    cleanup() {
        document.removeEventListener('click', this.boundHandleItemClick);
        
        const closeQueueBtn = document.getElementById('close-upload-queue-btn');
        if (closeQueueBtn) {
            closeQueueBtn.removeEventListener('click', this.boundHandleQueueClose);
        }

        this.viewManager.cleanup();
    }

    handleQueueClose() {
        const uploadQueue = document.getElementById('upload-queue');
        if (uploadQueue) {
            uploadQueue.classList.toggle('closed');
        }
    }

    handleItemClick(e) {
        if (!e.target.classList.contains('item-name') || e.target.querySelector('.rename-input')) {
            return;
        }

        const path = e.target.dataset.path;
        if (path) {
            try {
                location.href = path;
            } catch (error) {
                ErrorHandler.handleApiError(error, 'Error navigating to path');
            }
        }
    }

    static formatFileSize(bytes) {
        if (typeof bytes !== 'number' || isNaN(bytes)) return '0 B';
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
    }

    async startRename(element, isFolder) {
        // Validate element
        if (!element || !element.textContent || element.querySelector('.rename-input')) {
            ErrorHandler.showError(
                new Error('Invalid element state for rename operation'),
                'Rename failed'
            );
            return;
        }

        const itemName = element.textContent;
        const originalHtml = element.innerHTML;
        const originalOnClick = element.onclick;

        try {
            const input = this.createRenameInput(itemName, isFolder);
            
            // Store event handlers
            const handleBlur = async () => {
                try {
                    const newName = input.value.trim();
                    if (newName && !/[<>:"/\\|?*\x00-\x1F]/.test(newName)) {
                        const displayOldName = isFolder ? itemName.slice(0, -1) : itemName.split('.')[0];
                        if (newName !== displayOldName) {
                            await this.completeRename(input, element, itemName, isFolder);
                            await UIStateManager.refreshContent();
                            return;
                        }
                    }
                } catch (error) {
                    if (error.message === 'Invalid characters in name') {
                        ErrorHandler.showError(new Error('File name contains invalid characters'), 'Rename failed');
                    } else {
                        ErrorHandler.handleApiError(error, 'Rename failed');
                    }
                } finally {
                    cleanup();
                }
            };

            const handleKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    cleanup();
                }
            };

            const handleOutsideClick = (e) => {
                if (!element.contains(e.target)) {
                    input.blur();
                }
            };

            const cleanup = () => {
                input.removeEventListener('blur', handleBlur);
                input.removeEventListener('keydown', handleKeydown);
                window.removeEventListener('click', handleOutsideClick);
                element.innerHTML = originalHtml;
                element.onclick = originalOnClick;
            };

            // Setup input
            element.onclick = null;
            element.innerHTML = '';
            element.appendChild(input);
            
            // Add event listeners
            input.addEventListener('blur', handleBlur);
            input.addEventListener('keydown', handleKeydown);
            window.addEventListener('click', handleOutsideClick);

            // Focus input after setup
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        } catch (error) {
            console.error('Error starting rename:', error);
            element.innerHTML = originalHtml;
            element.onclick = originalOnClick;
        }
    }

    createRenameInput(itemName, isFolder) {
        const input = document.createElement('input');
        input.type = 'text';
        
        let displayName = isFolder ? 
            itemName.slice(0, -1) : 
            itemName.substring(0, itemName.lastIndexOf('.')) || itemName;
        
        if (!isFolder) {
            input.dataset.extension = itemName.slice(itemName.lastIndexOf('.')) || '';
        }
        
        input.value = displayName.trim();
        input.className = 'rename-input';
        input.dataset.isFolder = isFolder;
        input.maxLength = 255;
        
        return input;
    }

    async completeRename(input, element, oldName, isFolder) {
        const newName = input.value.trim();
        const fullNewName = isFolder ? newName : newName + (input.dataset.extension || '');
        
        // Make the API call to rename the item
        await APIClient.renameItem(APIClient.getCurrentPath(), oldName, fullNewName);
    }

    async deleteItem(name, isFolder) {
        if (!name) {
            console.error('No item name provided for deletion');
            return;
        }

        const confirmMessage = isFolder
            ? `Are you sure you want to delete the folder "${name}"?\nAll items within the folder will also be deleted.`
            : `Are you sure you want to delete the file "${name}"?`;

        if (!confirm(confirmMessage)) return;

        const loadingSelector = `[data-name="${name}"] .loading-indicator`;
        try {
            UIStateManager.showLoading(loadingSelector);
            await APIClient.deleteItem(APIClient.getCurrentPath(), name);
            await UIStateManager.refreshContent();
        } catch (error) {
            ErrorHandler.handleApiError(error, `Failed to delete ${isFolder ? 'folder' : 'file'}`);
        } finally {
            UIStateManager.hideLoading(loadingSelector);
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
            ErrorHandler.showError(
                new Error(`File ${file.name} exceeds 32GB limit`),
                'File size limit exceeded'
            );
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
            const currentPath = APIClient.getCurrentPath();
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

            xhr.onerror = () => {
                const error = new Error('Network error during file upload');
                ErrorHandler.handleApiError(error, 'Upload failed');
                reject(error);
            };

            const formData = new FormData();
            formData.append('file', file);
            xhr.send(formData);
        });
    }

    async handleUploadSuccess(element) {
        this.progressUI.setComplete();
        element.classList.remove('uploading');
        element.classList.add('complete');
        
        await UIStateManager.refreshContent();
        element.remove();
    }

    handleUploadError(element) {
        this.progressUI.setError();
        element.classList.remove('uploading');
    }
}

class SearchManager {
    constructor() {
        this.searchInput = document.getElementById('search-input');
        this.searchResults = document.getElementById('search-results');
        this.searchResultsContent = document.querySelector('.search-results-content');
        this.debounceTimeout = null;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        if (!this.searchInput) return;

        this.searchInput.addEventListener('input', () => {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = setTimeout(() => this.performSearch(), 300);
        });

        this.searchInput.addEventListener('focus', () => {
            if (this.searchInput.value) {
                this.showResults();
            }
        });

        document.addEventListener('click', (e) => {
            if (!this.searchResults.contains(e.target) && e.target !== this.searchInput) {
                this.hideResults();
            }
        });
    }

    async performSearch() {
        const query = this.searchInput.value.trim();
        
        if (!query) {
            this.hideResults();
            return;
        }

        try {
            const response = await fetch(`/search?query=${encodeURIComponent(query)}`);
            const results = await response.json();
            this.displayResults(results);
        } catch (error) {
            ErrorHandler.handleApiError(error, 'Search failed');
            this.searchResultsContent.innerHTML = '<div class="search-error">No results found</div>';
            this.showResults();
        }
    }

    displayResults(results) {
        if (!results.files.length && !results.folders.length) {
            this.hideResults();
            return;
        }

        let html = '';

        if (results.folders.length) {
            html += results.folders.map(folder => `
                <div class="search-result-item" onclick="location.href='./${folder.path}'">
                    <span class="icon">📁</span>
                    <span class="name">${folder.name}</span>
                    <span class="path">${folder.path}</span>
                </div>
            `).join('');
        }

        if (results.files.length) {
            html += results.files.map(file => {
                const dirPath = file.path.split('/').slice(0, -1).join('/');
                return `
                    <div class="search-result-item" onclick="location.href='./${dirPath}'">
                        <span class="icon">📄</span>
                        <span class="name">${file.name}</span>
                        <span class="path">${file.path}</span>
                    </div>
                `;
            }).join('');
        }

        this.searchResultsContent.innerHTML = html;
        this.showResults();
    }

    showResults() {
        this.searchResults.style.display = 'block';
    }

    hideResults() {
        this.searchResults.style.display = 'none';
    }
}

// Initialize managers
let uiManager;
let fileUploadManager;
let searchManager;

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    
    // Initialize UI components after a short delay to ensure all elements are ready
    setTimeout(() => {
        console.log('Initializing UI components');
        
        // Initialize managers
        uiManager = new UIManager();
        fileUploadManager = new FileUploadManager();
        searchManager = new SearchManager();
        
        // Re-initialize view manager to ensure proper setup
        if (uiManager?.viewManager) {
            console.log('Re-initializing view manager');
            uiManager.viewManager.initialize();
        }
    }, 100);
});

// Add load event listener as backup
window.addEventListener('load', () => {
    console.log('Window load event fired');
    if (!uiManager) {
        console.log('Initializing UI components from load event');
        uiManager = new UIManager();
        fileUploadManager = new FileUploadManager();
        searchManager = new SearchManager();
    }
});

// Expose minimal global interface
window.startRename = function(element, isFolder) {
    if (!uiManager) {
        ErrorHandler.showError(
            new Error('UI Manager not initialized'),
            'Rename failed'
        );
        return;
    }
    return uiManager.startRename.call(uiManager, element, isFolder);
};
window.deleteItem = (name, isFolder) => uiManager.deleteItem(name, isFolder);
window.createFolder = async () => {
    const loadingSelector = '.create-folder-btn .loading-indicator';
    try {
        UIStateManager.showLoading(loadingSelector);
        await APIClient.createFolder(APIClient.getCurrentPath());
        await UIStateManager.refreshContent();
    } catch (error) {
        ErrorHandler.handleApiError(error, 'Failed to create folder');
    } finally {
        UIStateManager.hideLoading(loadingSelector);
    }
};

// Re-initialize UI after content updates
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    try {
        const response = await originalFetch.apply(this, args);
        
        if (args[0] === window.location.pathname &&
            response.headers.get('content-type')?.includes('text/html')) {
            
            const responseClone = response.clone();
            responseClone.text()
                .then(() => {
                    if (uiManager?.viewManager) {
                        requestAnimationFrame(() => uiManager.viewManager.initialize());
                    }
                })
                .catch(error => {
                    ErrorHandler.handleApiError(error, 'Error processing page update');
                });
        }
        
        return response;
    } catch (error) {
        ErrorHandler.handleApiError(error, 'Network request failed');
        throw error; // Re-throw to maintain promise rejection chain
    }
};