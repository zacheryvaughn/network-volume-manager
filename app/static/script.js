const API = {
    getCurrentPath: () => window.location.pathname.substring(1),
    
    async request(url, options = {}) {
        const response = await fetch(url, options);
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || 'Request failed');
        }
        return response.headers.get('content-type')?.includes('application/json') ?
            response.json() : response;
    },

    createFormRequest: (path, data) => {
        const formData = new FormData();
        Object.entries(data).forEach(([key, value]) => formData.append(key, value));
        return API.request(path, { method: 'POST', body: formData });
    },

    createFolder: (path) => API.request(`/create-folder/${path}`, { method: 'POST' }),
    deleteItem: (path, itemName) => API.createFormRequest(`/delete/${path}`, { item_name: itemName }),
    renameItem: (path, oldName, newName) => API.createFormRequest(`/rename/${path}`, { old_name: oldName, new_name: newName }),
    getTotalSize: () => API.request('/total-size')
};

class UIManager {
    constructor() {
        this.initElements();
        this.initEventListeners();
        this.uploadQueue = [];
        this.isUploading = false;
        this.viewMode = localStorage.getItem('fileViewMode') || 'list';
        this.updateViewMode(this.viewMode, true);
    }

    initElements() {
        this.elements = {
            itemsList: document.getElementById('items-list'),
            viewToggle: document.getElementById('view-toggle'),
            uploadQueue: document.getElementById('upload-queue'),
            progressBar: document.getElementById('progressBar'),
            progressText: document.getElementById('progressText'),
            queuedFiles: document.getElementById('queued-files'),
            searchInput: document.getElementById('search-input'),
            searchResults: document.getElementById('search-results'),
            searchContent: document.querySelector('.search-results-content'),
            directoryInput: document.getElementById('directory-input'),
            changeDirBtn: document.getElementById('change-directory-btn')
        };
    }

    initEventListeners() {
        this.setupViewToggle();
        this.setupFileUpload();
        this.setupSearch();
        this.setupDirectoryChange();
        this.setupItemClickHandler();
        this.setupUploadQueueToggle();
    }

    setupViewToggle() {
        if (this.elements.viewToggle) {
            this.elements.viewToggle.addEventListener('click', () => 
                this.updateViewMode(this.viewMode === 'grid' ? 'list' : 'grid'));
        }
    }

    setupFileUpload() {
        const fileInput = document.getElementById('file');
        if (fileInput) {
            const newInput = fileInput.cloneNode(true);
            fileInput.parentNode.replaceChild(newInput, fileInput);
            newInput.addEventListener('change', (e) => this.handleFileSelection(e.target.files));
        }
    }

    setupSearch() {
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', debounce(() => this.performSearch(), 300));
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
    }

    setupDirectoryChange() {
        if (this.elements.directoryInput && this.elements.changeDirBtn) {
            const baseDirBtn = document.querySelector('.path-part-btn');
            if (baseDirBtn) {
                this.elements.directoryInput.value = baseDirBtn.textContent.trim();
                this.elements.directoryInput.disabled = true;
                this.elements.changeDirBtn.classList.add('locked');
            }
            this.elements.changeDirBtn.addEventListener('click', () => this.handleDirectoryChange());
        }
    }

    setupItemClickHandler() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('item-name') && 
                !e.target.querySelector('.rename-input')) {
                const path = e.target.dataset.path;
                if (path) location.href = path;
            }
        });
    }

    setupUploadQueueToggle() {
        const closeQueueBtn = document.getElementById('close-upload-queue-btn');
        if (closeQueueBtn) {
            closeQueueBtn.addEventListener('click', () => 
                this.elements.uploadQueue.classList.toggle('closed'));
        }
    }

    updateViewMode(mode, skipSave = false) {
        if (!this.elements.itemsList || !this.elements.viewToggle) return;
        
        this.viewMode = mode;
        if (!skipSave) localStorage.setItem('fileViewMode', mode);
        
        this.elements.itemsList.classList.toggle('grid-view', mode === 'grid');
        const [gridIcon, listIcon] = [
            this.elements.viewToggle.querySelector('.grid-icon'),
            this.elements.viewToggle.querySelector('.list-icon')
        ];
        gridIcon.style.display = mode === 'grid' ? 'none' : 'block';
        listIcon.style.display = mode === 'grid' ? 'block' : 'none';
    }

    async updateTotalSize() {
        try {
            const { total_size } = await API.getTotalSize();
            const dirSize = document.querySelector('.directory-size');
            if (dirSize) {
                dirSize.textContent = `Used Space: ${formatFileSize(total_size)}`;
            }
        } catch (error) {
            console.error('Error updating total size:', error);
        }
    }

    async refreshContent() {
        try {
            const response = await fetch(window.location.pathname);
            const html = await response.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const newContent = doc.getElementById('browser-content');
            
            if (newContent) {
                document.getElementById('browser-content').innerHTML = newContent.innerHTML;
                this.elements.itemsList = document.getElementById('items-list');
                this.updateViewMode(this.viewMode, true);
                
                const baseDirBtn = document.querySelector('.path-part-btn');
                if (this.elements.directoryInput && baseDirBtn) {
                    this.elements.directoryInput.value = baseDirBtn.textContent.trim();
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

        this.elements.uploadQueue.classList.remove('closed');
        this.elements.progressBar.style.width = '0%';
        this.elements.progressText.textContent = '';

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
            this.elements.progressText.textContent = '';
            this.elements.uploadQueue.classList.add('closed');
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
            await this.updateTotalSize();
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
                    this.elements.progressText.textContent = `${file.name} - ${percent}%`;
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

            const createResultItem = (item, isFolder) => `
                <div class="search-result-item" onclick="location.href='./${item.path}'">
                    <span class="icon">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${isFolder ? '512 512' : '384 512'}">
                            <path d="${isFolder ? 
                                'M448 480L64 480c-35.3 0-64-28.7-64-64L0 192l512 0 0 224c0 35.3-28.7 64-64 64zm64-320L0 160 0 96C0 60.7 28.7 32 64 32l128 0c20.1 0 39.1 9.5 51.2 25.6l19.2 25.6c6 8.1 15.5 12.8 25.6 12.8l160 0c35.3 0 64 28.7 64 64z' : 
                                'M0 64C0 28.7 28.7 0 64 0L224 0l0 128c0 17.7 14.3 32 32 32l128 0 0 288c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm384 64l-128 0L256 0 384 128z'}"/>
                        </svg>
                    </span>
                    <span class="name">${item.name}</span>
                    <span class="path">${item.path}</span>
                </div>
            `;

            const html = results.folders.map(folder => createResultItem(folder, true)).join('') +
                        results.files.map(file => createResultItem(file, false)).join('');

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
            await this.updateTotalSize();
        } catch (error) {
            alert(error.message);
        }
    }

    async handleDirectoryChange() {
        if (this.elements.directoryInput.disabled) {
            this.elements.directoryInput.disabled = false;
            this.elements.changeDirBtn.classList.remove('locked');
            return;
        }

        const newPath = this.elements.directoryInput.value.trim();
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

            this.elements.directoryInput.disabled = true;
            this.elements.changeDirBtn.classList.add('locked');
            window.location.href = '/';
        } catch (error) {
            alert(error.message);
        }
    }
}

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

let ui;
document.addEventListener('DOMContentLoaded', () => ui = new UIManager());

window.startRename = (element, isFolder) => ui?.startRename(element, isFolder);
window.deleteItem = (name, isFolder) => ui?.deleteItem(name, isFolder);
window.createFolder = async () => {
    try {
        await API.createFolder(API.getCurrentPath());
        await ui?.refreshContent();
        await ui?.updateTotalSize();
    } catch (error) {
        alert(error.message);
    }
};
