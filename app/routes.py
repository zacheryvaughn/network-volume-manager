from flask import render_template
from flask_socketio import emit
from app import app, socketio
from app.operations import save_file, delete_file, list_content, create_folder, delete_folder
from app.utils import handle_socket_errors, emit_response, validate_volume_path, sanitize_path
import os

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('validate_path')
@handle_socket_errors('path_validation')
def handle_validate_path(data):
    volume_path = data.get('volume_path', '')
    if not volume_path.startswith('/'):
        volume_path = os.path.join(os.getcwd(), volume_path)

    if volume_path == '/runpod-volume/':
        emit('path_validation', {'success': True, 'message': "RunPod volume path is valid"})
        emit('files_updated', {'success': True, 'files': [], 'total_size': 0})
        return

    if os.path.isdir(volume_path):
        emit('path_validation', {'success': True, 'message': "Path is valid"})
        result = list_content(volume_path)
        if result["success"]:
            emit('files_updated', {
                'success': True,
                'files': result['files'],
                'total_size': result['total_size']
            })
    else:
        emit('path_validation', {'success': False, 'message': f"Path {volume_path} is not accessible"})

@socketio.on('upload_file', namespace='/')
@handle_socket_errors('upload_response')
def handle_upload(data):
    file_name = data['file_name']
    file_content = data['file_content']
    total_size = data.get('total_size', 0)
    offset = data.get('offset', 0)
    volume_path = data.get('volume_path', '')

    # Validate path only on first chunk
    if offset == 0:
        if volume_path == '/runpod-volume/':
            emit('upload_response', {'success': False, 'message': "Cannot upload to RunPod volume in development mode"})
            return
        if not os.path.isdir(volume_path):
            emit('upload_response', {'success': False, 'message': f"Volume path {volume_path} is not accessible"})
            return

    def status_update(processed_bytes):
        emit('processing_status', {
            'success': True,
            'processed': processed_bytes,
            'total': total_size,
            'status': 'processing' if processed_bytes < total_size else 'complete'
        }, broadcast=False)

    result = save_file(file_name, file_content, volume_path,
                      append=offset > 0,
                      status_callback=status_update,
                      current_offset=offset)

    if result["success"]:
        # Only verify and update file list on final chunk
        if offset + result.get("decoded_size", 0) >= total_size:
            # Update file list once at completion
            files_result = list_content(volume_path)
            if files_result["success"]:
                emit('files_updated', {
                    'success': True,
                    'files': files_result['files'],
                    'total_size': files_result['total_size']
                })
            emit('upload_response', {'success': True, 'message': f"Successfully uploaded {file_name}"})
    else:
        emit('upload_response', {'success': False, 'message': result["message"]})

@socketio.on('create_folder')
@handle_socket_errors('folder_response')
def handle_create_folder(data):
    folder_name = data['folder_name']
    volume_path = data.get('volume_path', '')
    
    if volume_path == '/runpod-volume/':
        emit('folder_response', {'success': False, 'message': "Cannot create folders in RunPod volume in development mode"})
        return
        
    if not os.path.isdir(volume_path):
        emit('folder_response', {'success': False, 'message': f"Volume path {volume_path} is not accessible"})
        return
        
    result = create_folder(folder_name, volume_path)
    if result["success"]:
        files_result = list_content(volume_path)
        if files_result["success"]:
            emit('files_updated', {
                'success': True,
                'files': files_result['files'],
                'total_size': files_result['total_size']
            })
        emit('folder_response', {'success': True, 'message': f"Successfully created folder {folder_name}"})
    else:
        emit('folder_response', {'success': False, 'message': result["message"]})

@socketio.on('delete_file')
@handle_socket_errors('delete_response')
def handle_delete(data):
    file_name = data['file_name']
    volume_path = data.get('volume_path', '')
    is_folder = data.get('is_folder', False)
    
    if volume_path == '/runpod-volume/':
        emit('delete_response', {'success': False, 'message': "Cannot delete from RunPod volume in development mode"})
        return
        
    if not os.path.isdir(volume_path):
        emit('delete_response', {'success': False, 'message': f"Volume path {volume_path} is not accessible"})
        return
    
    result = delete_folder(file_name, volume_path) if is_folder else delete_file(file_name, volume_path)
    if result["success"]:
        files_result = list_content(volume_path)
        if files_result["success"]:
            emit('files_updated', {
                'success': True,
                'files': files_result['files'],
                'total_size': files_result['total_size']
            })
        emit('delete_response', {'success': True, 'message': f"Successfully deleted {'folder' if is_folder else 'file'} {file_name}"})
    else:
        emit('delete_response', {'success': False, 'message': result["message"]})

@socketio.on('list_files')
@handle_socket_errors('files_updated')
def handle_list(data=None):
    volume_path = data.get('volume_path', '') if data else ''
    if not os.path.isdir(volume_path):
        emit('files_updated', {'success': False, 'message': f"Volume path {volume_path} is not accessible"})
        return
    
    result = list_content(volume_path)
    if result["success"]:
        emit('files_updated', {
            'success': True,
            'files': result['files'],
            'total_size': result['total_size']
        })
    else:
        emit('files_updated', {'success': False, 'message': result["message"]})