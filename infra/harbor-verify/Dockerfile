# Grading image for the praxis-harbor-verify Cloud Run job (and DockerRunner / verify-docker.ts locally).
# Build from the repository root: docker build -f infra/harbor-verify/Dockerfile .
#
# One image for every place a bundle is graded, so a score seen locally is the score production gives.
# Base pinned by digest; Python dependencies pinned by version and hash, wheels only (no build step runs code
# from the network). The build fails unless the runtime the graded tasks rely on is really there.
FROM python:3.12-slim@sha256:4840d514c583a4d3d8cad3940e68dee6f0f6f3635c12fcd0a3d74c21a5b93a54
COPY infra/harbor-verify/requirements.txt /opt/grade/requirements.txt
RUN pip install --no-cache-dir --no-compile --require-hashes --only-binary=:all: -r /opt/grade/requirements.txt \
 && python3 -m pip check
COPY infra/harbor-verify/grade.py infra/harbor-verify/pytest.ini /opt/grade/
# Runtime self-check: bash runs solution/solve.sh, pytest runs the verifiers, and the grader's own imports
# (fcntl/socket/struct for the sandbox loopback) load. Nothing here touches the network.
RUN bash -c 'true' \
 && python3 -c "import pytest, fcntl, socket, struct; assert pytest.__version__ == '8.3.5', pytest.__version__" \
 && python3 -c "import ast; ast.parse(open('/opt/grade/grade.py').read())"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Starts as root only to drop to nobody before any task code runs (see grade.py).
ENTRYPOINT ["python3", "/opt/grade/grade.py"]
