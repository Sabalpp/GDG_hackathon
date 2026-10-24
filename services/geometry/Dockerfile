FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
WORKDIR /workspace/services/geometry
COPY services/geometry/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/geometry/app ./app
COPY data /workspace/data
RUN useradd --uid 10001 --create-home adapt
USER adapt
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/health', timeout=3)"
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
