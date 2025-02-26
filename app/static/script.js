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
    }
};

// UI Manager handles all UI operations
class UIManager {
    constructor() {
        this.initializeComponents();
        this.initializeEventListeners();
        this.uploadQueue = [];
        this.isUploading = false;
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
            searchContent: document.querySelector('.search-results-content')
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

        // File upload
        const fileInput = document.getElementById('file');
        if (fileInput) {
            const newInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newInput, fileInput);
            newInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
        }

        // Search
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', 
                debounce(() => this.performSearch(), 300));
            this.elements.searchInput.addEventListener('focus', () => {
                if (this.elements.searchInput.value) this.showSearchResults();
            });
            document.addEventListener('click', (e) => {
                if (!this.elements.searchResults.contains(e.target) && 
                    e.target !== this.elements.searchInput) {
                    this.elements.searchResults.style.display = 'none';
                }
            });
        }

        // Item click handling
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('item-name') && 
                !e.target.querySelector('.rename-input')) {
                const path = e.target.dataset.path;
                if (path) location.href = path;
            }
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
        this.elements.viewToggleText.textContent = mode === 'grid' ? 'List View' : 'Grid View';
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
                
                // Re-cache the items list element as it's been replaced
                this.elements.itemsList = document.getElementById('items-list');
                
                // Reapply the current view mode
                if (this.elements.itemsList) {
                    this.updateViewMode(this.viewMode, true);
                }

                // Update directory input with new base directory
                const directoryInput = document.getElementById('directory-input');
                const baseDirBtn = document.querySelector('.path-part-btn');
                if (directoryInput && baseDirBtn) {
                    directoryInput.value = baseDirBtn.textContent.trim();
                }

                return true;
            }
            return false;
        } catch (error) {
            console.error('Error refreshing content:', error);
            return false;
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

            let html = results.folders.map(folder => `
                <div class="search-result-item" onclick="location.href='./${folder.path}'">
                    <span class="icon">📁</span>
                    <span class="name">${folder.name}</span>
                    <span class="path">${folder.path}</span>
                </div>
            `).join('');

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
});

// Global interface
window.startRename = (element, isFolder) => ui?.startRename(element, isFolder);
window.deleteItem = (name, isFolder) => ui?.deleteItem(name, isFolder);
window.createFolder = async () => {
    try {
        await API.createFolder(API.getCurrentPath());
        await ui?.refreshContent();
    } catch (error) {
        alert(error.message);
    }
};
