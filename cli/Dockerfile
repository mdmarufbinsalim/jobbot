# Playwright image ships Chromium and every system library it needs. Keep the tag in step with package.json's playwright.
FROM mcr.microsoft.com/playwright:v1.64.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY bin ./bin
COPY src ./src
# Account details are NOT baked in: pass JOBBOT_PHONE / JOBBOT_PIN / JOBBOT_SMS_URL or mount config.local.json at /app/config.local.json.
ENV NODE_ENV=production
VOLUME ["/data"]
ENTRYPOINT ["node", "bin/jobbot.js"]
CMD ["run", "--out", "/data/out", "--shots", "/data/shots", "--profile", "/data/profile", "--no-interactive"]
