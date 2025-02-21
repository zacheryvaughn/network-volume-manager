import os
from functools import wraps
from flask_socketio import emit
from typing import Any, Dict, Optional, Union

def sanitize_path(file_path: str) -> str:
    """
    Sanitize the file path to prevent traversal and replication issues
    """
    clean_path = os.path.normpath(file_path)
    if clean_path.startswith('..') or clean_path.startswith('/'):
        return os.path.basename(clean_path)
    
    clean_name = ''.join(c for c in clean_path if c.isalnum() or c in '._- /')
    return clean_name

def create_response(success: bool, message: str, **extra: Any) -> Dict[str, Any]:
    """
    Create a standardized response dictionary
    """
    return {
        "success": success,
        "message": message,
        **extra
    }

def emit_response(event: str, success: bool, message: str, broadcast: bool = False, **extra: Any) -> None:
    """
    Standardized response emitter for socket events with broadcast support
    """
    response = create_response(success, message, **extra)
    emit(event, response, broadcast=broadcast)

def validate_volume_path(volume_path: str) -> Union[bool, Dict[str, Any]]:
    """
    Validate that the volume path exists and is accessible
    Returns True if valid, or error response dict if invalid
    """
    if not volume_path:
        return create_response(False, "No volume path provided")
        
    if volume_path == '/runpod-volume/':
        return True
        
    if not os.path.exists(volume_path):
        return create_response(False, f"Volume {volume_path} not found")
        
    if not os.path.isdir(volume_path):
        return create_response(False, f"Volume path {volume_path} is not a directory")
    return True

def handle_socket_errors(event_name: str, broadcast: bool = False):
    """
    Decorator for socket event handlers to standardize error handling
    Supports optional broadcasting of responses
    """
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except Exception as e:
                print(f"Error in {event_name}: {str(e)}")
                emit_response(event_name, False, str(e), broadcast=broadcast)
        return wrapped
    return decorator