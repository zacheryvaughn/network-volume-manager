import eventlet
eventlet.monkey_patch()

from flask import Flask
from flask_socketio import SocketIO

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev'

socketio = SocketIO(
    app,
    ping_timeout=7200,
    ping_interval=25,
    max_http_buffer_size=1024 * 1024 * 32,
    async_mode='eventlet',
    cors_allowed_origins='*',
    logger=False,
    engineio_logger=False
)

from app import routes