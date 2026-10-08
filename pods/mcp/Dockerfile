FROM platformcollective/base-slim:v20260811

WORKDIR /app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 4090
CMD ["dumb-init", "node", "bundle.js"]
