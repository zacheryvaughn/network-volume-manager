FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY run.py .

# Create a directory for the volume
RUN mkdir -p /data

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Expose the port
EXPOSE 5000

# Command to run the application
CMD ["python", "run.py", "--host", "0.0.0.0", "--port", "5000"]

# docker build -t zacvaughndev/network-volume-manager:v3 --platform linux/amd64 .