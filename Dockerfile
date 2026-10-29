FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY src ./src
COPY skill-library ./skill-library
# Host networking on Linux is recommended if using Docker with Secure MCP Tunnel.
# Never publish this port on a public interface without supported authentication.
ENV SKILL_BRIDGE_HOST=127.0.0.1
ENV SKILL_BRIDGE_PORT=8787
USER node
CMD ["node", "server.mjs"]
