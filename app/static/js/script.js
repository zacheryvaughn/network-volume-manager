// Helper function to update path display
const updatePathDisplay = () => {
    if (!state.elements.pathDisplay || !state.elements.volumeSelect) return; // Guard against early calls
    
    const { pathDisplay } = state.elements;
    const volumeSelect = state.elements.volumeSelect;
    const selectedVolume = volumeSelect.value;
    
    // Get the relative path by removing the volume prefix
    const relativePath = state.currentVolumePath.replace(selectedVolume, '');
    const parts = relativePath.split('/').filter(Boolean);
    
    // Create clickable breadcrumb navigation starting with volume root
    let html = `<a href="#" class="path-root">📁 ${selectedVolume}</a>`;
    let currentPath = selectedVolume;
    
    parts.forEach((part, index) => {
        currentPath += part + '/';
        html += `<a href="#" class="path-part" data-path="${currentPath}">${part}/</a>`;
    });
    
    pathDisplay.innerHTML = html;
    
    // Add click handlers for path navigation
    pathDisplay.querySelectorAll('.path-part').forEach(link => {
        link.onclick = (e) => {
            e.preventDefault();
            state.currentVolumePath = link.dataset.path;
            state.socket.emit('validate_path', { volume_path: state.currentVolumePath });
        };
    });
    
    // Make volume root clickable
    const pathRoot = pathDisplay.querySelector('.path-root');
    if (pathRoot) {
        pathRoot.onclick = (e) => {
            state.currentVolumePath = selectedVolume;
            state.socket.emit('validate_path', { volume_path: state.currentVolumePath });
        };
    }
};

// Constants
const CONFIG = {
    SOCKET: {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 60000,
    },
    UPLOAD: {
        CHUNK_SIZE: 10 * 1024 * 1024, // Increased to match client's natural chunk size
        MAX_FILE_SIZE: 20 * 1024 * 1024 * 1024,
        MAX_FILENAME_LENGTH: 255,
        MAX_RETRIES: 3,
        CHUNK_DELAY: 60, // 60ms delay between chunks for smooth streaming
    }
};

// State management
const state = {
    currentVolumePath: '/runpod-volume/',
    elements: {},
    socket: null
};

// Utility functions
const utils = {
    formatTime: (seconds) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
    },

    formatSize: (bytes) => {
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        if (bytes === 0) return '0 Bytes';
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
        const size = bytes / Math.pow(1024, i);
        return size.toFixed(i === 0 ? 1 : 2) + ' ' + sizes[i];
    },

    updateStatus: (message) => {
        state.elements.connectionStatus.textContent = message;
    },

    showUploadProgress: (file) => {
        const { uploadStatus, uploadingFile, uploadProgress, chunkProgress, serverProgress } = state.elements;
        uploadStatus.classList.remove('hidden');
        uploadingFile.textContent = `Uploading: ${file.name}`;
        uploadProgress.textContent = 'Upload Percentage: 0%';
        chunkProgress.textContent = 'Preparing upload...';
        serverProgress.textContent = '';
    }
};

// Socket event handlers
const socketHandlers = {
    connect: () => {
        utils.updateStatus('Connected');
        if (state.currentVolumePath) {
            state.socket.emit('list_files', { volume_path: state.currentVolumePath });
        }
    },

    disconnect: () => utils.updateStatus('Disconnected - trying to reconnect...'),
    
    connect_error: (error) => utils.updateStatus(`Connection error: ${error.message}`),
    
    reconnect: (attemptNumber) => {
        utils.updateStatus(`Reconnected after ${attemptNumber} attempts`);
        if (state.currentVolumePath) {
            state.socket.emit('list_files', { volume_path: state.currentVolumePath });
        }
    },
    
    reconnect_failed: () => utils.updateStatus('Failed to reconnect - please refresh the page'),
    
    path_validation: (response) => {
        const { pathError, fileList } = state.elements;
        if (response.success) {
            pathError.classList.add('hidden');
            state.socket.emit('list_files', { volume_path: state.currentVolumePath });
        } else {
            pathError.textContent = response.message;
            pathError.classList.remove('hidden');
            fileList.innerHTML = '<p>No files</p>';
        }
    },
    
    processing_status: (data) => {
        const percent = Math.round((data.processed / data.total) * 100);
        state.elements.serverProgress.textContent = `Server Processing: ${percent}%`;
    },
    
    files_updated: (data) => {
        const { fileList, pathDisplay } = state.elements;
        fileList.innerHTML = '';
        
        // Always update path display first, regardless of file list
        updatePathDisplay();
        
        if (!data.success || !data.files || !data.files.length) {
            fileList.innerHTML = '<p>No files</p>';
            return;
        }
        
        const totalSize = utils.formatSize(data.total_size || 0);
        fileList.innerHTML = `<p>Total space used: ${totalSize}</p>`;
        
        const list = document.createElement('ul');
        
        // Sort and display items (folders first, then files)
        data.files.forEach(item => {
            const listItem = document.createElement('li');
            const date = new Date(item.modified * 1000).toLocaleString();
            
            if (item.is_dir) {
                // Folder item
                const folderName = item.name.split('/').pop(); // Get last part of path
                listItem.innerHTML = `
                    <span class="folder-icon">📁</span>
                    <a href="#" class="folder-link">${folderName}</a>
                    (Folder) - Modified: ${date}
                `;
                
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.onclick = () => fileOperations.deleteFile(item.name, true);
                
                listItem.appendChild(deleteBtn);
                listItem.querySelector('.folder-link').onclick = (e) => {
                    e.preventDefault();
                    fileOperations.navigateToFolder(item.name);
                };
            } else {
                // File item
                listItem.innerHTML = `
                    <span class="file-icon">📄</span>
                    ${item.name.split('/').pop()} (${utils.formatSize(item.size)}) - Modified: ${date}
                `;
                
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.onclick = () => fileOperations.deleteFile(item.name);
                
                listItem.appendChild(deleteBtn);
            }
            
            list.appendChild(listItem);
        });
        fileList.appendChild(list);
    },
    
    upload_response: (data) => {
        const { uploadStatus, uploadProgress, chunkProgress } = state.elements;
        if (data.success) {
            uploadStatus.classList.add('hidden');
        } else {
            uploadProgress.textContent = 'Upload Percentage: 100%';
            chunkProgress.textContent = data.message || 'Upload failed';
        }
        utils.updateStatus(data.message);
    },
    
    delete_response: (data) => {
        utils.updateStatus(data.message);
        if (data.success && state.currentVolumePath) {
            state.socket.emit('list_files', { volume_path: state.currentVolumePath });
        }
    },

    folder_response: (data) => {
        utils.updateStatus(data.message);
        if (data.success && state.currentVolumePath) {
            state.socket.emit('list_files', { volume_path: state.currentVolumePath });
        }
    }
};

// File operations
const fileOperations = {
    navigateToFolder: (folderPath) => {
        const volumeSelect = state.elements.volumeSelect;
        const selectedVolume = volumeSelect.value;
        
        // If it's a parent directory link (..)
        if (folderPath === '..') {
            const currentParts = state.currentVolumePath.replace(selectedVolume, '').split('/').filter(Boolean);
            if (currentParts.length > 0) { // Don't go above volume root
                currentParts.pop();
                state.currentVolumePath = selectedVolume + currentParts.join('/') + '/';
            } else {
                state.currentVolumePath = selectedVolume; // Stay at volume root
            }
        } else {
            // For regular folder navigation
            if (state.currentVolumePath.endsWith('/')) {
                state.currentVolumePath = state.currentVolumePath + folderPath + '/';
            } else {
                state.currentVolumePath = state.currentVolumePath + '/' + folderPath + '/';
            }
        }
        
        // Update path display and refresh file list
        updatePathDisplay();
        state.socket.emit('validate_path', { volume_path: state.currentVolumePath });
    },

    createFolder: (folderName) => {
        state.socket.emit('create_folder', {
            folder_name: folderName,
            volume_path: state.currentVolumePath
        });
    },

    deleteFile: (filename, isFolder = false) => {
        state.socket.emit('delete_file', {
            file_name: filename,
            volume_path: state.currentVolumePath,
            is_folder: isFolder
        });
    },

    uploadFile: () => {
        const file = state.elements.fileInput.files[0];
        if (!file) {
            utils.updateStatus('Please select a file');
            return;
        }

        if (file.size > CONFIG.UPLOAD.MAX_FILE_SIZE) {
            utils.updateStatus(`File too large. Maximum size is ${utils.formatSize(CONFIG.UPLOAD.MAX_FILE_SIZE)}`);
            return;
        }

        if (file.name.length > CONFIG.UPLOAD.MAX_FILENAME_LENGTH) {
            utils.updateStatus(`File name too long. Maximum length is ${CONFIG.UPLOAD.MAX_FILENAME_LENGTH} characters`);
            return;
        }

        state.elements.fileInput.value = '';
        utils.showUploadProgress(file);
        state.elements.uploadProgress.textContent = 'Upload Percentage: 0%';
        state.elements.chunkProgress.textContent = 'Starting upload...';

        const uploadState = {
            offset: 0,
            retries: 0,
            currentChunk: 0,
            uploadComplete: false,
            startTime: Date.now()
        };

        const updateStats = () => {
            const elapsedTime = (Date.now() - uploadState.startTime) / 1000;
            const uploadedBytes = uploadState.offset;
            const speed = uploadedBytes / elapsedTime;
            const remainingBytes = file.size - uploadedBytes;
            const timeRemaining = remainingBytes / speed;

            return {
                speed: utils.formatSize(speed) + '/s',
                timeRemaining: utils.formatTime(timeRemaining) + ' remaining'
            };
        };

        const uploadChunk = async () => {
            try {
                if (!state.socket.connected) {
                    if (uploadState.retries < CONFIG.UPLOAD.MAX_RETRIES) {
                        uploadState.retries++;
                        utils.updateStatus(`Connection lost. Retrying... (${uploadState.retries}/${CONFIG.UPLOAD.MAX_RETRIES})`);
                        setTimeout(uploadChunk, 1000 * uploadState.retries);
                        return;
                    }
                    throw new Error('Connection lost');
                }

                // Read next chunk only after previous chunk is processed
                state.socket.once('processing_status', () => {
                    const progress = Math.round((uploadState.offset / file.size) * 100);
                    const stats = updateStats();
                    state.elements.uploadProgress.textContent = `Upload Percentage: ${progress}% (${stats.speed} - ${stats.timeRemaining})`;
                    
                    if (!uploadState.uploadComplete) {
                        setTimeout(uploadChunk, CONFIG.UPLOAD.CHUNK_DELAY);
                    }
                });

                const chunk = file.slice(uploadState.offset, uploadState.offset + CONFIG.UPLOAD.CHUNK_SIZE);
                const reader = new FileReader();

                reader.onload = (e) => {
                    const base64Data = e.target.result.replace(/^data:[^;]+;base64,/, '');
                    state.socket.emit('upload_file', {
                        file_name: file.name,
                        file_content: base64Data,
                        total_size: file.size,
                        offset: uploadState.offset,
                        volume_path: state.currentVolumePath
                    });
                    
                    uploadState.offset += chunk.size;
                    
                    if (uploadState.offset >= file.size && !uploadState.uploadComplete) {
                        uploadState.uploadComplete = true;
                        state.elements.uploadProgress.textContent = 'Upload Percentage: 100%';
                    }
                };

                reader.onerror = () => {
                    if (uploadState.retries < CONFIG.UPLOAD.MAX_RETRIES) {
                        uploadState.retries++;
                        utils.updateStatus(`Error reading file. Retrying... (${uploadState.retries}/${CONFIG.UPLOAD.MAX_RETRIES})`);
                        setTimeout(uploadChunk, 1000 * uploadState.retries);
                    } else {
                        throw new Error('Error reading file');
                    }
                };

                reader.readAsDataURL(chunk);
            } catch (error) {
                state.elements.uploadStatus.classList.add('hidden');
                utils.updateStatus(`Failed to upload ${file.name}: ${error.message}`);
            }
        };

        uploadChunk();
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Initialize socket with default namespace
    state.socket = io('/', CONFIG.SOCKET);

    // Cache DOM elements
    state.elements = {
        connectionStatus: document.getElementById('connectionStatus'),
        uploadForm: document.getElementById('uploadForm'),
        volumeSelect: document.getElementById('volumePath'),
        pathError: document.getElementById('pathError'),
        fileList: document.getElementById('fileList'),
        uploadStatus: document.getElementById('uploadStatus'),
        uploadingFile: document.getElementById('uploadingFile'),
        uploadProgress: document.getElementById('uploadProgress'),
        chunkProgress: document.getElementById('chunkProgress'),
        serverProgress: document.getElementById('serverProgress'),
        fileInput: document.getElementById('fileInput'),
        pathDisplay: document.getElementById('pathDisplay'),
        createFolderForm: document.getElementById('createFolderForm'),
        folderNameInput: document.getElementById('folderNameInput')
    };

    // Register socket events
    Object.entries(socketHandlers).forEach(([event, handler]) => {
        state.socket.on(event, handler);
    });


    // Setup event listeners
    state.elements.volumeSelect.addEventListener('change', (e) => {
        const newPath = e.target.value;
        state.currentVolumePath = newPath;
        state.elements.pathError.classList.add('hidden');
        state.elements.pathError.textContent = '';
        
        updatePathDisplay();  // Update path display immediately when volume changes
        state.socket.emit('validate_path', { volume_path: state.currentVolumePath });
    });

    state.elements.uploadForm.addEventListener('submit', (e) => {
        e.preventDefault();
        fileOperations.uploadFile();
    });

    state.elements.createFolderForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const folderName = state.elements.folderNameInput.value.trim();
        if (folderName) {
            fileOperations.createFolder(folderName);
            state.elements.folderNameInput.value = '';
        }
    });

    // Initial setup
    if (state.elements.volumeSelect.value !== state.currentVolumePath) {
        state.currentVolumePath = state.elements.volumeSelect.value;
    }
    
    updatePathDisplay();
    state.socket.emit('validate_path', { volume_path: state.currentVolumePath });
});