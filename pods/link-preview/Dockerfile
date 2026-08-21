FROM platformcollective/base-slim:v20260821

WORKDIR /app

COPY bundle/bundle.js ./
COPY bundle/bundle.js.map ./

EXPOSE 4041
CMD ["dumb-init", "node", "bundle.js"]