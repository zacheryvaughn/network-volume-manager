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

    createFolder: (path) => API.request(`/create-folder/${path}`, { method: 'POST' }),
    deleteItem: (path, itemName) => {
        const formData = new FormData();
        formData.append('item_name', itemName);
        return API.request(`/delete/${path}`, { method: 'POST', body: formData });
    },
    renameItem: (path, oldName, newName) => {
        const formData = new FormData();
        formData.append('old_name', oldName);
        formData.append('new_name', newName);
        return API.request(`/rename/${path}`, { method: 'POST', body: formData });
    },
    moveItem: (path, itemName, destination) => {
        const formData = new FormData();
        formData.append('item_name', itemName);
        formData.append('destination', destination);
        return API.request(`/move/${path}`, { method: 'POST', body: formData });
    },
    // Delete multiple items one by one
    async deleteMultipleItems(path, itemNames) {
        const results = { success: [], failed: [] };
        for (const itemName of itemNames) {
            try {
                await API.deleteItem(path, itemName);
                results.success.push(itemName);
            } catch (error) {
                results.failed.push({ name: itemName, error: error.message });
            }
        }
        return results;
    },
    
    // Move multiple items one by one
    async moveMultipleItems(path, itemNames, destination) {
        const results = { success: [], failed: [] };
        for (const itemName of itemNames) {
            try {
                await API.moveItem(path, itemName, destination);
                results.success.push(itemName);
            } catch (error) {
                results.failed.push({ name: itemName, error: error.message });
            }
        }
        return results;
    },
    
    // Search for folders only
    searchFolders: (query) => API.request(`/search?query=${encodeURIComponent(query)}&folders_only=true`)
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
    }

    initializeComponents() {
        // Cache DOM elements
        this.elements = {
            itemsList: document.getElementById('items-list'),
            viewToggle: document.getElementById('view-toggle'),
            viewToggleText: document.querySelector('#view-toggle .view-icon'),
            uploadQueue: document.getElementById('upload-queue'),
            progressBar: document.getElementById('progressBar'),
            queuedFiles: document.getElementById('queued-files'),
            searchInput: document.getElementById('search-input'),
            searchResults: document.getElementById('search-results'),
            searchContent: document.querySelector('.search-results-content'),
            selectToggle: document.getElementById('select-toggle'),
            deleteSelected: document.getElementById('delete-selected'),
            moveSelected: document.getElementById('move-selected'),
            browserContent: document.getElementById('browser-content')
        };

        // Initialize view mode
        this.viewMode = localStorage.getItem('fileViewMode') || 'list';
        this.updateViewMode(this.viewMode, true); // true = skip saving to localStorage
    }

    initializeEventListeners() {
        // View toggle
        if (this.elements.viewToggle) {
            this.elements.viewToggle.addEventListener('click', () => {
                const newMode = this.viewMode === 'grid' ? 'list' : 'grid';
                this.updateViewMode(newMode);
            });
        }

        // Selection mode toggle
        if (this.elements.selectToggle) {
            this.elements.selectToggle.addEventListener('click', () => {
                this.toggleSelectionMode();
            });
        }

        // Delete selected items
        if (this.elements.deleteSelected) {
            this.elements.deleteSelected.addEventListener('click', () => {
                this.deleteSelectedItems();
            });
        }
        
        // Move selected items
        if (this.elements.moveSelected) {
            this.elements.moveSelected.addEventListener('click', () => {
                this.moveSelectedItems();
            });
        }

        // File upload
        const fileInput = document.getElementById('file');
        if (fileInput) {
            const newInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newInput, fileInput);
            newInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
        }

        // Search
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', debounce(() => this.performSearch(), 300));
            this.elements.searchInput.addEventListener('focus', () => {
                if (this.elements.searchInput.value) this.showSearchResults();
            });
            document.addEventListener('click', (e) => {
                if (!this.elements.searchResults.contains(e.target) && e.target !== this.elements.searchInput) {
                    this.elements.searchResults.style.display = 'none';
                }
            });
        }

        // Item click handling
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

        // Initialize options list event listeners
        this.initializeItemOptionsListeners();
    }

    initializeItemOptionsListeners() {
        const itemOptionsButtons = document.getElementsByClassName('options-btn');
        const itemOptionsLists = document.getElementsByClassName('item-options');

        // Attach click handlers to each options button
        Array.from(itemOptionsButtons).forEach((button, index) => {
            button.addEventListener('click', (e) => {
                const optionsList = itemOptionsLists[index];
                // Toggle open state: if not open, open it and stop propagation so it doesn't immediately close.
                if (!optionsList.classList.contains('options-open')) {
                    // Optionally, close any other open options lists:
                    Array.from(itemOptionsLists).forEach(list => list.classList.remove('options-open'));
                    optionsList.classList.add('options-open');
                    e.stopPropagation();
                } else {
                    optionsList.classList.remove('options-open');
                }
            });
        });

        // Document-level listener to close any open options list on any click (even within the list)
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
        this.elements.itemsList.classList.toggle('grid-view', mode === 'grid');
        this.elements.viewToggleText.innerHTML = mode === 'grid' ?
            '<svg class="view-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!-- SVG code --><path d="M32 288c-17.7 0-32 14.3-32 32s14.3 32 32 32l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 288zm0-128c-17.7 0-32 14.3-32 32s14.3 32 32 32l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32L32 160z"/></svg>'
            : '<svg class="view-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><!-- SVG code --><path d="M128 136c0-22.1-17.9-40-40-40L40 96C17.9 96 0 113.9 0 136l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm0 192c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm32-192l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM288 328c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48zm32-192l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40zM448 328c0-22.1-17.9-40-40-40l-48 0c-22.1 0-40 17.9-40 40l0 48c0 22.1 17.9 40 40 40l48 0c22.1 0 40-17.9 40-40l0-48z"/></svg>';
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
                this.elements.itemsList = document.getElementById('items-list');
                this.elements.browserContent = document.getElementById('browser-content');

                // Reapply the current view mode
                if (this.elements.itemsList) {
                    this.updateViewMode(this.viewMode, true);
                }
                
                // If in selection mode, restore selection mode state
                if (this.selectionMode) {
                    this.elements.browserContent.classList.add('selection-mode');
                    
                    // Check any previously selected items that still exist
                    const checkboxes = document.querySelectorAll('.item-checkbox');
                    checkboxes.forEach(checkbox => {
                        const item = checkbox.closest('.item');
                        if (item && this.selectedItems.has(item.dataset.name)) {
                            checkbox.checked = true;
                        }
                    });
                }

                // Reinitialize options list event listeners on the new content.
                this.initializeItemOptionsListeners();

                return true;
            }
            return false;
        } catch (error) {
            console.error('Error refreshing content:', error);
            return false;
        }
    }
    
    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        
        // Update UI
        this.elements.selectToggle.classList.toggle('active', this.selectionMode);
        this.elements.deleteSelected.style.display = this.selectionMode ? 'block' : 'none';
        this.elements.moveSelected.style.display = this.selectionMode ? 'block' : 'none';
        this.elements.browserContent.classList.toggle('selection-mode', this.selectionMode);
        
        // Clear selection when disabling selection mode
        if (!this.selectionMode) {
            this.selectedItems.clear();
            
            // Uncheck all checkboxes
            const checkboxes = document.querySelectorAll('.item-checkbox');
            checkboxes.forEach(checkbox => checkbox.checked = false);
        }
        
        this.updateSelectedButtons();
    }
    
    updateSelectedButtons() {
        const count = this.selectedItems.size;
        
        // Update delete button
        if (this.elements.deleteSelected) {
            this.elements.deleteSelected.textContent = count > 0 ?
                `Delete (${count})` :
                'Delete';
            
            // Disable button if no items selected
            this.elements.deleteSelected.disabled = count === 0;
        }
        
        // Update move button
        if (this.elements.moveSelected) {
            this.elements.moveSelected.textContent = count > 0 ?
                `Move (${count})` :
                'Move';
            
            // Disable button if no items selected
            this.elements.moveSelected.disabled = count === 0;
        }
    }
    
    async deleteSelectedItems() {
        if (this.selectedItems.size === 0) return;
        
        const selectedArray = Array.from(this.selectedItems);
        const confirmMessage = `Are you sure you want to delete ${selectedArray.length} item(s)?`;
        
        if (!confirm(confirmMessage)) return;
        
        try {
            const currentPath = API.getCurrentPath();
            const results = await API.deleteMultipleItems(currentPath, selectedArray);
            
            // Show results message
            if (results.failed.length > 0) {
                alert(`Deleted ${results.success.length} item(s). Failed to delete ${results.failed.length} item(s).`);
            } else {
                alert(`Successfully deleted ${results.success.length} item(s).`);
            }
            
            // Refresh content and reset selection
            await this.refreshContent();
            this.selectedItems.clear();
            this.updateSelectedButtons();
            
        } catch (error) {
            alert(`Error deleting items: ${error.message}`);
        }
    }
    
    moveSelectedItems() {
        if (this.selectedItems.size === 0) return;
        
        // Get selected items
        const selectedArray = Array.from(this.selectedItems);
        
        // Update the modal title and message
        const modalTitle = document.getElementById('move-modal-title');
        const moveItemMessage = document.getElementById('move-item-message');
        
        if (modalTitle) {
            modalTitle.textContent = 'Move Items';
        }
        
        if (moveItemMessage) {
            moveItemMessage.textContent = `Moving ${selectedArray.length} item(s)`;
        }
        
        // Get the current path and set as default in the destination input
        const currentPath = API.getCurrentPath();
        const destinationInput = document.getElementById('destination-path');
        if (destinationInput) {
            destinationInput.value = currentPath;
        }
        
        // Update the move confirm button click handler
        const moveConfirmBtn = document.getElementById('move-confirm-btn');
        if (moveConfirmBtn) {
            // Remove any existing event listeners (not possible directly, so we clone and replace)
            const newMoveBtn = moveConfirmBtn.cloneNode(true);
            moveConfirmBtn.parentNode.replaceChild(newMoveBtn, moveConfirmBtn);
            
            // Add new event listener for multiple items
            newMoveBtn.addEventListener('click', async () => {
                const destinationPath = document.getElementById('destination-path');
                const destination = destinationPath.value.trim();
                
                if (!destination) {
                    alert('Please enter a destination path');
                    return;
                }
                
                try {
                    const currentPath = API.getCurrentPath();
                    const results = await API.moveMultipleItems(currentPath, selectedArray, destination);
                    
                    // Show results message
                    if (results.failed.length > 0) {
                        alert(`Moved ${results.success.length} item(s). Failed to move ${results.failed.length} item(s).`);
                    } else {
                        alert(`Successfully moved ${results.success.length} item(s).`);
                    }
                    
                    // Hide the modal
                    const moveModal = document.getElementById('move-modal');
                    if (moveModal) {
                        moveModal.style.display = 'none';
                    }
                    
                    // Refresh content and reset selection
                    await this.refreshContent();
                    this.selectedItems.clear();
                    this.updateSelectedButtons();
                    
                    // Reinitialize the move modal for future use with single items
                    setupMoveModal();
                    
                } catch (error) {
                    alert(`Error moving items: ${error.message}`);
                }
            });
        }
        
        // Show the modal
        const moveModal = document.getElementById('move-modal');
        if (moveModal) {
            moveModal.style.display = 'block';
            
            // Focus on the input field
            if (destinationInput) {
                destinationInput.focus();
                destinationInput.select();
            }
        }
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
            const item = document.createElement('div');
            item.className = 'queue-item';
            item.innerHTML = `
            <div class="queue-item-name">${file.name}</div>
            <div class="queue-item-size">${formatFileSize(file.size)}</div>
        `;
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
            alert(error.message);
            element.remove();
            this.uploadQueue.shift();
            this.processUploadQueue();
        }
    }

    uploadFile(file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/upload/${API.getCurrentPath() || '.'}`, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    this.elements.progressBar.style.width = `${percent}%`;
                }
            };

            xhr.onload = () => {
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

            xhr.onerror = () => reject(new Error('Network error during upload'));

            const formData = new FormData();
            formData.append('file', file);
            xhr.send(formData);
        });
    }

    async performSearch() {
        const query = this.elements.searchInput.value.trim();
        if (!query) {
            this.elements.searchResults.style.display = 'none';
            return;
        }

        try {
            const results = await API.request(`/search?query=${encodeURIComponent(query)}`);
            if (!results.files.length && !results.folders.length) {
                this.elements.searchResults.style.display = 'none';
                return;
            }

            let html = results.folders.map(folder => {
                // For folders, just show folder name and immediate parent folder
                const pathParts = folder.path.split('/');
                const folderName = pathParts.pop() || folder.name;
                // Get only the immediate parent folder name
                const parentFolder = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '/';
                
                return `
                <div class="search-result-item" onclick="location.href='./${folder.path}'">
                    <span class="icon">📁</span>
                    <span class="name">${folderName}</span>
                    <span class="path">${parentFolder}/</span>
                </div>
                `;
            }).join('');

            html += results.files.map(file => {
                // For files, show filename and immediate parent folder
                const pathParts = file.path.split('/');
                const fileName = pathParts.pop() || file.name;
                // Get only the immediate parent folder name
                const parentFolder = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '/';
                // Full path to the containing folder for navigation
                const containingFolder = pathParts.length > 0 ? pathParts.join('/') : '/';
                
                return `
                <div class="search-result-item" onclick="location.href='./${containingFolder}'">
                    <span class="icon">📄</span>
                    <span class="name">${fileName}</span>
                    <span class="path">${parentFolder}/</span>
                </div>
                `;
            }).join('');

            this.elements.searchContent.innerHTML = html;
            this.showSearchResults();
        } catch (error) {
            this.elements.searchContent.innerHTML = '<div class="search-error">No results found</div>';
            this.showSearchResults();
        }
    }

    showSearchResults() {
        this.elements.searchResults.style.display = 'block';
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
        } catch (error) {
            alert(error.message);
        }
    }
}


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

// Modal functionality
function setupMoveModal() {
    const moveModal = document.getElementById('move-modal');
    const closeModalBtn = document.querySelector('.close-modal');
    const moveConfirmBtn = document.getElementById('move-confirm-btn');
    const destinationPath = document.getElementById('destination-path');
    const destinationSearchResults = document.getElementById('destination-search-results');
    
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
                destinationSearchResults.style.display = 'none';
                return;
            }
            
            try {
                const results = await API.searchFolders(query);
                if (!results.folders.length) {
                    destinationSearchResults.style.display = 'none';
                    return;
                }
                
                let html = results.folders.map(folder => {
                    const pathParts = folder.path.split('/');
                    const folderName = pathParts.pop() || folder.name;
                    
                    return `
                    <div class="destination-result-item" data-path="${folder.path}">
                        <span class="folder-icon">📁</span>
                        <span class="folder-name">${folder.path}</span>
                    </div>
                    `;
                }).join('');
                
                destinationSearchResults.innerHTML = html;
                destinationSearchResults.style.display = 'block';
                
                // Add click handlers to search results
                const resultItems = destinationSearchResults.querySelectorAll('.destination-result-item');
                resultItems.forEach(item => {
                    item.addEventListener('click', () => {
                        destinationPath.value = item.dataset.path;
                        destinationSearchResults.style.display = 'none';
                    });
                });
            } catch (error) {
                console.error('Error searching folders:', error);
                destinationSearchResults.style.display = 'none';
            }
        }, 300));
        
        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!destinationPath.contains(e.target) && !destinationSearchResults.contains(e.target)) {
                destinationSearchResults.style.display = 'none';
            }
        });
        
        // Close search results on escape key
        destinationPath.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                destinationSearchResults.style.display = 'none';
            } else if (e.key === 'Enter' && destinationSearchResults.style.display === 'block') {
                // Select the first result on enter
                const firstResult = destinationSearchResults.querySelector('.destination-result-item');
                if (firstResult) {
                    destinationPath.value = firstResult.dataset.path;
                    destinationSearchResults.style.display = 'none';
                    e.preventDefault(); // Prevent form submission
                }
            }
        });
    }
    
    // Handle move confirmation
    if (moveConfirmBtn) {
        moveConfirmBtn.addEventListener('click', async () => {
            const itemName = document.getElementById('move-item-name').textContent;
            const destination = destinationPath.value.trim();
            
            if (!destination) {
                alert('Please enter a destination path');
                return;
            }
            
            try {
                await API.moveItem(API.getCurrentPath(), itemName, destination);
                moveModal.style.display = 'none';
                await ui?.refreshContent();
            } catch (error) {
                alert(`Error moving item: ${error.message}`);
            }
        });
    }
}

// Directory change handler
async function changeDirectory() {
    const directoryInput = document.getElementById('directory-input');
    const changeDirBtn = document.getElementById('change-directory-btn');

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
            headers: {
                'Content-Type': 'application/json'
            },
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
    const directoryInput = document.getElementById('directory-input');
    const changeDirBtn = document.getElementById('change-directory-btn');
    const baseDirBtn = document.querySelector('.path-part-btn');

    // Set up directory input and lock state
    if (directoryInput && baseDirBtn && changeDirBtn) {
        directoryInput.value = baseDirBtn.textContent.trim();
        directoryInput.disabled = true;
        changeDirBtn.classList.add('locked');
        changeDirBtn.addEventListener('click', changeDirectory);
    }
    
    // Setup move modal
    setupMoveModal();
});

// Global interface
window.startRename = (element, isFolder) => ui?.startRename(element, isFolder);
window.deleteItem = (name, isFolder) => ui?.deleteItem(name, isFolder);
window.startMove = (name, isFile) => {
    // Reset modal to single-item state
    const modalTitle = document.getElementById('move-modal-title');
    if (modalTitle) {
        modalTitle.textContent = 'Move Item';
    }
    
    // Set the item name in the modal
    const itemNameElement = document.getElementById('move-item-name');
    const moveItemMessage = document.getElementById('move-item-message');
    if (itemNameElement) {
        itemNameElement.textContent = name;
    }
    if (moveItemMessage) {
        moveItemMessage.textContent = 'Moving: ';
        const span = document.createElement('span');
        span.id = 'move-item-name';
        span.textContent = name;
        moveItemMessage.innerHTML = 'Moving: ';
        moveItemMessage.appendChild(span);
    }
    
    // Get the current path and set as default in the destination input
    const currentPath = API.getCurrentPath();
    const destinationInput = document.getElementById('destination-path');
    if (destinationInput) {
        destinationInput.value = currentPath;
    }
    
    // Reinitialize the move modal for a single item
    setupMoveModal();
    
    // Show the modal
    const moveModal = document.getElementById('move-modal');
    if (moveModal) {
        moveModal.style.display = 'block';
        
        // Focus on the input field
        if (destinationInput) {
            destinationInput.focus();
            destinationInput.select();
        }
    }
};

window.createFolder = async () => {
    try {
        await API.createFolder(API.getCurrentPath());
        await ui?.refreshContent();
    } catch (error) {
        alert(error.message);
    }
};
