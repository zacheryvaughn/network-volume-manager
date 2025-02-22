document.getElementById('file').onchange = function() {
    const file = this.files[0];
    if (!file) return;
    
    // Check file size (32GB in bytes)
    const maxSize = 32 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('File size exceeds 32GB limit');
        return;
    }

    const progressContainer = document.querySelector('.progress-container');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    
    progressContainer.style.display = 'block';
    
    const xhr = new XMLHttpRequest();
    const currentPath = window.location.pathname.substring(1); // Remove leading slash
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
            progressBar.style.backgroundColor = '#4CAF50';
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            progressText.textContent = 'Upload Failed!';
            progressBar.style.backgroundColor = '#dc3545';
        }
    };
    
    xhr.onerror = function() {
        progressText.textContent = 'Upload Failed!';
        progressBar.style.backgroundColor = '#dc3545';
    };
    
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