FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY relay.py .
USER 10001
EXPOSE 8787
CMD ["python", "relay.py"]