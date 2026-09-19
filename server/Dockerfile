# Score service + game rooms. Needs a persistent volume at /data for scores.db.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production PORT=8787 PFG_DB=/data/scores.db
VOLUME /data
EXPOSE 8787
CMD ["node", "--no-warnings", "src/index.js"]
