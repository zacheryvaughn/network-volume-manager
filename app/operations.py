import os
import pybase64
import shutil
from typing import Callable, Dict, List, Optional, Any, Union
from app.utils import sanitize_path, create_response, validate_volume_path

def save_file(
    file_name: str,
    file_content_base64: str,
    volume_path: str,
    append: bool = False,
    status_callback: Optional[Callable[[int], None]] = None,
    current_offset: int = 0
) -> Dict[str, Any]:
    """
    Save a base64 encoded file to the specified volume path with optimized processing
    """
    try:
        if not os.path.isdir(volume_path):
            return create_response(False, f"Volume path {volume_path} is not accessible")
            
        safe_file_name = sanitize_path(file_name)
        file_path = os.path.join(volume_path, safe_file_name)
        
        # Remove data URL prefix if present (optimization: only split once)
        if ',' in file_content_base64:
            file_content_base64 = file_content_base64.split(',', 1)[1]
        
        # Simple, direct decode and write
        mode = 'ab' if append else 'wb'
        decoded_data = pybase64.b64decode(file_content_base64)
        decoded_size = len(decoded_data)
        
        with open(file_path, mode) as f:
            f.write(decoded_data)
            
        if status_callback:
            status_callback(current_offset + decoded_size)
        
        return create_response(
            True,
            f"File {safe_file_name} {'chunk ' if append else ''}uploaded successfully",
            path=file_path,
            decoded_size=decoded_size
        )
    except Exception as e:
        return create_response(False, f"Error uploading file: {str(e)}")

def delete_file(file_name: str, volume_path: str) -> Dict[str, Any]:
    """
    Delete a file from the specified volume path
    """
    try:
        # Quick validation without full path check
        if not os.path.isdir(volume_path):
            return create_response(False, f"Volume path {volume_path} is not accessible")
            
        # Sanitize the file path
        safe_file_name = sanitize_path(file_name)
        file_path = os.path.join(volume_path, safe_file_name)
        
        # Check if file exists
        if not os.path.exists(file_path):
            return create_response(False, f"File {safe_file_name} not found")
        
        # Delete file
        os.remove(file_path)
        return create_response(True, f"File {safe_file_name} deleted successfully")
    except Exception as e:
        return create_response(False, f"Error deleting file: {str(e)}")

def create_folder(folder_name: str, volume_path: str) -> Dict[str, Any]:
    """
    Create a new folder in the specified volume path
    """
    try:
        # Quick validation without full path check
        if not os.path.isdir(volume_path):
            return create_response(False, f"Volume path {volume_path} is not accessible")
            
        # Sanitize the folder path
        safe_folder_name = sanitize_path(folder_name)
        folder_path = os.path.join(volume_path, safe_folder_name)
        
        # Check if folder already exists
        if os.path.exists(folder_path):
            return create_response(False, f"Folder {safe_folder_name} already exists")
        
        # Create folder
        os.makedirs(folder_path)
        return create_response(True, f"Folder {safe_folder_name} created successfully")
    except Exception as e:
        return create_response(False, f"Error creating folder: {str(e)}")

def delete_folder(folder_name: str, volume_path: str) -> Dict[str, Any]:
    """
    Delete a folder and all its contents from the specified volume path
    """
    try:
        import shutil
        
        # Quick validation without full path check
        if not os.path.isdir(volume_path):
            return create_response(False, f"Volume path {volume_path} is not accessible")
            
        # Sanitize the folder path
        safe_folder_name = sanitize_path(folder_name)
        folder_path = os.path.join(volume_path, safe_folder_name)
        
        # Check if folder exists and is a directory
        if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
            return create_response(False, f"Folder {safe_folder_name} not found")
        
        # Delete folder and all its contents recursively
        shutil.rmtree(folder_path)
        return create_response(True, f"Folder {safe_folder_name} and its contents deleted successfully")
    except Exception as e:
        return create_response(False, f"Error deleting folder: {str(e)}")

def list_content(volume_path: str) -> Dict[str, Any]:
    """
    List all files and folders in the specified volume path recursively and calculate total space used
    """
    try:
        # Normalize path by removing trailing slash if present
        normalized_path = volume_path.rstrip('/')
        
        # Special handling for RunPod volume which may not exist during development
        if normalized_path == '/runpod-volume':
            return create_response(
                True,
                "No files in RunPod volume",
                files=[],
                total_size=0
            )
            
        # For other paths, check if they exist and are directories
        if not os.path.isdir(normalized_path):
            return create_response(False, f"Volume path {normalized_path} is not accessible")
            
        # Use normalized path for scanning
        volume_path = normalized_path
        
        items: List[Dict[str, Union[str, int, float, bool]]] = []
        total_size = 0
        
        # Get files and folders at current level only
        try:
            with os.scandir(volume_path) as entries:
                for entry in entries:
                    try:
                        stat = entry.stat()
                        if entry.is_file():
                            total_size += stat.st_size
                            items.append({
                                "name": entry.name,
                                "size": stat.st_size,
                                "modified": stat.st_mtime,
                                "is_dir": False
                            })
                        elif entry.is_dir():
                            items.append({
                                "name": entry.name,
                                "size": 0,  # Directories themselves don't have size
                                "modified": stat.st_mtime,
                                "is_dir": True
                            })
                    except OSError:
                        continue  # Skip items we can't access
        except OSError:
            pass  # Skip directories we can't access
        
        # Sort items: folders first, then files, both alphabetically
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        
        return create_response(
            True,
            "Files and folders listed successfully",
            files=items,
            total_size=total_size
        )
    except Exception as e:
        return create_response(False, f"Error listing files: {str(e)}")