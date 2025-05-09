// Initialize Resumable.js with configuration
const r = new Resumable({
    target: '/resumable_upload',
    chunkSize: 8 * 1024 * 1024,
    simultaneousUploads: 4,
    maxChunkRetries: 6,
    chunkRetryInterval: 4000,
    testChunks: false
});

// DOM element references
const statusElement = document.getElementById('status');
const progressElement = document.getElementById('progress');
const progressBar = document.getElementById('progress-bar');
const toggleButton = document.getElementById('toggle');

// Simple upload states
const UploadState = {
    IDLE: 'idle',
    EXISTS: 'exists',
    UPLOADING: 'uploading',
    PAUSED: 'paused',
    FAILED: 'failed',
    COMPLETED: 'completed'
};

// Current state
let currentState = UploadState.IDLE;
let resetTimer = null;

// Update UI based on state
function updateUI(state, percent = 0) {
    currentState = state;
    
    // Update progress
    progressElement.innerHTML = percent === 0 ? '' : percent + '%';
    progressBar.style.width = percent + '%';
    progressBar.innerHTML = percent === 0 ? '' : percent + '%';
    
    // Update status message and toggle button based on state
    switch (state) {
        case UploadState.IDLE:
            statusElement.innerHTML = 'Ready';
            toggleButton.disabled = true;
            toggleButton.innerHTML = 'Pause';
            break;
            
        case UploadState.EXISTS:
            statusElement.innerHTML = 'File already exists';
            toggleButton.disabled = true;
            toggleButton.innerHTML = 'Pause';
            break;
            
        case UploadState.UPLOADING:
            statusElement.innerHTML = 'Uploading';
            toggleButton.disabled = false;
            toggleButton.innerHTML = 'Pause';
            break;
            
        case UploadState.PAUSED:
            statusElement.innerHTML = 'Paused';
            toggleButton.disabled = false;
            toggleButton.innerHTML = 'Resume';
            break;
            
        case UploadState.FAILED:
            statusElement.innerHTML = 'Failed';
            toggleButton.disabled = false;
            toggleButton.innerHTML = 'Pause';
            break;
            
        case UploadState.COMPLETED:
            statusElement.innerHTML = 'Completed';
            toggleButton.disabled = true;
            toggleButton.innerHTML = 'Pause';
            
            // Reset to IDLE after 3 seconds
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => {
                updateUI(UploadState.IDLE);
            }, 3000);
            break;
    }
}

// Check if file is already uploaded
function checkFileStatus(file) {
    const params = new URLSearchParams({
        resumableFilename: file.fileName,
        resumableIdentifier: file.uniqueIdentifier
    });
    
    fetch(`/resumable_upload?${params.toString()}`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'complete') {
                // File already fully uploaded
                updateUI(UploadState.EXISTS);
                file.cancel();
            } else if (data.status === 'in_progress') {
                // Upload in progress, resumable.js will handle resuming
                updateUI(UploadState.UPLOADING);
                r.upload();
            } else if (data.status === 'not_found') {
                // File doesn't exist yet, this is normal
                updateUI(UploadState.UPLOADING);
                r.upload();
            }
        })
        .catch(error => {
            console.error('File-Check Status:', error);
            updateUI(UploadState.FAILED);
        });
}

// Toggle button event listener
toggleButton.addEventListener('click', function() {
    switch (currentState) {
        case UploadState.UPLOADING:
            r.pause();
            break;
        case UploadState.PAUSED:
        case UploadState.FAILED:
            r.upload();
            // When resuming, start with current progress rather than resetting to 0
            const percent = Math.floor(r.progress() * 100);
            updateUI(UploadState.UPLOADING, percent);
            break;
    }
});

// Assign browse button and drop zone
r.assignBrowse(document.getElementById('browseButton'));
r.assignDrop(document.querySelector('.upload-container'));

// Event handlers
r.on('fileSuccess', function(file) {
    console.debug('fileSuccess', file);
    // Only update progress, but stay in UPLOADING state
    // This prevents the UI from resetting between files
    if (currentState === UploadState.UPLOADING) {
        const percent = Math.floor(r.progress() * 100);
        updateUI(UploadState.UPLOADING, percent);
    }
    // We'll set to COMPLETED state only when all files are done in the 'complete' handler
});

r.on('fileProgress', function(file) {
    if (currentState === UploadState.UPLOADING) {
        const percent = Math.floor(r.progress() * 100);
        updateUI(UploadState.UPLOADING, percent);
    }
});

r.on('fileAdded', function(file) {
    console.debug('fileAdded', file);
    // Reset progress to 0% when a new file is added
    updateUI(UploadState.IDLE, 0);
    checkFileStatus(file);
});

r.on('filesAdded', function(array) {
    console.debug('filesAdded', array);
    if (array.length > 0) {
        // Reset progress to 0% when new files are added
        updateUI(UploadState.IDLE, 0);
        checkFileStatus(array[array.length - 1]);
    }
});

r.on('fileError', function(file, message) {
    console.error('fileError', file, message);
    updateUI(UploadState.FAILED);
});

r.on('error', function(message, file) {
    console.error('error', message, file);
    updateUI(UploadState.FAILED);
});

r.on('pause', function() {
    console.debug('pause');
    // Preserve the current progress when pausing
    const percent = Math.floor(r.progress() * 100);
    updateUI(UploadState.PAUSED, percent);
});

r.on('complete', function() {
    console.debug('complete');
    updateUI(UploadState.COMPLETED, 100);
    
    // Reset the queue by removing all files after all uploads are complete
    // This ensures proper handling for both single and multiple file uploads
    setTimeout(() => {
        // Create a copy of the files array to avoid modification during iteration
        const filesToRemove = [...r.files];
        filesToRemove.forEach(file => {
            r.removeFile(file);
        });
    }, 1000);
});

// Initialize UI
updateUI(UploadState.IDLE);
