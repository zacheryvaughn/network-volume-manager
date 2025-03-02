// Core API and error handling
const API = {
    getCurrentPath: () => window.location.pathname.substring(1),

    async request(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || response.statusText || 'Request failed');
        }
        return response.headers.get('content-type')?.includes('application/json') ?
            response.json() : response;
    },

    // Helper to create FormData
    createFormData(params) {
        const formData = new FormData();
        Object.entries(params).forEach(([key, value]) => {
            formData.append(key, value);
        });
        return formData;
    },

    // API methods with unified approach
    createFolder: (path) => API.request(`/create-folder/${path}`, { method: 'POST' }),
    
    deleteItem: (path, itemName) => 
        API.request(`/delete/${path || '.'}`, { 
            method: 'POST', 
            body: API.createFormData({ item_name: itemName }) 
        }),
    
    renameItem: (path, oldName, newName) => 
        API.request(`/rename/${path || '.'}`, { 
            method: 'POST', 
            body: API.createFormData({ old_name: oldName, new_name: newName }) 
        }),
    
    moveItem: (path, itemName, destination) => 
        API.request(`/move/${path || '.'}`, { 
            method: 'POST', 
            body: API.createFormData({ item_name: itemName, destination }) 
        }),
    
    // Batch operations
    async batchOperation(path, itemNames, operation) {
        const results = { success: [], failed: [] };
        
        for (const itemName of itemNames) {
            try {
                await operation(path || '.', itemName);
                results.success.push(itemName);
            } catch (error) {
                results.failed.push({ name: itemName, error: error.message });
            }
        }
        return results;
    },
    
    // Use the batch operation method for delete and move
    deleteMultipleItems: (path, itemNames) => 
        API.batchOperation(path, itemNames, API.deleteItem),
    
    moveMultipleItems: (path, itemNames, destination) => 
        API.batchOperation(path, itemNames, (path, itemName) => 
            API.moveItem(path, itemName, destination)),
    
    // Search operations
    search: (query) => API.request(`/search?query=${encodeURIComponent(query)}`),
    searchFolders: (query) => API.request(`/search?query=${encodeURIComponent(query)}&folders_only=true`)
};

// Utility functions
function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || isNaN(bytes)) return '0 B';
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// DOM Helper functions
const DOM = {
    getElement: (id) => document.getElementById(id),
    getElements: (selector) => document.querySelectorAll(selector),
    
    createElementWithHTML: (tag, className, html) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (html) element.innerHTML = html;
        return element;
    },
    
    replaceWithClone: (element) => {
        if (!element) return null;
        const clone = element.cloneNode(true);
        element.parentNode.replaceChild(clone, element);
        return clone;
    },
    
    setDisplay: (element, visible) => {
        if (element) element.style.display = visible ? 'block' : 'none';
    },
    
    toggleClass: (element, className, force) => {
        if (element) element.classList.toggle(className, force);
    }
};

// UI Manager handles all UI operations
class UIManager {
    constructor() {
        this.initializeComponents();
        this.initializeEventListeners();
        this.uploadQueue = [];
        this.isUploading = false;
        this.selectedItems = new Set();
        this.selectionMode = false;
        this.moveModalInitialized = false;
        this.currentXhr = null; // Store the current XMLHttpRequest
    }

    initializeComponents() {
        // Cache DOM elements
        this.elements = {
            itemsList: DOM.getElement('items-list'),
            viewToggle: DOM.getElement('view-toggle'),
            viewToggleText: document.querySelector('#view-toggle .view-icon'),
            uploadQueue: DOM.getElement('upload-queue'),
            progressBar: DOM.getElement('progressBar'),
            queuedFiles: DOM.getElement('queued-files'),
            searchInput: DOM.getElement('search-input'),
            searchResults: DOM.getElement('search-results'),
            searchContent: document.querySelector('.search-results-content'),
            selectToggle: DOM.getElement('select-toggle'),
            deleteSelected: DOM.getElement('delete-selected'),
            moveSelected: DOM.getElement('move-selected'),
            browserContent: DOM.getElement('browser-content'),
            selectAllFolders: DOM.getElement('select-all-folders'),
            selectAllFiles: DOM.getElement('select-all-files')
        };

        // Initialize view mode
        this.viewMode = localStorage.getItem('fileViewMode') || 'list';
        this.updateViewMode(this.viewMode, true); // true = skip saving to localStorage
    }

    initializeEventListeners() {
        // View toggle
        if (this.elements.viewToggle) {
            this.elements.viewToggle.addEventListener('click', () => {
                this.updateViewMode(this.viewMode === 'grid' ? 'list' : 'grid');
            });
        }

        // Selection mode toggle
        if (this.elements.selectToggle) {
            this.elements.selectToggle.addEventListener('click', () => this.toggleSelectionMode());
        }

        // Delete and move selected items
        if (this.elements.deleteSelected) {
            this.elements.deleteSelected.addEventListener('click', () => this.deleteSelectedItems());
        }
        
        if (this.elements.moveSelected) {
            this.elements.moveSelected.addEventListener('click', () => this.moveSelectedItems());
        }
        
        // Select all buttons
        this.setupSelectAllButton(this.elements.selectAllFolders, 'folder');
        this.setupSelectAllButton(this.elements.selectAllFiles, 'file');

        // File upload
        const fileInput = DOM.getElement('file');
        if (fileInput) {
            const newInput = DOM.replaceWithClone(fileInput);
            newInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
        }

        // Search
        this.setupSearch();

        // Item click handling
        this.setupItemClickHandlers();
        
        // Initialize options list event listeners
        this.initializeItemOptionsListeners();
        
        // Setup move modal
        this.setupMoveModal();
    }
    
    setupSearch() {
        if (!this.elements.searchInput) return;
        
        this.elements.searchInput.addEventListener('input', debounce(() => this.performSearch(), 300));
        this.elements.searchInput.addEventListener('focus', () => {
            if (this.elements.searchInput.value) this.showSearchResults();
        });
        
        document.addEventListener('click', (e) => {
            if (!this.elements.searchResults.contains(e.target) && e.target !== this.elements.searchInput) {
                DOM.setDisplay(this.elements.searchResults, false);
            }
        });
    }
    
    setupItemClickHandlers() {
        document.addEventListener('click', (e) => {
            // Handle clicking on item name (navigation)
            if (e.target.classList.contains('item-name') && !e.target.querySelector('.rename-input')) {
                // Don't navigate when in selection mode
                if (!this.selectionMode) {
                    const path = e.target.dataset.path;
                    if (path) location.href = path;
                }
            }
            
            // Handle clicking on checkboxes
            if (e.target.classList.contains('item-checkbox')) {
                const item = e.target.closest('.item');
                const itemName = item.dataset.name;
                
                if (e.target.checked) {
                    this.selectedItems.add(itemName);
                } else {
                    this.selectedItems.delete(itemName);
                }
                
                this.updateSelectedButtons();
            }
        });
    }
    
    setupSelectAllButton(button, itemType) {
        if (!button) return;
        
        // Remove any existing event listeners by cloning and replacing
        const newBtn = DOM.replaceWithClone(button);
        
        // Add new event listener
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.selectAllItems(itemType);
        });
        
        // Hide by default (only shown in selection mode)
        newBtn.style.display = 'none';
        
        // Update the reference
        if (itemType === 'folder') {
            this.elements.selectAllFolders = newBtn;
        } else {
            this.elements.selectAllFiles = newBtn;
        }
    }

    initializeItemOptionsListeners() {
        const itemOptionsButtons = DOM.getElements('.options-btn');
        const itemOptionsLists = DOM.getElements('.item-options');

        // Attach click handlers to each options button
        Array.from(itemOptionsButtons).forEach((button, index) => {
            button.addEventListener('click', (e) => {
                const optionsList = itemOptionsLists[index];
                // Toggle open state
                if (!optionsList.classList.contains('options-open')) {
                    // Close any other open options lists
                    Array.from(itemOptionsLists).forEach(list => list.classList.remove('options-open'));
                    optionsList.classList.add('options-open');
                    e.stopPropagation();
                } else {
                    optionsList.classList.remove('options-open');
                }
            });
        });

        // Document-level listener to close any open options list on any click
        document.addEventListener('click', () => {
            Array.from(itemOptionsLists).forEach(list => list.classList.remove('options-open'));
        });
    }

    updateViewMode(mode, skipSave = false) {
        if (!this.elements.itemsList || !this.elements.viewToggle) return;

        // Update state
        this.viewMode = mode;
        if (!skipSave) {
            localStorage.setItem('fileViewMode', mode);
        }

        // Update UI
        DOM.toggleClass(this.elements.itemsList, 'grid-view', mode === 'grid');
        
        // SVG icons for list and grid views
        const gridIcon = '<svg class="view-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M32 288c-17.7 0-32 14.3-32 32s14.3 32 32 32l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 288zm0-128c-17.7 0-32 14.3-32 32s14.3 32 32 32l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 160z"/></svg>';
        const listIcon = '<svg class="view-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M128 136c0-22.1-17.9-40-40-40L40 96C17.9 96 0 113.9 0 136l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm0 192c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm32-192l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM288 328c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm32-192l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM448 328c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48z"/></svg>';
        
        this.elements.viewToggleText.innerHTML = mode === 'grid' ? gridIcon : listIcon;
    }

    async refreshContent() {
        try {
            const response = await fetch(window.location.pathname);
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newContent = doc.getElementById('browser-content');

            if (newContent) {
                document.getElementById('browser-content').innerHTML = newContent.innerHTML;

                // Re-cache the elements that were replaced
                this.elements.itemsList = DOM.getElement('items-list');
                this.elements.browserContent = DOM.getElement('browser-content');
                this.elements.selectAllFolders = DOM.getElement('select-all-folders');
                this.elements.selectAllFiles = DOM.getElement('select-all-files');

                // Reapply the current view mode
                if (this.elements.itemsList) {
                    this.updateViewMode(this.viewMode, true);
                }
                
                // If in selection mode, restore selection mode state
                if (this.selectionMode) {
                    this.restoreSelectionState();
                }

                // Reinitialize options listeners
                this.initializeItemOptionsListeners();

                return true;
            }
            return false;
        } catch (error) {
            console.error('Error refreshing content:', error);
            return false;
        }
    }
    
    restoreSelectionState() {
        DOM.toggleClass(this.elements.browserContent, 'selection-mode', true);
        
        // Show select all buttons
        this.setupSelectAllButton(this.elements.selectAllFolders, 'folder');
        this.setupSelectAllButton(this.elements.selectAllFiles, 'file');
        
        if (this.elements.selectAllFolders) this.elements.selectAllFolders.style.display = 'inline-block';
        if (this.elements.selectAllFiles) this.elements.selectAllFiles.style.display = 'inline-block';
        
        // Check any previously selected items that still exist
        const checkboxes = DOM.getElements('.item-checkbox');
        checkboxes.forEach(checkbox => {
            const item = checkbox.closest('.item');
            if (item && this.selectedItems.has(item.dataset.name)) {
                checkbox.checked = true;
            }
        });
    }
    
    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        
        // Update UI
        DOM.toggleClass(this.elements.selectToggle, 'active', this.selectionMode);
        DOM.setDisplay(this.elements.deleteSelected, this.selectionMode);
        DOM.setDisplay(this.elements.moveSelected, this.selectionMode);
        DOM.toggleClass(this.elements.browserContent, 'selection-mode', this.selectionMode);
        
        // Show/hide select all buttons
        const displayStyle = this.selectionMode ? 'inline-block' : 'none';
        if (this.elements.selectAllFolders) this.elements.selectAllFolders.style.display = displayStyle;
        if (this.elements.selectAllFiles) this.elements.selectAllFiles.style.display = displayStyle;
        
        // Clear selection when disabling selection mode
        if (!this.selectionMode) {
            this.selectedItems.clear();
            DOM.getElements('.item-checkbox').forEach(checkbox => checkbox.checked = false);
        }
        
        this.updateSelectedButtons();
    }
    
    selectAllItems(itemType) {
        // Get all items of the specified type
        const items = DOM.getElements(`.item[data-type="${itemType}"]`);
        
        if (!items || items.length === 0) return;
        
        // Check if all items of this type are already selected
        const allSelected = Array.from(items).every(item => {
            const checkbox = item.querySelector('.item-checkbox');
            return checkbox && checkbox.checked;
        });
        
        // If all are selected, deselect all. Otherwise, select all.
        items.forEach(item => {
            const checkbox = item.querySelector('.item-checkbox');
            const itemName = item.dataset.name;
            
            if (!checkbox || !itemName) return;
            
            checkbox.checked = !allSelected;
            if (allSelected) {
                this.selectedItems.delete(itemName);
            } else {
                this.selectedItems.add(itemName);
            }
        });
        
        this.updateSelectedButtons();
    }
    
    updateSelectedButtons() {
        const count = this.selectedItems.size;
        
        if (this.elements.deleteSelected) {
            this.elements.deleteSelected.textContent = count > 0 ? `Delete (${count})` : 'Delete';
            this.elements.deleteSelected.disabled = count === 0;
        }
        
        if (this.elements.moveSelected) {
            this.elements.moveSelected.textContent = count > 0 ? `Move (${count})` : 'Move';
            this.elements.moveSelected.disabled = count === 0;
        }
    }
    
    async deleteSelectedItems() {
        if (this.selectedItems.size === 0) return;
        
        const selectedArray = Array.from(this.selectedItems);
        if (!confirm(`Are you sure you want to delete ${selectedArray.length} item(s)?`)) return;
        
        try {
            const results = await API.deleteMultipleItems(API.getCurrentPath(), selectedArray);
            
            if (results.failed.length > 0) {
                alert(`Failed to delete ${results.failed.length} item(s).`);
            }
            
            await this.refreshContent();
            this.selectedItems.clear();
            this.updateSelectedButtons();
            this.toggleSelectionMode(); // Disable selection mode
        } catch (error) {
            alert(`Error deleting items: ${error.message}`);
        }
    }
    
    moveSelectedItems() {
        if (this.selectedItems.size === 0) return;
        
        const selectedArray = Array.from(this.selectedItems);
        this.showMoveModal('Move Items', `Moving ${selectedArray.length} item(s)`, async (destination) => {
            try {
                const results = await API.moveMultipleItems(
                    API.getCurrentPath(), 
                    selectedArray, 
                    destination.trim() === '' ? '' : destination
                );
                
                if (results.failed.length > 0) {
                    alert(`Failed to move ${results.failed.length} item(s).`);
                }
                
                await this.refreshContent();
                this.selectedItems.clear();
                this.updateSelectedButtons();
                this.toggleSelectionMode();
                return true;
            } catch (error) {
                alert(`Error moving items: ${error.message}`);
                return false;
            }
        });
    }

    handleFileSelection(files) {
        if (!files?.length) return;

        const maxSize = 32 * 1024 * 1024 * 1024; // 32GB
        const validFiles = Array.from(files).filter(file => {
            if (file.size > maxSize) {
                alert(`File ${file.name} exceeds 32GB limit`);
                return false;
            }
            return true;
        });

        if (!validFiles.length) return;

        this.elements.progressBar.style.width = '0%';

        validFiles.forEach(file => {
            const item = DOM.createElementWithHTML('div', 'queue-item', `
                <div class="queue-item-name">${file.name}</div>
                <div class="queue-item-size">${formatFileSize(file.size)}</div>
                <button class="cancel-upload-btn" title="Cancel upload">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
                        <path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/>
                    </svg>
                </button>
            `);
            
            // Add event listener to the cancel button
            const cancelBtn = item.querySelector('.cancel-upload-btn');
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancelUpload(file);
            });
            
            this.elements.queuedFiles.appendChild(item);
            this.uploadQueue.push({ file, element: item });
        });

        if (!this.isUploading) this.processUploadQueue();
    }

    async processUploadQueue() {
        if (!this.uploadQueue.length) {
            this.isUploading = false;
            this.elements.progressBar.style.width = '0%';
            return;
        }

        this.isUploading = true;
        const { file, element } = this.uploadQueue[0];
        element.classList.add('uploading');
        
        // Make the cancel button more prominent during upload
        const cancelBtn = element.querySelector('.cancel-upload-btn');
        if (cancelBtn) cancelBtn.classList.add('uploading');

        try {
            await this.uploadFile(file);
            element.style.opacity = '0';
            setTimeout(() => {
                element.remove();
                this.uploadQueue.shift();
                this.processUploadQueue();
            }, 300);
            await this.refreshContent();
        } catch (error) {
            if (error.message === 'Upload canceled') {
                // Handle canceled upload
                element.classList.add('canceled');
                setTimeout(() => {
                    element.style.opacity = '0';
                    setTimeout(() => {
                        element.remove();
                        this.uploadQueue.shift();
                        this.processUploadQueue();
                    }, 300);
                }, 1000);
            } else {
                // Handle other errors
                alert(error.message);
                element.remove();
                this.uploadQueue.shift();
                this.processUploadQueue();
            }
        }
    }

    uploadFile(file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            // Store the current XHR so it can be aborted if needed
            this.currentXhr = xhr;
            
            xhr.open('POST', `/upload/${API.getCurrentPath() || '.'}`, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    this.elements.progressBar.style.width = `${percent}%`;
                }
            };

            xhr.onload = () => {
                this.currentXhr = null;
                if (xhr.status === 200 || xhr.status === 303) {
                    resolve();
                } else {
                    try {
                        const response = JSON.parse(xhr.responseText);
                        reject(new Error(response.detail || 'Upload failed'));
                    } catch {
                        reject(new Error('Upload failed'));
                    }
                }
            };

            xhr.onerror = () => {
                this.currentXhr = null;
                reject(new Error('Network error during upload'));
            };
            
            xhr.onabort = () => {
                this.currentXhr = null;
                reject(new Error('Upload canceled'));
            };

            const formData = new FormData();
            formData.append('file', file);
            xhr.send(formData);
        });
    }
    
    cancelUpload(file) {
        // If this is the currently uploading file
        if (this.isUploading && this.uploadQueue.length > 0 && this.uploadQueue[0].file === file) {
            // Abort the current XHR request
            if (this.currentXhr) {
                this.currentXhr.abort();
                this.currentXhr = null;
            }
        } else {
            // Remove from queue if it's not the current upload
            const index = this.uploadQueue.findIndex(item => item.file === file);
            if (index !== -1) {
                const { element } = this.uploadQueue[index];
                element.style.opacity = '0';
                setTimeout(() => {
                    element.remove();
                }, 300);
                this.uploadQueue.splice(index, 1);
            }
        }
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            DOM.setDisplay(this.elements.searchResults, false);
            return;
        }

        try {
            const results = await API.search(query);
            if (!results.files.length && !results.folders.length) {
                DOM.setDisplay(this.elements.searchResults, false);
                return;
            }

            // Generate HTML for search results
            const generateResultHTML = (items, isFolder) => {
                return items.map(item => {
                    const pathParts = item.path.split('/');
                    const itemName = pathParts.pop() || item.name;
                    const parentFolder = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '/';
                    const containingFolder = isFolder ? item.path : (pathParts.length > 0 ? pathParts.join('/') : '/');
                    
                    return `
                    <div class="search-result-item" onclick="location.href='./${containingFolder}'">
                        <span class="icon">${isFolder ? '📁' : '📄'}</span>
                        <span class="name">${itemName}</span>
                        <span class="path">${parentFolder}/</span>
                    </div>
                    `;
                }).join('');
            };

            // Combine folder and file results
            this.elements.searchContent.innerHTML = 
                generateResultHTML(results.folders, true) + 
                generateResultHTML(results.files, false);
                
            this.showSearchResults();
        } catch (error) {
            this.elements.searchContent.innerHTML = '<div class="search-error">No results found</div>';
            this.showSearchResults();
        }
    }

    showSearchResults() {
        DOM.setDisplay(this.elements.searchResults, true);
    }

    async startRename(element, isFolder) {
        if (!element?.textContent || element.querySelector('.rename-input')) return;

        const itemName = element.textContent;
        const originalHtml = element.innerHTML;
        const originalOnClick = element.onclick;

        try {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'rename-input';
            input.maxLength = 255;

            const displayName = isFolder ?
                itemName.slice(0, -1) :
                itemName.substring(0, itemName.lastIndexOf('.')) || itemName;

            input.value = displayName.trim();
            if (!isFolder) {
                input.dataset.extension = itemName.slice(itemName.lastIndexOf('.')) || '';
            }

            const cleanup = () => {
                element.innerHTML = originalHtml;
                element.onclick = originalOnClick;
            };

            element.onclick = null;
            element.innerHTML = '';
            element.appendChild(input);

            input.addEventListener('blur', async () => {
                const newName = input.value.trim();
                if (newName && !/[<>:"/\\|?*\x00-\x1F]/.test(newName)) {
                    try {
                        const fullNewName = isFolder ? newName : newName + (input.dataset.extension || '');
                        await API.renameItem(API.getCurrentPath(), itemName, fullNewName);
                        await this.refreshContent();
                        return;
                    } catch (error) {
                        alert(error.message);
                    }
                }
                cleanup();
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    cleanup();
                }
            });

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

    async deleteItem(name, isFolder) {
        if (!name) return;

        const confirmMessage = isFolder
            ? `Are you sure you want to delete the folder "${name}"?\nAll items within the folder will also be deleted.`
            : `Are you sure you want to delete the file "${name}"?`;

        if (!confirm(confirmMessage)) return;

        try {
            await API.deleteItem(API.getCurrentPath(), name);
            await this.refreshContent();
            
            // If in selection mode, disable it after delete
            if (this.selectionMode) {
                this.toggleSelectionMode();
            }
        } catch (error) {
            alert(error.message);
        }
    }
    
    setupMoveModal() {
        const moveModal = DOM.getElement('move-modal');
        const closeModalBtn = document.querySelector('.close-modal');
        const destinationPath = DOM.getElement('destination-path');
        const destinationSearchResults = DOM.getElement('destination-search-results');
        
        if (this.moveModalInitialized) return;
        this.moveModalInitialized = true;
        
        // Close modal when clicking the X
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                moveModal.style.display = 'none';
            });
        }
        
        // Close modal when clicking outside the modal content
        window.addEventListener('click', (e) => {
            if (e.target === moveModal) {
                moveModal.style.display = 'none';
            }
        });
        
        // Folder search functionality
        if (destinationPath) {
            destinationPath.addEventListener('input', debounce(async () => {
                const query = destinationPath.value.trim();
                if (!query) {
                    DOM.setDisplay(destinationSearchResults, false);
                    return;
                }
                
                try {
                    const results = await API.searchFolders(query);
                    if (!results.folders.length) {
                        DOM.setDisplay(destinationSearchResults, false);
                        return;
                    }
                    
                    destinationSearchResults.innerHTML = results.folders.map(folder => `
                        <div class="destination-result-item" data-path="${folder.path}">
                            <span class="folder-icon">📁</span>
                            <span class="folder-name">${folder.path}</span>
                        </div>
                    `).join('');
                    
                    DOM.setDisplay(destinationSearchResults, true);
                    
                    // Add click handlers to search results
                    DOM.getElements('.destination-result-item').forEach(item => {
                        item.addEventListener('click', () => {
                            destinationPath.value = item.dataset.path;
                            DOM.setDisplay(destinationSearchResults, false);
                        });
                    });
                } catch (error) {
                    console.error('Error searching folders:', error);
                    DOM.setDisplay(destinationSearchResults, false);
                }
            }, 300));
            
            // Close search results when clicking outside
            document.addEventListener('click', (e) => {
                if (!destinationPath.contains(e.target) && !destinationSearchResults.contains(e.target)) {
                    DOM.setDisplay(destinationSearchResults, false);
                }
            });
            
            // Handle keyboard navigation
            destinationPath.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    DOM.setDisplay(destinationSearchResults, false);
                } else if (e.key === 'Enter' && destinationSearchResults.style.display === 'block') {
                    // Select the first result on enter
                    const firstResult = destinationSearchResults.querySelector('.destination-result-item');
                    if (firstResult) {
                        destinationPath.value = firstResult.dataset.path;
                        DOM.setDisplay(destinationSearchResults, false);
                        e.preventDefault(); // Prevent form submission
                    }
                }
            });
        }
    }
    
    showMoveModal(title, message, onConfirm) {
        const moveModal = DOM.getElement('move-modal');
        const modalTitle = DOM.getElement('move-modal-title');
        const moveItemMessage = DOM.getElement('move-item-message');
        const destinationInput = DOM.getElement('destination-path');
        const moveConfirmBtn = DOM.getElement('move-confirm-btn');
        
        if (modalTitle) modalTitle.textContent = title;
        if (moveItemMessage) moveItemMessage.textContent = message;
        
        // Set current path as default destination
        if (destinationInput) destinationInput.value = API.getCurrentPath();
        
        // Update confirm button handler
        if (moveConfirmBtn) {
            const newMoveBtn = DOM.replaceWithClone(moveConfirmBtn);
            
            newMoveBtn.addEventListener('click', async () => {
                const destination = destinationInput.value.trim();
                const success = await onConfirm(destination);
                
                if (success) {
                    DOM.setDisplay(moveModal, false);
                }
            });
        }
        
        // Show modal and focus input
        if (moveModal) {
            DOM.setDisplay(moveModal, true);
            if (destinationInput) {
                destinationInput.focus();
                destinationInput.select();
            }
        }
    }
}

// Directory change handler
async function changeDirectory() {
    const directoryInput = DOM.getElement('directory-input');
    const changeDirBtn = DOM.getElement('change-directory-btn');

    // Toggle lock state if input is disabled
    if (directoryInput.disabled) {
        directoryInput.disabled = false;
        changeDirBtn.classList.remove('locked');
        return;
    }

    const newPath = directoryInput.value.trim();
    if (!newPath) {
        alert('Please enter a directory path');
        return;
    }

    try {
        const response = await fetch('/change-directory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Failed to change directory');
        }

        // Lock the input after successful directory change
        directoryInput.disabled = true;
        changeDirBtn.classList.add('locked');

        // Redirect to root of new directory
        window.location.href = '/';
    } catch (error) {
        alert(error.message);
    }
}

// Initialize UI
let ui;
document.addEventListener('DOMContentLoaded', () => {
    ui = new UIManager();

    // Initialize directory input and button
    const directoryInput = DOM.getElement('directory-input');
    const changeDirBtn = DOM.getElement('change-directory-btn');
    const baseDirBtn = document.querySelector('.path-part-btn');
    const errorMessage = document.querySelector('.error-message');

    // Set up directory input and lock state
    if (directoryInput && changeDirBtn) {
        // If there's an error message (volume not mounted), keep the input unlocked
        if (errorMessage && errorMessage.textContent.includes('not mounted')) {
            directoryInput.disabled = false;
            changeDirBtn.classList.remove('locked');
        } else if (baseDirBtn) {
            // Normal case: volume is mounted
            directoryInput.value = baseDirBtn.textContent.trim();
            directoryInput.disabled = true;
            changeDirBtn.classList.add('locked');
        }
        
        // Always add the click event listener
        changeDirBtn.addEventListener('click', changeDirectory);
    }
});

// Global interface
window.startRename = (element, isFolder) => ui?.startRename(element, isFolder);
window.deleteItem = (name, isFolder) => ui?.deleteItem(name, isFolder);
window.startMove = (name, isFile) => {
    if (!ui) return;
    
    ui.showMoveModal('Move Item', `Moving: ${name}`, async (destination) => {
        try {
            await API.moveItem(API.getCurrentPath(), name, destination.trim() === '' ? '' : destination);
            await ui.refreshContent();
            
            // If in selection mode, disable it after move
            if (ui.selectionMode) {
                ui.toggleSelectionMode();
            }
            return true;
        } catch (error) {
            alert(`Error moving item: ${error.message}`);
            return false;
        }
    });
};

window.createFolder = async () => {
    try {
        await API.createFolder(API.getCurrentPath());
        await ui?.refreshContent();
    } catch (error) {
        alert(error.message);
    }
};
