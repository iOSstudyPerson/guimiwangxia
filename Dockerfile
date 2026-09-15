# 王下七武海俱乐部 · 共享版容器
FROM python:3.12-slim
WORKDIR /app
COPY server.py start.sh index.html cos_util.py ocr_util.py ./
COPY css ./css
COPY js ./js
COPY deploy ./deploy
RUN mkdir -p /app/data && chmod +x /app/start.sh
ENV PORT=8765
ENV ADMIN_USER=王下七武海
ENV ADMIN_PASSWORD=123456
EXPOSE 8765
VOLUME ["/app/data"]
CMD ["python3", "server.py"]
