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
                // Store current view state
                const currentView = localStorage.getItem('fileViewMode') || 'list';
                const isGrid = currentView === 'grid';
                
                // Update content
                document.getElementById('browser-content').innerHTML = newContent.innerHTML;
                
                // Get fresh references
                const itemsList = document.querySelector('#browser-content .items-list');
                const viewToggle = document.getElementById('view-toggle');
                
                if (itemsList && viewToggle) {
                    // Apply view state directly
                    itemsList.classList.toggle('grid-view', isGrid);
                    viewToggle.classList.toggle('grid-active', isGrid);
                    viewToggle.setAttribute('title', isGrid ? 'Switch to list view' : 'Switch to grid view');
                    
                    // Force a reflow if in grid view
                    if (isGrid) {
                        itemsList.style.display = 'none';
                        itemsList.offsetHeight; // Force reflow
                        itemsList.style.display = '';
                    }
                }
                
                // Reinitialize the view manager to reattach event listeners
                if (uiManager?.viewManager) {
                    uiManager.viewManager.initialize();
                }
                
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
        // Get fresh references to DOM elements
        this.viewToggle = document.getElementById('view-toggle');
        this.itemsList = document.querySelector('#browser-content .items-list');

        if (!this.viewToggle || !this.itemsList) {
            console.warn('View elements not found during initialization');
            return;
        }

        // Clean up any existing listeners
        this.cleanup();

        // Set up the click handler
        this.viewToggle.addEventListener('click', this.boundToggleView);

        // Get current view state
        const currentView = localStorage.getItem('fileViewMode') || 'list';
        const isGrid = currentView === 'grid';

        // Apply classes directly first
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
            // Simply remove our specific event listener
            this.viewToggle.removeEventListener('click', this.boundToggleView);
        }
    }

    setView(view) {
        if (!this.itemsList || !this.viewToggle) {
            console.warn('View elements not found during setView');
            return;
        }
        
        try {
            const isGrid = view === 'grid';
            
            // First remove both classes to ensure clean state
            this.itemsList.classList.remove('grid-view', 'list-view');
            this.viewToggle.classList.remove('grid-active', 'list-active');
            
            // Then add the appropriate class
            if (isGrid) {
                this.itemsList.classList.add('grid-view');
                this.viewToggle.classList.add('grid-active');
            } else {
                this.itemsList.classList.add('list-view');
                this.viewToggle.classList.add('list-active');
            }
            
            // Update button title
            this.viewToggle.setAttribute('title',
                isGrid ? 'Switch to list view' : 'Switch to grid view'
            );
            
            // Save the current view state
            localStorage.setItem('fileViewMode', view);
            
            // Force a reflow if switching to grid view
            if (isGrid) {
                this.itemsList.style.display = 'none';
                this.itemsList.offsetHeight; // Force reflow
                this.itemsList.style.display = '';
            }
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
            // Check current state and set the opposite
            const isCurrentlyGrid = this.itemsList.classList.contains('grid-view');
            const newView = isCurrentlyGrid ? 'list' : 'grid';
            
            // Use setView to ensure consistent state management
            this.setView(newView);
            
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

class FileUploadManager {
    constructor() {
        this.queue = [];
        this.isUploading = false;
        this.maxSize = 32 * 1024 * 1024 * 1024; // 32GB
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');
        this.queuedFiles = document.getElementById('queued-files');
        this.queueContainer = document.getElementById('upload-queue');
        this.initializeFileInput();
    }

    initializeFileInput() {
        console.log('Initializing file input');
        const fileInput = document.getElementById('file');
        if (!fileInput) {
            console.error('File input element not found');
            return;
        }
        
        // Remove any existing listeners
        const newFileInput = fileInput.cloneNode(true);
        fileInput.parentNode.replaceChild(newFileInput, fileInput);
        
        // Add new listener
        newFileInput.addEventListener('change', (e) => {
            console.log('File input change event triggered');
            this.handleFileSelection(e.target.files);
        });
        
        console.log('File input initialized successfully');
    }

    handleFileSelection(files) {
        console.log('File selection triggered, files:', files?.length);
        
        if (!files?.length) {
            console.log('No files selected');
            return;
        }
        
        // Reset upload state
        this.progressBar.style.width = '0%';
        this.progressText.textContent = '';
        this.progressBar.style.backgroundColor = 'var(--color-blue-500)';
        
        // Show upload queue
        this.queueContainer.classList.remove('closed');
        this.queuedFiles.style.display = 'block';
        
        console.log('Processing selected files');
        
        // Add files to queue
        const validFiles = Array.from(files).filter(file => {
            console.log('Validating file:', file.name, 'size:', file.size);
            if (file.size > this.maxSize) {
                ErrorHandler.showError(
                    new Error(`File ${file.name} exceeds 32GB limit`),
                    'File size limit exceeded'
                );
                return false;
            }
            return true;
        });

        console.log('Valid files to upload:', validFiles.length);

        // Add valid files to queue
        validFiles.forEach(file => {
            console.log('Adding to queue:', file.name);
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.innerHTML = `
                <div class="queue-item-name">${file.name}</div>
                <div class="queue-item-size">${UIManager.formatFileSize(file.size)}</div>
            `;
            this.queuedFiles.appendChild(item);
            this.queue.push({ file, element: item });
        });

        // Start upload if not already uploading
        if (!this.isUploading && validFiles.length > 0) {
            console.log('Starting queue processing');
            this.processQueue();
        } else {
            console.log('Upload already in progress or no valid files');
        }
    }

    async processQueue() {
        console.log('Processing queue, length:', this.queue.length);
        
        if (this.queue.length === 0) {
            console.log('Queue empty, resetting upload state');
            this.isUploading = false;
            this.progressBar.style.width = '0%';
            this.progressText.textContent = '';
            // Only close queue container if there are no error items
            if (!this.queuedFiles.querySelector('.error')) {
                this.queueContainer.classList.add('closed');
            }
            return;
        }

        if (!this.isUploading) {
            console.log('Starting new upload process');
            this.isUploading = true;
            this.progressBar.style.backgroundColor = 'var(--color-blue-500)';
        }

        const { file, element } = this.queue[0];
        console.log('Processing file:', file.name);

        try {
            // Add uploading class for visual feedback
            element.classList.add('uploading');
            
            // Attempt upload
            await this.uploadFile(file);
            
            console.log('Upload successful');
            // Fade out the element before removing
            element.style.opacity = '0';
            element.style.transition = 'opacity 0.3s ease';
            
            // Wait for fade out
            await new Promise(resolve => setTimeout(resolve, 300));
            element.remove();
            
            // Refresh content
            await UIStateManager.refreshContent();
        } catch (error) {
            console.error('Upload failed:', error);
            element.classList.remove('uploading');
            element.classList.add('error');
            
            // Add error message to the element
            const errorDiv = document.createElement('div');
            errorDiv.className = 'upload-error';
            errorDiv.textContent = error.message;
            element.appendChild(errorDiv);
            
            // Add retry button
            const retryBtn = document.createElement('button');
            retryBtn.className = 'retry-upload';
            retryBtn.textContent = 'Retry';
            retryBtn.onclick = () => {
                element.classList.remove('error');
                errorDiv.remove();
                retryBtn.remove();
                // Put the file back in the queue
                this.queue.unshift({ file, element });
                if (!this.isUploading) {
                    this.processQueue();
                }
            };
            element.appendChild(retryBtn);
        }

        // Remove from queue
        this.queue.shift();
        
        // Small delay before processing next file
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.processQueue();
    }

    uploadFile(file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            
            // Get current path and ensure it's never undefined/empty for the API
            const currentPath = APIClient.getCurrentPath() || '.';
            console.log('Uploading file:', file.name, 'to path:', currentPath);
            
            // Always include the path parameter in the URL
            const uploadUrl = `/upload/${currentPath}`;
            console.log('Upload URL:', uploadUrl);
            
            xhr.open('POST', uploadUrl, true);

            // Handle progress with throttling
            let lastProgressUpdate = 0;
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const now = Date.now();
                    // Throttle progress updates to every 100ms
                    if (now - lastProgressUpdate > 100) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        this.progressBar.style.width = percent + '%';
                        this.progressText.textContent = percent + '%';
                        console.log('Upload progress:', percent + '%');
                        lastProgressUpdate = now;
                    }
                }
            };

            // Handle completion
            xhr.onload = () => {
                console.log('Upload response status:', xhr.status);
                try {
                    if (xhr.status === 200 || xhr.status === 303) {
                        this.progressBar.style.backgroundColor = 'var(--color-green-500)';
                        console.log('Upload completed successfully');
                        resolve();
                    } else {
                        let errorMessage = 'Upload failed';
                        try {
                            const response = JSON.parse(xhr.responseText);
                            errorMessage = response.detail || errorMessage;
                        } catch (e) {
                            console.error('Could not parse error response:', e);
                        }
                        this.progressBar.style.backgroundColor = 'var(--color-red-600)';
                        console.error('Upload failed:', errorMessage);
                        reject(new Error(errorMessage));
                    }
                } catch (error) {
                    console.error('Error handling upload response:', error);
                    reject(error);
                }
            };

            // Handle network errors
            xhr.onerror = (error) => {
                console.error('Upload network error:', error);
                this.progressBar.style.backgroundColor = 'var(--color-red-600)';
                reject(new Error('Network error during upload'));
            };

            // Send the file
            try {
                const formData = new FormData();
                formData.append('file', file);
                xhr.send(formData);
            } catch (error) {
                console.error('Error sending file:', error);
                reject(error);
            }
        });
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

