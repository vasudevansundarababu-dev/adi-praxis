# Grading image for the praxis-harbor-verify Cloud Run job (and DockerRunner locally).
# Build from the repository root: docker build -f infra/harbor-verify/Dockerfile .
FROM python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54
COPY infra/harbor-verify/requirements.txt /opt/grade/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/grade/requirements.txt
COPY infra/harbor-verify/grade.py infra/harbor-verify/pytest.ini /opt/grade/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Starts as root only to drop to nobody before any task code runs (see grade.py).
ENTRYPOINT ["python3", "/opt/grade/grade.py"]
