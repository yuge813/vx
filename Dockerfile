FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node shared ./shared
COPY --chown=node:node miniprogram ./miniprogram
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
USER node
ENV HOST=0.0.0.0 PORT=8792 DB_PATH=/app/data/yuanxiang.sqlite
EXPOSE 8792
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node","-e","fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","server/index.mjs"]
