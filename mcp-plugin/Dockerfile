# The MCP service of LINEA (the mcp-plugin): the MCP server over HTTP, one endpoint per line. Build from this folder:
#   docker build -t linea-mcp .   (LINEA_API_URL says where LINEA is; PORT, MCP_PUBLIC_URL, MCP_READ_ONLY are optional)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3333
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 3333
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/http.js"]
